import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import {
  TeaReadRequestSchema, TeaReadResponseSchema, TeaStorageErrorSchema,
  TeaWriteRequestSchema, TeaWriteResponseSchema,
  type TeaReadRequest, type TeaReadResponse, type TeaWriteRequest, type TeaWriteResponse,
} from '@mahoshojo/contracts/desktop-magic-tea-party';

export const TEA_STORAGE_COMMANDS = { read: 'read_magic_tea_party', mutate: 'mutate_magic_tea_party' } as const;
export type TeaStorageInvoke = (_command: string, _args: Record<string, unknown>) => Promise<unknown>;
export class TeaStorageError extends Error {
  readonly code: string;
  readonly writeEvidence: 'not-written' | 'unknown';
  constructor(code: string, writeEvidence: 'not-written' | 'unknown') {
    super('本地茶会操作未完成，请保留输入或未保存结果');
    this.name = 'TeaStorageError'; this.code = code; this.writeEvidence = writeEvidence;
  }
}
const failure = (error: unknown, dispatchedWrite: boolean): TeaStorageError => {
  const parsed = TeaStorageErrorSchema.safeParse(error);
  return parsed.success ? new TeaStorageError(parsed.data.code, parsed.data.writeEvidence)
    : new TeaStorageError('tea-io', dispatchedWrite ? 'unknown' : 'not-written');
};
export type TeaNativePort = {
  read: (_request: TeaReadRequest) => Promise<TeaReadResponse>;
  mutate: (_request: TeaWriteRequest) => Promise<TeaWriteResponse>;
};

const matchesMutation = (request: TeaWriteRequest['request'], result: TeaWriteResponse['result']): boolean => {
  if (request.action !== result.action) return false;
  if (request.action === 'merge' && result.action === 'merge') return result.operationId === request.operationId
    && result.sessionId === request.parent.sessionId && result.instance === request.parent.instance && result.revision === request.parent.expectedRevision + 1
    && result.source.sessionId === request.source.sessionId && result.source.instance === request.source.instance && result.source.revision === request.source.expectedRevision;
  if (request.action === 'fork' && result.action === 'fork') return result.operationId === request.operationId
    && result.sessionId === request.targetSessionId && result.instance !== request.instance && result.revision === 1;
  if (request.action === 'import' && result.action === 'import') return result.operationId === request.operationId
    && result.sessions.length === request.entries.length
    && new Set(result.sessions.map(row => row.instance)).size === result.sessions.length
    && result.sessions.every((row, index) => row.sessionId === request.entries[index]?.session.id && row.revision === 1);
  if (request.action === 'delete-selected' && result.action === 'delete-selected') return result.operationId === request.operationId
    && result.sessions.length === request.targets.length && result.sessions.every((row, index) => {
      const target = request.targets[index]; return target && row.sessionId === target.sessionId && row.instance === target.instance && row.revision === target.expectedRevision;
    });
  if (request.action === 'set-pin' && result.action === 'set-pin' && (request.pinned ? result.pinnedAt <= 0 || result.pinnedOrder <= 0 : result.pinnedAt !== 0 || result.pinnedOrder !== 0)) return false;
  if (!('sessionId' in result)) return false;
  const sessionId = request.action === 'create' ? request.session.id : 'sessionId' in request ? request.sessionId : undefined;
  const revision = request.action === 'create' ? 1 : 'expectedRevision' in request
    ? request.expectedRevision + (request.action === 'delete' ? 0 : 1) : undefined;
  return result.sessionId === sessionId && result.revision === revision
    && (!('instance' in request) || result.instance === request.instance)
    && (!('operationId' in request) || ('operationId' in result && result.operationId === request.operationId))
    && (!('assistantMessage' in request) || ('assistantMessageId' in result && result.assistantMessageId === request.assistantMessage.id));
};

/** Transport only. An old begin receipt never authorizes another model dispatch. */
export const createIpcTeaNativePort = (invoke: TeaStorageInvoke = tauriInvoke): TeaNativePort => ({
  read: async input => {
    const checked = TeaReadRequestSchema.safeParse(input);
    if (!checked.success) throw new TeaStorageError('tea-invalid', 'not-written');
    let raw: unknown;
    try { raw = await invoke(TEA_STORAGE_COMMANDS.read, { request: checked.data }); }
    catch (error) { throw failure(error, false); }
    const parsed = TeaReadResponseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.result.action !== checked.data.request.action) throw new TeaStorageError('tea-invalid', 'not-written');
    const request = checked.data.request; const result = parsed.data.result;
    if ('expectedCatalogRevision' in request && 'catalogRevision' in result && request.expectedCatalogRevision !== null && result.catalogRevision !== request.expectedCatalogRevision) throw new TeaStorageError('tea-invalid', 'not-written');
    if (request.action === 'merge-preview' && result.action === 'merge-preview'
      && (result.source.sessionId !== request.source.sessionId || result.source.instance !== request.source.instance
        || result.source.expectedRevision !== request.source.expectedRevision || result.parent.sessionId === result.source.sessionId)) throw new TeaStorageError('tea-invalid', 'not-written');
    if (request.action === 'list' && result.action === 'list' && (result.rows.length > request.limit || (request.cursor && result.catalogRevision !== request.cursor.catalogRevision))) throw new TeaStorageError('tea-invalid', 'not-written');
    if (request.action === 'session' && result.action === 'session' && result.record && result.record.session.id !== request.sessionId) throw new TeaStorageError('tea-invalid', 'not-written');
    if (request.action === 'messages' && result.action === 'messages' && (result.sessionId !== request.sessionId || result.instance !== request.instance || result.revision !== request.expectedRevision || result.rows.length > request.limit || result.rows.some((row, index) => row.message.sessionId !== request.sessionId || row.ordinal <= (index ? result.rows[index - 1]!.ordinal : request.cursor?.ordinal ?? 0)))) throw new TeaStorageError('tea-invalid', 'not-written');
    if (request.action === 'receipt' && result.action === 'receipt' && result.receipt) {
      const write = request.write.request;
      if (!('operationId' in write) || result.receipt.operationId !== write.operationId || !matchesMutation(write, result.receipt.result)) throw new TeaStorageError('tea-invalid', 'not-written');
    }
    return parsed.data;
  },
  mutate: async input => {
    const checked = TeaWriteRequestSchema.safeParse(input);
    if (!checked.success) throw new TeaStorageError('tea-invalid', 'not-written');
    let raw: unknown;
    try { raw = await invoke(TEA_STORAGE_COMMANDS.mutate, { request: checked.data }); }
    catch (error) { throw failure(error, true); }
    const parsed = TeaWriteResponseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.result.action !== checked.data.request.action) throw new TeaStorageError('tea-invalid', 'unknown');
    const request = checked.data.request; const result = parsed.data.result;
    if (!matchesMutation(request, result)) throw new TeaStorageError('tea-invalid', 'unknown');
    return parsed.data;
  },
});
