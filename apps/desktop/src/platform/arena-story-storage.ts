import {
  STORY_CANDIDATE_COMMIT_BYTES, STORY_CANDIDATE_FRAME_BYTES, STORY_CANDIDATE_PAGE_BYTES,
  StoryAppendOutcomeSchema, StoryBeginOutcomeSchema, StoryChapterDocumentSchema, StoryChapterPageSchema,
  StoryCheckpointDocumentSchema, StoryCommitManifestSchema, StoryContinueDescriptorsSchema, StoryReceiptSchema,
  StoryRecordDescriptorSchema, StorySeedDocumentSchema, StorySessionDocumentSchema, StorySessionPageSchema, StoryNativeFailureSchema,
  type StoryCommitManifest, type StoryPartKind, type StoryReceipt, type StoryRecordDescriptor, type StoryRecordKind,
  type StorySessionHead, type StorySessionDocument, type StoryChapterDocument,
  type StorySessionPage, type StoryChapterPage,
  StoryMarkdownExportManifestSchema, StoryMarkdownExportBeginSchema, StoryMarkdownExportAppendSchema, StoryMarkdownExportOutcomeSchema,
  type StoryMarkdownExportManifest, type StoryMarkdownExportOutcome,
} from '@mahoshojo/contracts/desktop-arena-story';
import {
  advanceBattleStorySaveEvidence, BattleStoryCommitByteLimitError, digestBattleStoryCommitValue, createBattleStoryByteDigest,
  iterateBattleStoryCommitJsonUtf8, prepareBattleStoryCommitJson, freezeBattleStoryCommit,
  type BattleStoryCommitSession, type BattleStoryCommitChapter, type BattleStoryCommitCheckpoint,
  type BattleStorySaveEvidence,
} from '@mahoshojo/domain/arena-story-commit';

import { projectBattleStoryPromptWindowItem, type BattleStoryPromptWindowItem } from '@mahoshojo/domain/arena-battle-story-session';
import { createBattleStoryExportMarkdownWriter, projectBattleStoryExportChapter, type BattleStoryMarkdownPart } from '@mahoshojo/domain/arena-story-export';

/** Native story feature boundary. The concrete Tauri binder is kept separate from
 * storage assembly so transport tests and actual product callers use identical logic.
 * Ports are explicit feature operations; neither callers nor tests supply SQL or paths.
 */
export interface StoryNativePort {
  begin(manifest: StoryCommitManifest): Promise<unknown>;
  append(token: string, kind: StoryPartKind, offset: number, bytes: Uint8Array): Promise<unknown>;
  end(token: string): Promise<unknown>;
  abort(token: string): Promise<void>;
  receipt(sessionId: string, operationId: string): Promise<unknown>;
  listSessions(cursor: StorySessionPage['nextCursor'], limit: number): Promise<unknown>;
  listChapters(sessionId: string, revision: number, cursor: StoryChapterPage['nextCursor'], limit: number): Promise<unknown>;
  describe(sessionId: string, revision: number, kind: StoryRecordKind, recordId: string): Promise<unknown>;
  read(descriptor: StoryRecordDescriptor, offset: number, length: number): Promise<Uint8Array>;
  continueState(sessionId: string, revision: number, expectedHead: string): Promise<unknown>;
}

type PreparedJson = ReturnType<typeof prepareBattleStoryCommitJson>;
export type PreparedStoryCommit = Readonly<{
  manifest: StoryCommitManifest; wireDigest: string; byteLength: number;
  parts: ReadonlyArray<Readonly<{ kind: StoryPartKind; prepared: PreparedJson }>>;
}>;

const plain = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('故事记录无效');
  return value as Record<string, unknown>;
};
const encoder = new TextEncoder();
const titlePreview = (title: string): { titlePreview: string; titleTruncated: boolean } => {
  let result = ''; let bytes = 0; let consumed = 0;
  for (const character of title) {
    const encoded = encoder.encode(character);
    if (bytes + encoded.byteLength > 192) break;
    // Lone surrogate replacement applies ONLY to the preview; full title bytes remain unchanged.
    result += new TextDecoder().decode(encoded); bytes += encoded.byteLength; consumed += character.length;
  }
  return { titlePreview: result, titleTruncated: consumed < title.length };
};
const sourceWithoutSecrets = (source: object): Record<string, unknown> => {
  const record = plain(source);
  const keys = ['mode', 'language', 'storyLength', 'customStoryLength', 'generationMode', 'providerMode', 'providerId', 'modelId'] as const;
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
};
const hashBytes = async (bytes: Uint8Array): Promise<string> => {
  const buffer = Uint8Array.from(bytes).buffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};
