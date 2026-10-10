import { sha256 } from '@noble/hashes/sha2.js';
import { DesktopArenaHostedStoryClientBodyIntentSchema, type DesktopArenaHostedStoryClientBodyIntent } from '@mahoshojo/contracts/desktop-arena-story-transport';
import type { DesktopArenaHostedSuccessTelemetry } from '@mahoshojo/contracts/desktop-arena-hosted';
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

/**
 * Narrow v1 creation-intent encoding, NOT JSON canonicalization or a server payload
 * hash. Fields are: domain NUL, story protocol NUL, 32 digest bytes, funding u8
 * (system=0/preset=1), provider/model (u32BE UTF-8 length + bytes), override mask
 * (tokens=1/temperature=2/thinking=4), then u32BE tokens, f64BE temperature,
 * thinking u8 (default=0/disabled=1/enabled=2), enabled effort u8
 * (absent=0/minimal=1/low=2/medium=3/high=4/xhigh=5/max=6).
 * The caller uses the existing trusted funding resolver; no catalog is copied here.
 */
export const encodeHostedStoryClientBodyIntent = (input: DesktopArenaHostedStoryClientBodyIntent): Uint8Array => {
  const checked = DesktopArenaHostedStoryClientBodyIntentSchema.parse(input);
  const funding = checked.funding ?? { mode: 'system' as const, providerId: 'system' as const, modelId: 'default' };
  // A hash of unresolved/trimmed identity could diverge from the Native resolver.
  if (funding.modelId !== funding.modelId.trim() || (input.funding && input.funding.modelId !== funding.modelId)) {
    throw new Error('故事创建摘要需要已归一的模型身份');
  }
  const encoder = new TextEncoder();
  const pieces: Uint8Array[] = [encoder.encode('desktop-arena-story-client-body-v1\0arena-story-v1\0')];
  const u8 = (value: number): void => { pieces.push(Uint8Array.of(value)); };
  const u32 = (value: number): void => {
    const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, false); pieces.push(bytes);
  };
  const text = (value: string): void => {
    const bytes = encoder.encode(value);
    // Native UTF-8 identity cannot represent lone UTF-16 surrogates. Never silently
    // replace them and collapse distinct model identities to U+FFFD.
    if (new TextDecoder().decode(bytes) !== value) throw new Error('故事创建摘要的模型身份不是有效 UTF-8');
    u32(bytes.byteLength); pieces.push(bytes);
  };
  pieces.push(Uint8Array.from(checked.inputDigest.slice(7).match(/../gu)!, (pair) => Number.parseInt(pair, 16)));
  u8(funding.mode === 'system' ? 0 : 1); text(funding.providerId); text(funding.modelId);
  const overrides = funding.generationOverrides;
  const tokens = overrides?.maxOutputTokens; const temperature = overrides?.temperature; const thinking = overrides?.thinking;
  u8((tokens === undefined ? 0 : 1) | (temperature === undefined ? 0 : 2) | (thinking === undefined ? 0 : 4));
  if (tokens !== undefined) u32(tokens);
  if (temperature !== undefined) {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, temperature === 0 ? 0 : temperature, false); pieces.push(bytes);
  }
  if (thinking) {
    u8(thinking.mode === 'default' ? 0 : thinking.mode === 'disabled' ? 1 : 2);
    if (thinking.mode === 'enabled') u8(thinking.effort === undefined ? 0
      : ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].indexOf(thinking.effort) + 1);
  }
  const result = new Uint8Array(pieces.reduce((size, bytes) => size + bytes.byteLength, 0));
  let offset = 0;
  for (const bytes of pieces) { result.set(bytes, offset); offset += bytes.byteLength; }
  return result;
};

/** Lowercase 64-hex digest, deliberately distinct from inputDigest's sha256: prefix. */
export const digestHostedStoryClientBodyIntent = (input: DesktopArenaHostedStoryClientBodyIntent): string => (
  digestHex(sha256(encodeHostedStoryClientBodyIntent(input))).slice(7)
);

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

