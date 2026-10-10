import { sha256 } from '@noble/hashes/sha2.js';
import type { BattleStoryDeterministicDigest } from './arena-battle-story-session';

/** Transport frame size only; the host supplies its separate whole-commit resource policy. */
export const BATTLE_STORY_JSON_MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const JSON_STRING_CHUNK_SIZE = 8_192;

const jsonProperty = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  // Accessors can change between count and send, even on a frozen object.
  if (descriptor && !('value' in descriptor)) throw new Error('故事提交包含非 JSON 访问器');
  return descriptor?.value;
};

/**
 * Canonical V1 JSON tokens. Object keys use JavaScript's UTF-16 sort order, as in the
 * existing commit digest. Only string slices are stringified, never a whole record.
 * Undefined object values are omitted; undefined/holes in arrays become null.
 */
export function* iterateBattleStoryCommitJsonUtf8(
  value: unknown,
  stringChunkSize = JSON_STRING_CHUNK_SIZE,
): Generator<Uint8Array> {
  const ancestors = new Set<object>();
  const chunkSize = Number.isSafeInteger(stringChunkSize) && stringChunkSize >= 2
    ? Math.min(stringChunkSize, JSON_STRING_CHUNK_SIZE) : JSON_STRING_CHUNK_SIZE;
  const encoder = new TextEncoder();
  function* string(value: string): Generator<Uint8Array> {
    yield encoder.encode('"');
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(offset + chunkSize, value.length);
      // Keep paired surrogates together; JSON.stringify escapes each lone surrogate.
      if (end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1]!)) end -= 1;
      yield encoder.encode(JSON.stringify(value.slice(offset, end)).slice(1, -1));
      offset = end;
    }
    yield encoder.encode('"');
  }
  function* visit(current: unknown): Generator<Uint8Array> {
    if (current === null) { yield encoder.encode('null'); return; }
    if (typeof current === 'string') { yield* string(current); return; }
    if (typeof current === 'boolean') { yield encoder.encode(current ? 'true' : 'false'); return; }
    if (typeof current === 'number' && Number.isFinite(current)) { yield encoder.encode(JSON.stringify(current)); return; }
    if (typeof current !== 'object' || current === null) throw new Error('故事提交包含非 JSON 值');
    // JSON data has no serialization hooks. Even a non-enumerable hook would make
    // JSON.stringify describe a different value than this stable, frozen graph.
    const toJson = Object.getOwnPropertyDescriptor(current, 'toJSON');
    if (toJson && (!('value' in toJson) || typeof toJson.value === 'function')) {
      throw new Error('故事提交包含非 JSON 对象');
    }
    if (ancestors.has(current)) throw new Error('故事提交包含循环引用');
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const prototype = Object.getPrototypeOf(current);
        if (prototype !== Array.prototype && prototype !== null) throw new Error('故事提交包含非 JSON 对象');
        yield encoder.encode('[');
        for (let index = 0; index < current.length; index += 1) {
          if (index) yield encoder.encode(',');
          const child = jsonProperty(current, String(index));
          yield* visit(child === undefined ? null : child);
        }
        yield encoder.encode(']');
      } else {
        const prototype = Object.getPrototypeOf(current);
        if (prototype !== Object.prototype && prototype !== null) throw new Error('故事提交包含非 JSON 对象');
        yield encoder.encode('{');
        let first = true;
        for (const key of Object.keys(current).sort()) {
          const child = jsonProperty(current, key);
          if (child === undefined) continue;
          if (!first) yield encoder.encode(',');
          first = false;
          yield* string(key); yield encoder.encode(':'); yield* visit(child);
        }
        yield encoder.encode('}');
      }
    } finally {
      ancestors.delete(current);
    }
  }
  yield* visit(value);
}

