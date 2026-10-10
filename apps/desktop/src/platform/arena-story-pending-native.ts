import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import {
  STORY_CANDIDATE_FRAME_BYTES, StoryBeginOutcomeSchema, StoryPendingKeySchema,
  StoryPendingManifestSchema, StoryPendingPartKindSchema, StoryPendingSaveRequestSchema,
  StoryPendingSaveAttemptRequestSchema, StoryReceiptSchema,
  type StoryPendingKey, type StoryPendingManifest, type StoryPendingPartKind,
} from '@mahoshojo/contracts/desktop-arena-story';
import { STORY_IPC, STORY_KIND_HEADER, STORY_OFFSET_HEADER, STORY_TOKEN_HEADER, type StoryInvoke } from './arena-story-native';

/** Storage-only operations. No model/role transport, active-slot discard or implicit
 * retry is exposed here. Saving consumes an explicit durable, single-use attempt;
 * an uncertain result is reconciled only through an exact receipt lookup. */
export const STORY_PENDING_IPC = {
  begin: 'begin_arena_story_pending', append: 'append_arena_story_pending_part',
  queryUpload: 'query_arena_story_pending_upload', seal: 'seal_arena_story_pending',
  abortUpload: 'abort_arena_story_pending_upload', describe: 'describe_arena_story_pending',
  read: 'read_arena_story_pending_chunk', prepareSave: 'prepare_arena_story_pending_save',
  save: 'save_arena_story_pending',
} as const;

/** Structured replies remain unknown until the caller validates the corresponding
 * shared schema AND all expected identities/digests. Neither a missing receipt nor
 * a new not-written error clears an earlier unknown save attempt. */
export interface StoryPendingNativePort {
  begin(manifest: StoryPendingManifest): Promise<unknown>;
  append(token: string, kind: StoryPendingPartKind, offset: number, bytes: Uint8Array): Promise<unknown>;
  queryUpload(token: string): Promise<unknown>;
  seal(token: string): Promise<unknown>;
  abortUpload(token: string): Promise<void>;
  describe(product: StoryPendingKey['product']): Promise<unknown>;
  read(key: StoryPendingKey, kind: StoryPendingPartKind, offset: number, length: number): Promise<Uint8Array>;
  prepareSave(key: StoryPendingKey, wireDigest: string): Promise<unknown>;
  save(key: StoryPendingKey, wireDigest: string, attemptId: string): Promise<unknown>;
  receipt(sessionId: string, operationId: string): Promise<unknown>;
}

const tokenSchema = StoryBeginOutcomeSchema.shape.token;
const checkFrame = (offset: number, length: number): void => {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length)
    || length < 1 || length > STORY_CANDIDATE_FRAME_BYTES || offset > Number.MAX_SAFE_INTEGER - length) {
    throw new Error('故事候选原件帧或位置无效');
  }
};

export const createIpcStoryPendingPort = (invoke: StoryInvoke = tauriInvoke): StoryPendingNativePort => ({
  begin: (manifest) => invoke(STORY_PENDING_IPC.begin, { manifest: StoryPendingManifestSchema.parse(manifest) }),
  append: (token, kind, offset, bytes) => {
    checkFrame(offset, bytes.byteLength);
    return invoke(STORY_PENDING_IPC.append, bytes, { headers: {
      [STORY_TOKEN_HEADER]: tokenSchema.parse(token), [STORY_KIND_HEADER]: StoryPendingPartKindSchema.parse(kind),
      [STORY_OFFSET_HEADER]: String(offset),
    } });
  },
  queryUpload: (token) => invoke(STORY_PENDING_IPC.queryUpload, { token: tokenSchema.parse(token) }),
  seal: (token) => invoke(STORY_PENDING_IPC.seal, { token: tokenSchema.parse(token) }),
  abortUpload: async (token) => { await invoke(STORY_PENDING_IPC.abortUpload, { token: tokenSchema.parse(token) }); },
  describe: (product) => invoke(STORY_PENDING_IPC.describe, { product: StoryPendingKeySchema.shape.product.parse(product) }),
  read: async (key, kind, offset, length) => {
    checkFrame(offset, length);
    const bytes = await invoke(STORY_PENDING_IPC.read, {
      key: StoryPendingKeySchema.parse(key), kind: StoryPendingPartKindSchema.parse(kind), offset, length,
    });
    if (!(bytes instanceof ArrayBuffer)) throw new Error('故事候选原件响应不是原始字节');
    if (bytes.byteLength === 0 || bytes.byteLength > length) throw new Error('故事候选原件响应帧超限');
    return new Uint8Array(bytes);
  },
  prepareSave: (key, wireDigest) => invoke(STORY_PENDING_IPC.prepareSave, StoryPendingSaveRequestSchema.parse({ key, wireDigest })),
  save: (key, wireDigest, attemptId) => invoke(STORY_PENDING_IPC.save, StoryPendingSaveAttemptRequestSchema.parse({ key, wireDigest, attemptId })),
  receipt: (sessionId, operationId) => invoke(STORY_IPC.receipt, {
    sessionId: StoryReceiptSchema.shape.sessionId.parse(sessionId), operationId: StoryReceiptSchema.shape.operationId.parse(operationId),
  }),
});