export const storyWireDigest = async (manifest: StoryCommitManifest): Promise<string> => {
  const checked = StoryCommitManifestSchema.parse(manifest);
  const decoder = new TextDecoder();
  // Only the fixed small manifest is joined, never a story record or commit body.
  const canonical = Array.from(iterateBattleStoryCommitJsonUtf8(checked), (bytes) => decoder.decode(bytes)).join('');
  return hashBytes(encoder.encode(`arena-story-wire-v1\n${canonical}`));
};

/** Native projection of the actual shared completed records. No copied plot/effect algorithm.
 * The caller owns this completed graph. Preflight counts the exact final stored records,
 * before parsing/clone/IPC, and every sender chunk reads the same recursively frozen graph.
 */
export const prepareStoryStorageCommit = async (input: {
  session: BattleStoryCommitSession; chapter: BattleStoryCommitChapter; checkpoints: BattleStoryCommitCheckpoint[];
  expectedRevision: number; expectedLastChapterId: string | null; lastInputCheckpointId?: string;
}, maxBytes = STORY_CANDIDATE_COMMIT_BYTES): Promise<PreparedStoryCommit> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > STORY_CANDIDATE_COMMIT_BYTES) throw new Error('无效的候选保存预算');
  const { session, chapter, checkpoints, expectedRevision, expectedLastChapterId } = input;
  const start = expectedRevision === 0;
  if (chapter.sessionId !== session.id || chapter.id !== session.lastChapterId || chapter.index !== session.chapterCount
    || chapter.action !== (start ? 'start' : 'continue') || chapter.status !== 'active'
    || (start ? chapter.index !== 1 || expectedLastChapterId !== null || checkpoints.length !== 2 : checkpoints.length !== 1 || chapter.sourceChapterId !== expectedLastChapterId)
    || checkpoints.some((checkpoint) => checkpoint.sessionId !== session.id)
    || checkpoints.at(-1)?.boundaryIndex !== chapter.index || checkpoints.at(-1)?.chapterId !== chapter.id
    || (start && (checkpoints[0]?.boundaryIndex !== 0 || checkpoints[0]?.chapterId))) throw new Error('完成章与保存位置不一致');
  const output = checkpoints.at(-1)!;
  if (new Set(checkpoints.map((checkpoint) => checkpoint.id)).size !== checkpoints.length) throw new Error('故事检查点身份重复');
  const lastInputCheckpointId = start ? checkpoints[0]!.id : input.lastInputCheckpointId;
  if (!lastInputCheckpointId) throw new Error('缺少本章输入检查点身份');
  const { seed, workingCombatants, lastChapterInputCombatants, ...rest } = session;
  const source = sourceWithoutSecrets(session.source);
  const sessionDocument = {
    ...rest, source, revision: expectedRevision + 1, ...titlePreview(session.title), mode: source.mode,
    workingCheckpointId: output.id, lastInputCheckpointId,
  };
  const chapterDocument = { ...chapter, ...titlePreview(chapter.title), markdownByteLength: encoder.encode(chapter.markdown).byteLength };
  const values: Array<[StoryPartKind, unknown]> = [[ 'session', sessionDocument ]];
  if (start) values.push(['seed', seed]);
  values.push(['chapter', chapterDocument]);
  if (start) values.push(['checkpoint0', checkpoints[0]]);
  values.push(['checkpoint1', output]);
  let byteLength = 0;
  const parts = values.map(([kind, value]) => {
    let prepared;
    try { prepared = prepareBattleStoryCommitJson(value, maxBytes - byteLength); }
    catch (cause) {
      if (cause instanceof BattleStoryCommitByteLimitError) throw new BattleStoryCommitByteLimitError(maxBytes, byteLength + cause.observedBytes);
      throw cause;
    }
    byteLength += prepared.byteLength;
    return { kind, prepared };
  });
  // Compare the exact logical inputs without cloning the expanded post-battle graph.
  if (digestBattleStoryCommitValue(workingCombatants) !== digestBattleStoryCommitValue(output.combatants)
    || (start && digestBattleStoryCommitValue(lastChapterInputCombatants ?? []) !== digestBattleStoryCommitValue(checkpoints[0]!.combatants))) throw new Error('故事角色检查点不一致');
  // Shallow carrier schemas retain unknown JSON extensions; their parsed copies are
  // not sent. Validation and sender refer to the same preflighted value graph.
  for (const { kind, prepared } of parts) {
    const schema = kind === 'session' ? StorySessionDocumentSchema : kind === 'seed' ? StorySeedDocumentSchema
      : kind === 'chapter' ? StoryChapterDocumentSchema : StoryCheckpointDocumentSchema;
    schema.parse(prepared.value);
  }
  const manifest = StoryCommitManifestSchema.parse({
    version: 1, operationId: chapter.id, sessionId: session.id, expectedRevision, expectedLastChapterId,
    parts: parts.map(({ kind, prepared }) => ({ kind, byteLength: prepared.byteLength, digest: prepared.contentDigest })),
  });
  return freezeBattleStoryCommit({ manifest, wireDigest: await storyWireDigest(manifest), byteLength, parts });
};

