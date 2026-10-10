import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { STORY_CANDIDATE_FRAME_BYTES } from '@mahoshojo/contracts/desktop-arena-story';
import type { StoryMarkdownExportPort, StoryNativePort } from './arena-story-storage';

/** Tauri raw bodies replace the structured argument object. Metadata is fixed,
 * ASCII-only headers; record reads return binary Response, never number[]/base64. */
export type StoryInvoke = (command: string, args?: Record<string, unknown> | Uint8Array,
  options?: { headers: Record<string, string> }) => Promise<unknown>;
export const STORY_IPC = {
  begin: 'begin_arena_story_commit', append: 'append_arena_story_part', end: 'end_arena_story_commit',
  abort: 'abort_arena_story_commit', receipt: 'query_arena_story_receipt',
  sessions: 'list_arena_story_sessions', chapters: 'list_arena_story_chapters',
  describe: 'describe_arena_story_record', read: 'read_arena_story_record_chunk', continueState: 'read_arena_story_continue_state',
  exportBegin: 'begin_arena_story_markdown_export', exportAppend: 'append_arena_story_markdown_export',
  exportEnd: 'end_arena_story_markdown_export', exportAbort: 'abort_arena_story_markdown_export',
} as const;
export const STORY_TOKEN_HEADER = 'x-story-token';
export const STORY_KIND_HEADER = 'x-story-part';
export const STORY_OFFSET_HEADER = 'x-story-offset';

const frame = (bytes: Uint8Array, offset: number): void => {
  if (!Number.isSafeInteger(offset) || offset < 0 || bytes.byteLength === 0 || bytes.byteLength > STORY_CANDIDATE_FRAME_BYTES) {
    throw new Error('故事原件帧或位置无效');
  }
};

export const createIpcStoryNativePort = (invoke: StoryInvoke = tauriInvoke): StoryNativePort => ({
  begin: (manifest) => invoke(STORY_IPC.begin, { manifest }),
  append: (token, kind, offset, bytes) => {
    frame(bytes, offset);
    return invoke(STORY_IPC.append, bytes, { headers: {
      [STORY_TOKEN_HEADER]: token, [STORY_KIND_HEADER]: kind, [STORY_OFFSET_HEADER]: String(offset),
    } });
  },
  end: (token) => invoke(STORY_IPC.end, { token }),
  abort: async (token) => { await invoke(STORY_IPC.abort, { token }); },
  receipt: (sessionId, operationId) => invoke(STORY_IPC.receipt, { sessionId, operationId }),
  listSessions: (cursor, limit) => invoke(STORY_IPC.sessions, { cursor, limit }),
  listChapters: (sessionId, revision, cursor, limit) => invoke(STORY_IPC.chapters, { sessionId, revision, cursor, limit }),
  describe: (sessionId, revision, kind, recordId) => invoke(STORY_IPC.describe, { sessionId, revision, kind, recordId }),
  read: async (descriptor, offset, length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > STORY_CANDIDATE_FRAME_BYTES) throw new Error('故事读取帧无效');
    const bytes = await invoke(STORY_IPC.read, { descriptor, offset, length });
    if (!(bytes instanceof ArrayBuffer)) throw new Error('故事原件响应不是原始字节');
    if (bytes.byteLength === 0 || bytes.byteLength > length) throw new Error('故事原件响应帧超限');
    return new Uint8Array(bytes);
  },
  continueState: (sessionId, revision, expectedHead) => invoke(STORY_IPC.continueState, { sessionId, revision, expectedHead }),
});

export const createIpcStoryMarkdownExportPort = (invoke: StoryInvoke = tauriInvoke): StoryMarkdownExportPort => ({
  begin: (manifest) => invoke(STORY_IPC.exportBegin, { manifest }),
  append: (token, offset, bytes) => {
    frame(bytes, offset);
    return invoke(STORY_IPC.exportAppend, bytes, { headers: { [STORY_TOKEN_HEADER]: token, [STORY_OFFSET_HEADER]: String(offset) } });
  },
  end: (token, expectedDigest) => invoke(STORY_IPC.exportEnd, { token, expectedDigest }),
  abort: async (token) => { await invoke(STORY_IPC.exportAbort, { token }); },
});