const digestHex = (bytes: Uint8Array): string => (
  `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
);

/** SHA-256 of the exact received bytes, independent of JSON parsing or canonicalization. */
export const createBattleStoryByteDigest = (): Readonly<{
  update: (bytes: Uint8Array) => void;
  digest: () => string;
}> => {
  const hash = sha256.create();
  let result: string | undefined;
  return Object.freeze({
    update(bytes: Uint8Array): void {
      if (result !== undefined) throw new Error('故事原件字节摘要已结束');
      hash.update(bytes);
    },
    digest(): string {
      result ??= digestHex(hash.digest());
      return result;
    },
  });
};

/** V1 is SHA-256 over sorted-key JSON, not a hash of chunk hashes. */
export const digestBattleStoryCommitValue = (value: unknown, stringChunkSize = JSON_STRING_CHUNK_SIZE): string => {
  const hash = createBattleStoryByteDigest();
  for (const bytes of iterateBattleStoryCommitJsonUtf8(value, stringChunkSize)) hash.update(bytes);
  return hash.digest();
};

export class BattleStoryCommitByteLimitError extends RangeError {
  readonly code = 'story-commit-too-large';
  constructor(readonly maxBytes: number, readonly observedBytes: number) {
    // observedBytes is the exact visited prefix, NOT an estimate of the complete payload.
    super(`故事提交超过保存预算（上限 ${maxBytes} 字节，已计 ${observedBytes} 字节），未保存本章。`);
    this.name = 'BattleStoryCommitByteLimitError';
  }
}

const assertByteLimit = (maxBytes: number): void => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('故事提交字节预算无效');
};

/** Exact when successful; stops at the first token crossing the caller's limit. */
export const countBattleStoryCommitJsonBytes = (value: unknown, maxBytes = Number.MAX_SAFE_INTEGER): number => {
  assertByteLimit(maxBytes);
  let byteLength = 0;
  for (const bytes of iterateBattleStoryCommitJsonUtf8(value)) {
    byteLength += bytes.byteLength;
    if (byteLength > maxBytes) throw new BattleStoryCommitByteLimitError(maxBytes, byteLength);
  }
  return byteLength;
};

/**
 * Bounded, independent raw frames. A frame may split a UTF-8 sequence: concatenate raw
 * bytes (or use a streaming decoder), never decode each frame as a complete document.
 */
export function* chunkBattleStoryCommitJson(
  value: unknown,
  maxChunkBytes = BATTLE_STORY_JSON_MAX_CHUNK_BYTES,
): Generator<Uint8Array> {
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1 || maxChunkBytes > BATTLE_STORY_JSON_MAX_CHUNK_BYTES) {
    throw new RangeError('故事提交分块大小无效');
  }
  let frame = new Uint8Array(maxChunkBytes);
  let length = 0;
  for (const token of iterateBattleStoryCommitJsonUtf8(value)) {
    for (let offset = 0; offset < token.byteLength;) {
      const count = Math.min(maxChunkBytes - length, token.byteLength - offset);
      frame.set(token.subarray(offset, offset + count), length);
      offset += count;
      length += count;
      if (length === maxChunkBytes) {
        yield frame;
        frame = new Uint8Array(maxChunkBytes);
        length = 0;
      }
    }
  }
  if (length) yield frame.subarray(0, length);
}

/** Check an already-owned generation snapshot without freezing a live page draft. */
export const assertBattleStoryCommitFrozenJson = (value: unknown): void => {
  const seen = new Set<object>();
  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    if (!Object.isFrozen(current)) throw new Error('故事投影需要宿主已冻结的独立生成输入');
    seen.add(current);
    for (const key of Object.keys(current)) visit(jsonProperty(current, key));
  };
  visit(value);
};

export type PreparedBattleStoryCommitJson<T> = Readonly<{
  /** The exact graph counted, hashed and sent. The caller has transferred ownership. */
  value: T;
  byteLength: number;
  contentDigest: string;
  chunks: (maxChunkBytes?: number) => Generator<Uint8Array>;
  /** Optional independent copy, available only after the actual payload passed its budget. */
  materialize: () => T;
}>;

/**
 * Transfers ownership of a completed payload and recursively freezes its referenced JSON
 * graph. Do not pass objects still owned by editable page drafts. Schema validation must
 * inspect this same value; sending uses this handle, without rebuilding the payload.
 */
export const prepareBattleStoryCommitJson = <T>(value: T, maxBytes: number): PreparedBattleStoryCommitJson<T> => {
  assertByteLimit(maxBytes);
  freezeBattleStoryCommit(value);
  const hash = createBattleStoryByteDigest();
  let byteLength = 0;
  for (const bytes of iterateBattleStoryCommitJsonUtf8(value)) {
    byteLength += bytes.byteLength;
    if (byteLength > maxBytes) throw new BattleStoryCommitByteLimitError(maxBytes, byteLength);
    hash.update(bytes);
  }
  return Object.freeze({
    value, byteLength, contentDigest: hash.digest(),
    chunks: (maxChunkBytes?: number) => chunkBattleStoryCommitJson(value, maxChunkBytes),
    materialize: () => structuredClone(value),
  });
};

export type BattleStoryCommitSession = {
  id: string; title: string; createdAt: number; updatedAt: number;
  source: object; seed: { combatants: unknown[] }; workingCombatants: unknown[];
  lastChapterInputCombatants?: unknown[]; lastChapterId?: string | null; chapterCount: number;
};
export type BattleStoryCommitChapter<CardSnapshot = object> = {
  id: string; sessionId: string; index: number; action: 'start' | 'continue' | 'branch' | 'rewrite';
  status: 'active' | 'superseded'; sourceChapterId?: string | null; generationId?: string | null;
  title: string; markdown: string; reportJson: Record<string, unknown>; cardSnapshot?: CardSnapshot;
  deterministicDigest: BattleStoryDeterministicDigest; createdAt: number;
};
export type BattleStoryCommitCheckpoint = {
  id: string; sessionId: string; boundaryIndex: number; chapterId?: string | null;
  combatants: unknown[]; createdAt: number;
};
export type BattleStoryCommitReceipt = {
  version: 1; operationId: string; sessionId: string; chapterId: string; chapterIndex: number;
  chapterCount: number; checkpointIds: string[]; contentDigest: string;
};
export type BattleStoryCommitExpected = {
  sessionDigest: string;
  activeChapterHeads: Array<{ id: string; index: number }>;
  recentChaptersDigest: string;
  checkpointBoundary: number;
  checkpointDigest: string;
};
export type BattleStoryCompletedCommit<S extends BattleStoryCommitSession = BattleStoryCommitSession, CardSnapshot = object> = {
  version: 1; operationId: string; action: 'start' | 'continue';
  expected: BattleStoryCommitExpected | null;
  session: S; chapter: BattleStoryCommitChapter<CardSnapshot>; checkpoints: BattleStoryCommitCheckpoint[];
};

export const projectBattleStoryCommitChapters = (chapters: BattleStoryCommitChapter[]) => {
  const active = chapters.filter((chapter) => chapter.status !== 'superseded').sort((a, b) => a.index - b.index);
  return {
    activeChapterHeads: active.map(({ id, index }) => ({ id, index })),
    recentChapters: active.slice(-12).map(({ id, index, title, markdown, deterministicDigest }) => ({
      id, index, title, markdown, deterministicDigest,
    })),
  };
};

/** Captured before generation. Old writers need no revision retrofit: their actual input changes conflict. */
export const captureBattleStoryCommitExpected = (input: {
  session: BattleStoryCommitSession; chapters: BattleStoryCommitChapter[]; checkpoint: BattleStoryCommitCheckpoint | null;
}): BattleStoryCommitExpected => {
  const { activeChapterHeads, recentChapters } = projectBattleStoryCommitChapters(input.chapters);
  const last = activeChapterHeads.at(-1);
  if (!last || last.id !== input.session.lastChapterId || activeChapterHeads.length !== input.session.chapterCount
    || activeChapterHeads.some((chapter, index) => chapter.index !== index + 1)
    || new Set(activeChapterHeads.map((chapter) => chapter.id)).size !== activeChapterHeads.length) {
    throw new Error('会话章节状态已变化，请重新选择会话后再继续。');
  }
  if (input.checkpoint && (input.checkpoint.sessionId !== input.session.id
    || input.checkpoint.boundaryIndex !== last.index || input.checkpoint.chapterId !== last.id)) {
    throw new Error('会话章末快照与当前章节不一致，请重新选择会话。');
  }
  return {
    sessionDigest: digestBattleStoryCommitValue(input.session),
    activeChapterHeads,
    recentChaptersDigest: digestBattleStoryCommitValue(recentChapters),
    checkpointBoundary: last.index,
    checkpointDigest: digestBattleStoryCommitValue(input.checkpoint),
  };
};

export type BuildCompletedBattleStoryRecordsInput<S extends BattleStoryCommitSession = BattleStoryCommitSession, CardSnapshot = object> = {
  action: 'start' | 'continue'; session: S;
  operationId: string; checkpointId: string; initialCheckpointId?: string; now: number;
  source: S['source']; inputCombatants: unknown[];
  generated: {
    chapterIndex: number; markdown: string; reportJson: Record<string, unknown>;
    digest: BattleStoryDeterministicDigest; generationId?: string | null; cardSnapshot?: CardSnapshot | null;
    nextWorkingCombatants: unknown[];
  };
};

export type BattleStoryCompletedRecords<S extends BattleStoryCommitSession = BattleStoryCommitSession, CardSnapshot = object> = Pick<
  BattleStoryCompletedCommit<S, CardSnapshot>, 'session' | 'chapter' | 'checkpoints'
>;

/**
 * Shared record assembly, independent of the host's CAS representation. No time, IDs,
 * storage, model calls or platform effects are created here. Keep generated content even
 * when its announced index is invalid: validate at save time, after the host retains it.
 */
export const buildCompletedBattleStoryRecords = <S extends BattleStoryCommitSession, CardSnapshot = object>(
  input: BuildCompletedBattleStoryRecordsInput<S, CardSnapshot>,
): BattleStoryCompletedRecords<S, CardSnapshot> => {
  const { generated, session, action, now } = input;
  const previousCount = action === 'start' ? 0 : session.chapterCount;
  if (!Number.isSafeInteger(previousCount) || previousCount < 0
    || (action === 'start' && !input.initialCheckpointId)) {
    throw new Error('完成章与预期会话位置不一致，未保存本章。');
  }
  const title = generated.digest.chapterTitle?.trim() || generated.digest.chapterTitle || `第 ${generated.chapterIndex} 章`;
  const chapter: BattleStoryCommitChapter<CardSnapshot> = {
    id: input.operationId, sessionId: session.id, index: generated.chapterIndex, action, status: 'active',
    ...(action === 'continue' && session.lastChapterId ? { sourceChapterId: session.lastChapterId } : {}),
    ...(generated.generationId ? { generationId: generated.generationId } : {}),
    title, markdown: generated.markdown, reportJson: generated.reportJson ?? {},
    ...(generated.cardSnapshot ? { cardSnapshot: generated.cardSnapshot } : {}),
    deterministicDigest: generated.digest, createdAt: now,
  };
  const checkpoints: BattleStoryCommitCheckpoint[] = [];
  if (action === 'start') checkpoints.push({
    id: input.initialCheckpointId!, sessionId: session.id, boundaryIndex: 0,
    combatants: input.inputCombatants, createdAt: now,
  });
  checkpoints.push({
    id: input.checkpointId, sessionId: session.id, boundaryIndex: generated.chapterIndex,
    chapterId: chapter.id, combatants: generated.nextWorkingCombatants, createdAt: now,
  });
  return {
    session: {
      ...session, source: input.source,
      title: action === 'start' || session.title === '未命名连续战报'
        ? generated.digest.chapterTitle || session.title : session.title,
      workingCombatants: generated.nextWorkingCombatants, lastChapterInputCombatants: input.inputCombatants,
      lastChapterId: chapter.id, chapterCount: previousCount + 1, updatedAt: now,
    },
    chapter, checkpoints,
  };
};

/** Web retains its content-identity CAS while consuming the same record assembly as Native. */
export const buildCompletedBattleStoryCommit = <S extends BattleStoryCommitSession, CardSnapshot = object>(
  input: BuildCompletedBattleStoryRecordsInput<S, CardSnapshot> & { expected: BattleStoryCommitExpected | null },
): BattleStoryCompletedCommit<S, CardSnapshot> => {
  const previousCount = input.action === 'start' ? 0 : input.session.chapterCount;
  if (!Number.isSafeInteger(previousCount) || previousCount < 0
    || (input.action === 'start' ? input.expected !== null || !input.initialCheckpointId : !input.expected)) {
    throw new Error('完成章与预期会话位置不一致，未保存本章。');
  }
  return {
    version: 1, operationId: input.operationId, action: input.action, expected: input.expected,
    ...buildCompletedBattleStoryRecords(input),
  };
};

/** Shared relationship rules, used by the real Web writer before opening any transaction. */
export const assertCompletedBattleStoryCommit = (commit: BattleStoryCompletedCommit): void => {
  const { session, chapter, checkpoints, expected } = commit;
  if (commit.version !== 1 || !['start', 'continue'].includes(commit.action)
    || !commit.operationId || commit.operationId !== chapter.id
    || chapter.sessionId !== session.id || chapter.action !== commit.action || chapter.status !== 'active'
    || session.lastChapterId !== chapter.id || session.chapterCount !== chapter.index
    || !Number.isSafeInteger(chapter.index) || chapter.index < 1
    || new Set(checkpoints.map((checkpoint) => checkpoint.id)).size !== checkpoints.length
    || checkpoints.some((checkpoint) => !checkpoint.id || checkpoint.sessionId !== session.id)
    || (commit.action === 'start'
      ? expected !== null || chapter.index !== 1 || checkpoints.length !== 2 || checkpoints[0]?.boundaryIndex !== 0 || Boolean(checkpoints[0]?.chapterId)
      : !expected || chapter.index !== expected.checkpointBoundary + 1 || checkpoints.length !== 1
        || chapter.sourceChapterId !== expected.activeChapterHeads.at(-1)?.id)) {
    throw new Error('完成章提交关系无效，未保存本章。');
  }
  const output = checkpoints.at(-1)!;
  if (output.boundaryIndex !== chapter.index || output.chapterId !== chapter.id
    || digestBattleStoryCommitValue(output.combatants) !== digestBattleStoryCommitValue(session.workingCombatants)
    || (commit.action === 'start'
      && digestBattleStoryCommitValue(checkpoints[0]!.combatants) !== digestBattleStoryCommitValue(session.lastChapterInputCombatants ?? []))) {
    throw new Error('完成章与角色快照不一致，未保存本章。');
  }
};

export type BattleStorySaveEvidence = 'not-written' | 'unknown';
/** Historical uncertainty is monotonic for one operation; only a matching receipt or a new operation clears it. */
export const advanceBattleStorySaveEvidence = (
  previous: BattleStorySaveEvidence | undefined,
  failedAttempt: BattleStorySaveEvidence,
): BattleStorySaveEvidence => previous === 'unknown' ? 'unknown' : failedAttempt;

/** Freeze the already-owned JSON graph; do not duplicate potentially large combatants/checkpoints. */
export const freezeBattleStoryCommit = <T>(value: T): T => {
  const seen = new Set<object>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    for (const key of Object.keys(item)) visit(jsonProperty(item, key));
    Object.freeze(item);
  };
  visit(value);
  return value;
};

export const createBattleStoryCommitReceipt = (commit: BattleStoryCompletedCommit): BattleStoryCommitReceipt => ({
  version: 1, operationId: commit.operationId, sessionId: commit.session.id,
  chapterId: commit.chapter.id, chapterIndex: commit.chapter.index, chapterCount: commit.session.chapterCount,
  checkpointIds: commit.checkpoints.map((checkpoint) => checkpoint.id),
  contentDigest: digestBattleStoryCommitValue(commit),
});