export class StorySaveError extends Error {
  constructor(message: string, readonly evidence: BattleStorySaveEvidence, readonly cause?: unknown) { super(message); this.name = 'StorySaveError'; }
}
const exactReceipt = (value: unknown, commit: PreparedStoryCommit): StoryReceipt => {
  const receipt = StoryReceiptSchema.parse(value);
  const output = plain(commit.parts.at(-1)!.prepared.value);
  if (receipt.operationId !== commit.manifest.operationId || receipt.sessionId !== commit.manifest.sessionId
    || receipt.chapterId !== commit.manifest.operationId || receipt.wireDigest !== commit.wireDigest
    || receipt.revision !== commit.manifest.expectedRevision + 1 || receipt.chapterIndex !== output.boundaryIndex
    || receipt.chapterCount !== output.boundaryIndex
    || receipt.checkpointIds.join('\n') !== commit.parts.filter((part) => part.kind.startsWith('checkpoint')).map((part) => plain(part.prepared.value).id).join('\n')) throw new Error('保存回执与原提交不一致');
  return receipt;
};
export const queryStoryCommitReceipt = async (port: StoryNativePort, commit: PreparedStoryCommit): Promise<StoryReceipt | null> => {
  const result = await port.receipt(commit.manifest.sessionId, commit.manifest.operationId);
  return result === null ? null : exactReceipt(result, commit);
};
/** Only local upload/save is retried. This layer has no model execution dependency.
 * Once any end outcome is unknown, callers retain unknown evidence until an exact
 * receipt resolves it; query failure, missing receipt or a later failed attempt cannot erase it.
 */
export const savePreparedStoryCommit = async (port: StoryNativePort, commit: PreparedStoryCommit, previousEvidence?: BattleStorySaveEvidence): Promise<StoryReceipt> => {
  let token: string | undefined;
  let endAttempted = false;
  try {
    const existing = await queryStoryCommitReceipt(port, commit);
    if (existing) return existing;
    if (previousEvidence === 'unknown') throw new StorySaveError('原操作尚无可核对的回执，继续保留保存待确认状态', 'unknown');
    const begun = StoryBeginOutcomeSchema.parse(await port.begin(commit.manifest)); token = begun.token;
    if (begun.totalBytes !== commit.byteLength) throw new Error('暂存长度声明不一致');
    for (const { kind, prepared } of commit.parts) {
      let offset = 0;
      for (const bytes of prepared.chunks(STORY_CANDIDATE_FRAME_BYTES)) {
        const appended = StoryAppendOutcomeSchema.parse(await port.append(token, kind, offset, bytes));
        offset += bytes.byteLength;
        if (appended.token !== token || appended.kind !== kind || appended.receivedBytes !== offset) throw new Error('暂存帧回执不一致');
      }
      if (offset !== prepared.byteLength) throw new Error('暂存原件长度不一致');
    }
    endAttempted = true;
    const result = await port.end(token);
    return exactReceipt(result, commit);
  } catch (cause) {
    const nativeFailure = StoryNativeFailureSchema.safeParse(cause);
    const knownNotWritten = nativeFailure.success && nativeFailure.data.writeEvidence === 'not-written';
    // An exception after dispatching end may be a lost successful receipt. Query first;
    // never automatically rebuild IDs, retry a model or label it safely not-written.
    if (endAttempted) {
      try { const receipt = await queryStoryCommitReceipt(port, commit); if (receipt) return receipt; } catch { /* retain original uncertainty */ }
    }
    const evidence = advanceBattleStorySaveEvidence(previousEvidence, endAttempted && !knownNotWritten ? 'unknown' : 'not-written');
    throw new StorySaveError(evidence === 'unknown' ? '本章保存结果待确认，请查询原操作结果' : '本章尚未保存，请保留完整结果', evidence, cause);
  } finally {
    if (token) { try { await port.abort(token); } catch { /* temporary storage is not a saved result; native expiry/restart reclaims it */ } }
  }
};

