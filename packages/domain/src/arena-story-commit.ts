import { sha256 } from '@noble/hashes/sha2.js';
import type { BattleStoryDeterministicDigest } from './arena-battle-story-session';

/** V1 is SHA-256 over sorted-key JSON, not a hash of chunk hashes. */
export const digestBattleStoryCommitValue = (value: unknown, stringChunkSize = 8_192): string => {
  const hash = sha256.create();
  const ancestors = new Set<object>();
  const chunkSize = Number.isSafeInteger(stringChunkSize) && stringChunkSize >= 2 ? stringChunkSize : 8_192;
  const encoder = new TextEncoder();
  const text = (part: string) => { hash.update(encoder.encode(part)); };
  const string = (value: string) => {
    text('"');
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(offset + chunkSize, value.length);
      // A surrogate pair must be encoded together, even across an arbitrary chunk boundary.
      if (end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1]!)) end -= 1;
      text(JSON.stringify(value.slice(offset, end)).slice(1, -1));
      offset = end;
    }
    text('"');
  };
  const visit = (current: unknown): void => {
    if (current === null) { text('null'); return; }
    if (typeof current === 'string') { string(current); return; }
    if (typeof current === 'boolean') { text(current ? 'true' : 'false'); return; }
    if (typeof current === 'number' && Number.isFinite(current)) { text(JSON.stringify(current)); return; }
    if (typeof current !== 'object' || current === null) throw new Error('故事提交包含非 JSON 值');
    if (ancestors.has(current)) throw new Error('故事提交包含循环引用');
    ancestors.add(current);
    if (Array.isArray(current)) {
      text('[');
      for (let index = 0; index < current.length; index += 1) {
        if (index) text(',');
        // Match JSON.stringify: array holes/undefined become null; object undefined is omitted.
        visit(current[index] === undefined ? null : current[index]);
      }
      text(']');
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new Error('故事提交包含非 JSON 对象');
      const record = current as Record<string, unknown>;
      text('{');
      let first = true;
      for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) continue;
        if (!first) text(',');
        first = false;
        string(key); text(':'); visit(record[key]);
      }
      text('}');
    }
    ancestors.delete(current);
  };
  visit(value);
  return `sha256:${Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
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

/** No time, IDs, storage, model calls or platform effects inside the shared assembly rule.
 * Keep generated content even when its announced index is invalid: validate at save time, after the host retains it.
 */
export const buildCompletedBattleStoryCommit = <S extends BattleStoryCommitSession, CardSnapshot = object>(input: {
  action: 'start' | 'continue'; session: S; expected: BattleStoryCommitExpected | null;
  operationId: string; checkpointId: string; initialCheckpointId?: string; now: number;
  source: S['source']; inputCombatants: unknown[];
  generated: {
    chapterIndex: number; markdown: string; reportJson: Record<string, unknown>;
    digest: BattleStoryDeterministicDigest; generationId?: string | null; cardSnapshot?: CardSnapshot | null;
    nextWorkingCombatants: unknown[];
  };
}): BattleStoryCompletedCommit<S, CardSnapshot> => {
  const { generated, session, action, now } = input;
  const previousCount = action === 'start' ? 0 : session.chapterCount;
  if (!Number.isSafeInteger(previousCount) || previousCount < 0
    || (action === 'start' ? input.expected !== null || !input.initialCheckpointId : !input.expected)) {
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
    version: 1, operationId: input.operationId, action, expected: input.expected,
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
    for (const child of Object.values(item)) visit(child);
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