/** Already-checked public content, with no application or platform runtime dependency. */
export type HostedStoryPendingContentInput = {
  inputUserGuidance?: string;
  reasoning: string;
  meta?: {
    event: 'meta' | 'meta_error';
    data: { parseOk: boolean; meta?: Record<string, unknown>; error?: string; raw?: string; rawTruncated?: boolean };
  };
  header?: {
    reporterInfo?: object; userGuidance?: string; characterGuidances?: readonly unknown[];
    adjudicationResults?: readonly unknown[]; narrativeHistoryReadCount?: number; scenarioDisplayName?: string;
  };
  telemetry?: DesktopArenaHostedSuccessTelemetry;
  workingCombatants: readonly object[];
  roleState: 'not-requested' | 'accepted' | 'old-roles';
  roleResponse?: {
    updatedCombatants: readonly { combatantIndex: number; data: Record<string, unknown>; isNative: boolean }[];
    warnings: readonly { code: string; message: string; combatantIndex?: number; rosterIndex?: number; characterName?: string | null }[];
  };
  fallbackReason?: 'http-failure' | 'user-kept-original';
};

/**
 * Project only content consumed by completed chapter/checkpoint records. The caller
 * owns and validates originals before this pure step, then feeds this result into
 * buildCompletedBattleStoryRecords and freezes the resulting owned graph. Preserve
 * all report extensions and original roster positions without duplicating carriers.
 */
export const projectHostedStoryPendingContent = (input: HostedStoryPendingContentInput) => {
  if (!['not-requested', 'accepted', 'old-roles'].includes(input.roleState)
    || (input.roleState === 'accepted') !== (input.roleResponse !== undefined)
    || (input.roleState === 'old-roles'
      ? !['http-failure', 'user-kept-original'].includes(input.fallbackReason ?? '')
      : input.fallbackReason !== undefined)) {
    throw new Error('故事角色同步结果尚未确定或降级原因无效，不能冻结本章。');
  }
  const nextWorkingCombatants = [...input.workingCombatants];
  const updatedIndexes = new Set<number>();
  for (const update of input.roleResponse?.updatedCombatants ?? []) {
    const index = update.combatantIndex;
    if (!Number.isSafeInteger(index) || index < 0 || index >= nextWorkingCombatants.length
      || updatedIndexes.has(index)) {
      throw new RangeError('故事角色同步索引越界或重复，不能冻结本章。');
    }
    updatedIndexes.add(index);
    nextWorkingCombatants[index] = { ...input.workingCombatants[index], data: update.data, isNative: update.isNative };
  }
  const { header, meta, telemetry } = input;
  if (header?.narrativeHistoryReadCount !== undefined && telemetry?.narrativeHistoryReadCount !== undefined
    && header.narrativeHistoryReadCount !== telemetry.narrativeHistoryReadCount) {
    throw new Error('故事响应头与遥测的叙事历史读取数不一致，不能冻结本章；原件保持不变。');
  }
  const narrativeHistoryReadCount = telemetry?.narrativeHistoryReadCount ?? header?.narrativeHistoryReadCount;
  const userGuidance = header?.userGuidance ?? input.inputUserGuidance;
  const cardSnapshot = {
    aiReasoning: { status: 'done' as const, source: 'provider' as const, text: input.reasoning },
    ...(header?.reporterInfo !== undefined ? { reporterInfo: header.reporterInfo } : {}),
    ...(userGuidance !== undefined ? { userGuidance } : {}),
    ...(header?.characterGuidances !== undefined ? { characterGuidances: header.characterGuidances } : {}),
    ...(header?.adjudicationResults !== undefined ? { adjudicationResults: header.adjudicationResults } : {}),
    ...(narrativeHistoryReadCount !== undefined ? { narrativeHistoryReadCount } : {}),
    ...(telemetry?.aiModel !== undefined ? { aiModel: telemetry.aiModel } : {}),
    ...(telemetry?.usage !== undefined ? { aiUsage: telemetry.usage } : {}),
    ...(header?.scenarioDisplayName !== undefined ? { scenarioDisplayName: header.scenarioDisplayName } : {}),
    ...(meta ? { streamUpdateMetaDebug: {
      source: 'sse' as const, parseOk: meta.data.parseOk,
      ...(meta.data.error !== undefined ? { error: meta.data.error } : {}),
      ...(meta.data.raw !== undefined ? { raw: meta.data.raw } : {}),
      ...(meta.data.rawTruncated !== undefined ? { rawTruncated: meta.data.rawTruncated } : {}),
    } } : {}),
    storyRoleSync: {
      version: 1 as const, state: input.roleState, warnings: input.roleResponse?.warnings ?? [],
      ...(input.roleState === 'old-roles' ? { reason: input.fallbackReason! } : {}),
    },
  };
  return {
    reportJson: meta?.event === 'meta' && meta.data.parseOk ? meta.data.meta ?? {} : {},
    cardSnapshot,
    nextWorkingCombatants,
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