// Zod validates carrier fields but reconstructs objects and may drop an own
// "__proto__" JSON extension. Return the validated original, never that normalized copy.
const validateOriginal = <T>(schema: { parse(value: unknown): T }, value: unknown): T => {
  schema.parse(value);
  return value as T;
};

const readRecord = async (port: StoryNativePort, descriptor: StoryRecordDescriptor, signal?: AbortSignal): Promise<unknown> => {
  const checked = StoryRecordDescriptorSchema.parse(descriptor);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const hash = createBattleStoryByteDigest(); const strings: string[] = [];
  let offset = 0;
  while (offset < checked.byteLength) {
    signal?.throwIfAborted();
    const expected = Math.min(STORY_CANDIDATE_FRAME_BYTES, checked.byteLength - offset);
    const bytes = await port.read(checked, offset, expected);
    signal?.throwIfAborted();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected) throw new Error('故事读取帧长度不符');
    // Exact raw-byte checksum; release each frame instead of retaining a full binary copy.
    hash.update(bytes); strings.push(decoder.decode(bytes, { stream: true })); offset += bytes.byteLength;
  }
  strings.push(decoder.decode());
  const text = strings.join('');
  if (hash.digest() !== checked.digest) throw new Error('故事原件摘要不符');
  return JSON.parse(text) as unknown;
};
const boundedPage = <T>(value: T): T => {
  // This is a summary-only bounded DTO, never a full record.
  if (encoder.encode(JSON.stringify(value)).byteLength > STORY_CANDIDATE_PAGE_BYTES) throw new Error('故事目录页超限');
  return value;
};
export const listStorySessions = async (port: StoryNativePort, cursor: StorySessionPage['nextCursor'] = null): Promise<StorySessionPage> => (
  boundedPage(StorySessionPageSchema.parse(await port.listSessions(cursor, 25)))
);
export const listStoryChapters = async (port: StoryNativePort, head: StorySessionHead, cursor: StoryChapterPage['nextCursor'] = null): Promise<StoryChapterPage> => {
  const page = boundedPage(StoryChapterPageSchema.parse(await port.listChapters(head.id, head.revision, cursor, 25)));
  if (page.sessionId !== head.id || page.revision !== head.revision) throw new Error('章节目录已过时');
  return page;
};
export const readSelectedStoryChapter = async (port: StoryNativePort, head: StorySessionHead, chapterId: string, signal?: AbortSignal): Promise<StoryChapterDocument> => {
  const descriptor = StoryRecordDescriptorSchema.parse(await port.describe(head.id, head.revision, 'chapter', chapterId));
  if (descriptor.kind !== 'chapter' || descriptor.recordId !== chapterId || descriptor.sessionId !== head.id || descriptor.revision !== head.revision) throw new Error('选章读取身份不符');
  const chapter = validateOriginal(StoryChapterDocumentSchema, await readRecord(port, descriptor, signal));
  if (chapter.id !== chapterId || chapter.sessionId !== head.id || chapter.index > head.chapterCount) throw new Error('章节原件身份不符');
  return chapter;
};
export const readStoryContinueState = async (port: StoryNativePort, head: StorySessionHead, signal?: AbortSignal) => {
  const result = StoryContinueDescriptorsSchema.parse(await port.continueState(head.id, head.revision, head.lastChapterId));
  if (result.head.id !== head.id || result.head.revision !== head.revision || result.head.lastChapterId !== head.lastChapterId) throw new Error('续写会话已变化');
  for (const descriptor of [result.session, result.seed, result.checkpoint, ...result.recentChapters]) {
    if (descriptor.sessionId !== head.id || descriptor.revision !== head.revision) throw new Error('续写读取身份不符');
  }
  if (result.session.kind !== 'session' || result.seed.kind !== 'seed' || result.checkpoint.kind !== 'checkpoint'
    || result.session.recordId !== head.id || result.seed.recordId !== head.id) throw new Error('续写记录类型不符');
  const session = validateOriginal(StorySessionDocumentSchema, await readRecord(port, result.session, signal));
  const seed = validateOriginal(StorySeedDocumentSchema, await readRecord(port, result.seed, signal));
  const checkpoint = validateOriginal(StoryCheckpointDocumentSchema, await readRecord(port, result.checkpoint, signal));
  if (session.id !== head.id || session.revision !== head.revision || session.lastChapterId !== head.lastChapterId
    || session.workingCheckpointId !== checkpoint.id || checkpoint.boundaryIndex !== head.chapterCount || checkpoint.chapterId !== head.lastChapterId) throw new Error('续写检查点不符');
  const recentWindow: BattleStoryPromptWindowItem[] = [];
  for (const descriptor of result.recentChapters) {
    if (descriptor.kind !== 'chapter') throw new Error('续写章节类型不符');
    const chapter = validateOriginal(StoryChapterDocumentSchema, await readRecord(port, descriptor, signal));
    if (chapter.sessionId !== head.id || chapter.id !== descriptor.recordId || chapter.index !== head.chapterCount - result.recentChapters.length + recentWindow.length + 1) throw new Error('续写章节序列不符');
    recentWindow.push(projectBattleStoryPromptWindowItem(chapter, recentWindow.length < result.recentChapters.length - 2 ? 'digest' : 'full', 6000));
  }
  if (recentWindow.at(-1)?.chapterId !== head.lastChapterId) throw new Error('续写末章不符');
  return { session, seed, checkpoint, recentWindow };
};

/** Full committed-story traversal, independent of the visible directory page.
 * The caller streams each chapter into the shared Markdown writer / native export.
 * Missing, duplicate, out-of-order, stale or truncated enumeration fails explicitly.
 */
export async function* readAllCommittedStoryChapters(port: StoryNativePort, head: StorySessionHead, signal?: AbortSignal): AsyncGenerator<StoryChapterDocument> {
  let cursor: StoryChapterPage['nextCursor'] = null; let count = 0; let lastId: string | undefined;
  do {
    signal?.throwIfAborted();
    const page: StoryChapterPage = await listStoryChapters(port, head, cursor);
    if (page.rows.length === 0 && page.nextCursor) throw new Error('章节目录未前进');
    for (const row of page.rows) {
      if (row.index !== count + 1 || count >= head.chapterCount) throw new Error('完整导出章节序列不符');
      const chapter = await readSelectedStoryChapter(port, head, row.id, signal);
      if (chapter.index !== row.index) throw new Error('完整导出章节身份不符');
      yield chapter; count += 1; lastId = chapter.id;
    }
    if (page.nextCursor && (page.nextCursor.index !== count || page.nextCursor.id !== lastId)) throw new Error('章节目录游标不符');
    cursor = page.nextCursor;
  } while (cursor);
  if (count !== head.chapterCount || lastId !== head.lastChapterId) throw new Error('未读取完整已提交故事，不能标记导出成功');
}

export const readStorySessionDocument = async (port: StoryNativePort, head: StorySessionHead, signal?: AbortSignal): Promise<StorySessionDocument> => {
  const descriptor = StoryRecordDescriptorSchema.parse(await port.describe(head.id, head.revision, 'session', head.id));
  if (descriptor.kind !== 'session' || descriptor.recordId !== head.id || descriptor.sessionId !== head.id || descriptor.revision !== head.revision) throw new Error('故事读取身份不符');
  const session = validateOriginal(StorySessionDocumentSchema, await readRecord(port, descriptor, signal));
  if (session.id !== head.id || session.revision !== head.revision || session.chapterCount !== head.chapterCount || session.lastChapterId !== head.lastChapterId) throw new Error('故事原件身份不符');
  return session;
};


/** Chunks are written into an uncommitted native export, then published only after
 * this generator completes its full count/head verification. Never expose a partial
 * file as a successful full-story export. Pending unsaved chapters are not included. */
async function* committedStoryMarkdownParts(port: StoryNativePort, head: StorySessionHead, signal?: AbortSignal): AsyncGenerator<BattleStoryMarkdownPart> {
  const session = await readStorySessionDocument(port, head, signal);
  const writer = createBattleStoryExportMarkdownWriter(session, head.chapterCount);
  yield writer.header;
  for await (const chapter of readAllCommittedStoryChapters(port, head, signal)) {
    yield* writer.writeChapterParts(projectBattleStoryExportChapter(chapter));
  }
}
function* encodeStoryMarkdownPart(part: BattleStoryMarkdownPart, signal?: AbortSignal): Generator<Uint8Array> {
  if (typeof part !== 'string') {
    const spaces = new Uint8Array(Math.min(part.spaces, 64 * 1024)).fill(32);
    for (let left = part.spaces; left > 0; left -= spaces.byteLength) {
      if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
      yield left >= spaces.byteLength ? spaces : spaces.subarray(0, left);
    }
    return;
  }
  for (let offset = 0; offset < part.length;) {
    if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
    let end = Math.min(offset + 64 * 1024, part.length);
    if (end < part.length && /[\uD800-\uDBFF]/u.test(part[end - 1]!)) end -= 1;
    yield encoder.encode(part.slice(offset, end)); offset = end;
  }
}
export async function* streamCommittedStoryMarkdown(port: StoryNativePort, head: StorySessionHead, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  for await (const part of committedStoryMarkdownParts(port, head, signal)) yield* encodeStoryMarkdownPart(part, signal);
}

export interface StoryMarkdownExportPort {
  begin(manifest: StoryMarkdownExportManifest): Promise<unknown>;
  append(token: string, offset: number, bytes: Uint8Array): Promise<unknown>;
  end(token: string, expectedDigest: string): Promise<unknown>;
  abort(token: string): Promise<void>;
}
export type StoryMarkdownExportProgress = Readonly<{ phase: 'counting' | 'writing'; bytes: number; totalBytes?: number }>;

/** Both passes consume the actual shared writer and the same revision/head.
 * Counting retains no full-story string, Blob, or per-chapter array. The renderer
 * never announces success before the native length/hash/head-checked publication.
 */
export const exportCommittedStoryMarkdown = async (
  port: StoryNativePort, sink: StoryMarkdownExportPort, head: StorySessionHead,
  options: { signal?: AbortSignal; onProgress?: (progress: StoryMarkdownExportProgress) => void } = {},
): Promise<StoryMarkdownExportOutcome> => {
  const { signal, onProgress } = options;
  const check = () => { if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError'); };
  let frames = 0;
  const yieldForCancel = async () => {
    if (++frames % 16 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    check();
  };
  check(); let expectedByteLength = 0;
  const count = (bytes: number) => {
    expectedByteLength += bytes;
    if (!Number.isSafeInteger(expectedByteLength)) throw new RangeError('完整导出字节数超出安全整数范围，原记录未修改');
    onProgress?.({ phase: 'counting', bytes: expectedByteLength });
  };
  onProgress?.({ phase: 'counting', bytes: 0 });
  for await (const part of committedStoryMarkdownParts(port, head, signal)) {
    if (typeof part !== 'string') { count(part.spaces); await yieldForCancel(); }
    else for (const bytes of encodeStoryMarkdownPart(part, signal)) { count(bytes.byteLength); await yieldForCancel(); }
  }
  // No depth-sized hashing before Native verifies available disk. Every record in
  // both passes is hash-checked against the same revision/instance-bound descriptor.
  const manifest = StoryMarkdownExportManifestSchema.parse({ sessionId: head.id, revision: head.revision,
    expectedHead: head.lastChapterId, chapterCount: head.chapterCount, expectedByteLength });
  let token: string | undefined;
  try {
    check();
    const begun = StoryMarkdownExportBeginSchema.parse(await sink.begin(manifest)); token = begun.token;
    if (begun.expectedByteLength !== expectedByteLength) throw new Error('导出声明回执不符');
    let offset = 0; const hash = createBattleStoryByteDigest();
    onProgress?.({ phase: 'writing', bytes: 0, totalBytes: expectedByteLength });
    for await (const bytes of streamCommittedStoryMarkdown(port, head, signal)) {
      check();
      const written = StoryMarkdownExportAppendSchema.parse(await sink.append(token, offset, bytes));
      offset += bytes.byteLength; hash.update(bytes);
      if (written.token !== token || written.receivedBytes !== offset || offset > expectedByteLength) throw new Error('导出帧回执不符');
      onProgress?.({ phase: 'writing', bytes: offset, totalBytes: expectedByteLength }); await yieldForCancel();
    }
    check();
    if (offset !== expectedByteLength) throw new Error('完整导出长度已变化');
    const outcome = StoryMarkdownExportOutcomeSchema.parse(await sink.end(token, hash.digest()));
    if (outcome.token !== token || outcome.byteLength !== expectedByteLength) throw new Error('导出完成回执不符');
    return outcome;
  } finally {
    if (token) { try { await sink.abort(token); } catch { /* idle expiry reclaims the unpublished temporary */ } }
  }
};
