import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import fixture from '@mahoshojo/contracts/fixtures/desktop-magic-tea-party.json';
import { TeaReadResponseSchema, TeaWriteResponseSchema, TeaSessionDocumentSchema, TeaWriteRequestSchema, TeaReadRequestSchema, type TeaWriteRequest } from '@mahoshojo/contracts/desktop-magic-tea-party';
import { createIpcTeaNativePort, TEA_STORAGE_COMMANDS } from '../src/platform/magic-tea-party-native';

const createRequest = (): TeaWriteRequest => ({ version: 1, request: { action: 'create', session: TeaSessionDocumentSchema.parse(fixture.session) } });
const createResponse = () => ({ version: 1, result: { action: 'create', sessionId: fixture.session.id, instance: fixture.instance, revision: 1 } });
const readRequest = () => ({ version: 1 as const, request: { action: 'session' as const, sessionId: fixture.session.id, expectedCatalogRevision: null } });
const readResponse = () => ({ version: 1, result: { action: 'session', catalogRevision: 1, record: { instance: fixture.instance, revision: 1, session: fixture.session } } });

describe('Tea two-command Native adapter', () => {
  it('validates closed requests and actual response relationships', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(createResponse()).mockResolvedValueOnce(readResponse());
    const port = createIpcTeaNativePort(invoke);
    expect(await port.mutate(createRequest())).toEqual(createResponse());
    expect(await port.read(readRequest())).toEqual(readResponse());
    expect(invoke.mock.calls).toEqual([[TEA_STORAGE_COMMANDS.mutate, { request: createRequest() }], [TEA_STORAGE_COMMANDS.read, { request: readRequest() }]]);
  });
  it('rejects unsupported scalar text before dispatch and preserves input', async () => {
    const invoke = vi.fn(); const port = createIpcTeaNativePort(invoke);
    const session = { ...TeaSessionDocumentSchema.parse(fixture.session), title: '\ud800' };
    await expect(port.mutate({ version: 1, request: { action: 'create', session } })).rejects.toMatchObject({ code: 'tea-invalid', writeEvidence: 'not-written' });
    expect(invoke).not.toHaveBeenCalled(); expect(session.title).toBe('\ud800');
  });
  it.each([null, { ...createResponse(), result: { ...createResponse().result, sessionId: 'wrong' } }, { ...createResponse(), result: { ...createResponse().result, instance: 'not-an-instance' } }])('retains uncertainty after a write received an invalid result', async result => {
    const invoke = vi.fn().mockResolvedValue(result);
    await expect(createIpcTeaNativePort(invoke).mutate(createRequest())).rejects.toMatchObject({ writeEvidence: 'unknown' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('keeps unknown transport failures distinct from checked pre-commit errors', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('private synthetic detail')).mockRejectedValueOnce({ code: 'tea-stale', message: 'Local tea storage did not complete; retain the input or unsaved result', writeEvidence: 'not-written' });
    const port = createIpcTeaNativePort(invoke);
    await expect(port.mutate(createRequest())).rejects.toMatchObject({ code: 'tea-io', writeEvidence: 'unknown' });
    await expect(port.mutate(createRequest())).rejects.toMatchObject({ code: 'tea-stale', writeEvidence: 'not-written' });
  });
  it('never treats an unrelated read response as the requested session', async () => {
    const wrong = readResponse(); wrong.result.record.session = { ...fixture.session, id: 'another-session' };
    await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue(wrong)).read(readRequest())).rejects.toMatchObject({ code: 'tea-invalid', writeEvidence: 'not-written' });
  });
  const wire = process.env.MAGIC_TEA_PARTY_NATIVE_WIRE_OUTPUT;
  it.skipIf(!wire)('consumes source-matched actual Rust Tea storage output through the real bridge', async () => {
    const fromRust = (name: string): unknown => JSON.parse(readFileSync(path.join(wire!, `${name}.json`), 'utf8'));
    const imported = TeaWriteResponseSchema.parse(fromRust('import'));
    const session = TeaReadResponseSchema.parse(fromRust('session'));
    const messages = TeaReadResponseSchema.parse(fromRust('messages'));
    expect(imported.result.action).toBe('import');
    expect(session.result.action).toBe('session');
    expect(messages.result.action).toBe('messages');
    const invoke = vi.fn().mockResolvedValueOnce(fromRust('session')).mockResolvedValueOnce(fromRust('messages')).mockResolvedValueOnce(fromRust('list'));
    const port = createIpcTeaNativePort(invoke);
    const loaded = await port.read(readRequest());
    if (loaded.result.action !== 'session' || !loaded.result.record) throw new Error('Expected real Native session record');
    expect(loaded.result.record.session).toEqual(fixture.session);
    const rows = await port.read({ version: 1, request: { action: 'messages', sessionId: fixture.session.id, instance: loaded.result.record.instance, expectedRevision: loaded.result.record.revision, cursor: null, expectedCatalogRevision: loaded.result.catalogRevision, limit: 100 } });
    if (rows.result.action !== 'messages') throw new Error('Expected real Native messages');
    expect(rows.result.rows.map(row => row.message)).toEqual(fixture.messages);
    const listed = await port.read({ version: 1, request: { action: 'list', cursor: null, expectedCatalogRevision: null, limit: 50 } });
    expect(listed.result.action).toBe('list');
    const receipt = TeaReadResponseSchema.parse(fromRust('receipt'));
    expect(receipt.result.action).toBe('receipt');
    const actual = vi.fn(); const storage = createIpcTeaNativePort(actual);
    for (const name of ['import', 'begin', 'finish']) {
      actual.mockResolvedValueOnce(fromRust(name));
      const original = TeaWriteRequestSchema.parse(fromRust(`${name}-request`));
      expect(await storage.mutate(original)).toEqual(fromRust(name));
      const prefix = name === 'import' ? 'receipt' : `${name}-receipt`;
      actual.mockResolvedValueOnce(fromRust(prefix));
      expect(await storage.read(TeaReadRequestSchema.parse(fromRust(`${prefix}-request`)))).toEqual(fromRust(prefix));
    }
    actual.mockRejectedValueOnce(fromRust('stale-error'));
    await expect(storage.mutate(TeaWriteRequestSchema.parse(fromRust('stale-request')))).rejects.toMatchObject({ code: 'tea-stale', writeEvidence: 'not-written' });
  });
});

describe('Tea exact receipt and catalog correlation', () => {
  it('rejects a syntactically valid write with the wrong revision', async () => {
    const result = { ...createResponse(), result: { ...createResponse().result, revision: 2 } };
    await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue(result)).mutate(createRequest())).rejects.toMatchObject({ writeEvidence: 'unknown' });
  });
  it('requires the queried export catalog revision even for a missing session', async () => {
    const request = { ...readRequest(), request: { ...readRequest().request, expectedCatalogRevision: 3 } };
    await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue({ version: 1, result: { action: 'session', catalogRevision: 2, record: null } })).read(request)).rejects.toMatchObject({ code: 'tea-invalid' });
  });
  it.each(['session', 'instance', 'assistant', 'revision', 'inner-operation'])('rejects a receipt with unrelated %s', async field => {
    const original: TeaWriteRequest = { version: 1, request: { action: 'begin-generation', sessionId: fixture.session.id, instance: fixture.instance, expectedRevision: 1, operationId: 'begin-a', session: TeaSessionDocumentSchema.parse(fixture.session), userMessage: null, assistantMessage: { id: 'assistant-new', sessionId: fixture.session.id, role: 'assistant', content: '', createdAt: 3, status: 'streaming' } } };
    const result = { action: 'begin-generation', operationId: 'begin-a', sessionId: fixture.session.id, instance: fixture.instance, revision: 2, assistantMessageId: 'assistant-new' };
    if (field === 'session') result.sessionId = 'other';
    if (field === 'instance') result.instance = '2'.repeat(32);
    if (field === 'assistant') result.assistantMessageId = 'other';
    if (field === 'revision') result.revision = 1;
    if (field === 'inner-operation') result.operationId = 'other';
    const reply = { version: 1, result: { action: 'receipt', receipt: { operationId: 'begin-a', digest: 'a'.repeat(64), result } } };
    await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue(reply)).read({ version: 1, request: { action: 'receipt', write: original } })).rejects.toMatchObject({ code: 'tea-invalid' });
  });
});

it('requires organization receipts to match every frozen identity and desired pin state', async () => {
  const target = { sessionId: 'a', instance: fixture.instance, expectedRevision: 2 };
  const pin: TeaWriteRequest = { version: 1, request: { action: 'set-pin', ...target, operationId: 'pin', pinned: false } };
  const pinResult = { version: 1, result: { action: 'set-pin', sessionId: 'a', instance: fixture.instance, revision: 3, operationId: 'pin', pinnedAt: 1, pinnedOrder: 1 } };
  await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue(pinResult)).mutate(pin)).rejects.toMatchObject({ writeEvidence: 'unknown' });
  const cleanup: TeaWriteRequest = { version: 1, request: { action: 'delete-selected', operationId: 'cleanup', targets: [target] } };
  const deleted = { version: 1, result: { action: 'delete-selected', operationId: 'cleanup', sessions: [{ sessionId: 'a', instance: fixture.instance, revision: 2 }] } };
  expect(await createIpcTeaNativePort(vi.fn().mockResolvedValue(deleted)).mutate(cleanup)).toEqual(deleted);
  for (const row of [{ ...deleted.result.sessions[0], instance: 'b'.repeat(32) }, { ...deleted.result.sessions[0], revision: 3 }, { ...deleted.result.sessions[0], sessionId: 'b' }]) {
    await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue({ ...deleted, result: { ...deleted.result, sessions: [row] } })).mutate(cleanup)).rejects.toMatchObject({ writeEvidence: 'unknown' });
  }
});

describe('Tea fork result relationship', () => {
  const request: TeaWriteRequest = { version: 1, request: { action: 'fork', operationId: 'fork', sessionId: 'source', instance: fixture.instance,
    expectedRevision: 7, anchorMessageId: 'anchor', editedContent: '分支', targetSessionId: 'child' } };
  const result = { action: 'fork', operationId: 'fork', sessionId: 'child', instance: 'a'.repeat(32), revision: 1 };
  it('accepts only the new child identity, including on original receipt reads', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ version: 1, result }).mockResolvedValueOnce({ version: 1,
      result: { action: 'receipt', receipt: { operationId: 'fork', digest: 'b'.repeat(64), result } } });
    const port = createIpcTeaNativePort(invoke);
    expect((await port.mutate(request)).result).toEqual(result);
    expect((await port.read({ version: 1, request: { action: 'receipt', write: request } })).result.action).toBe('receipt');
  });
  it.each([{ sessionId: 'source' }, { instance: fixture.instance }, { operationId: 'other' }, { revision: 8 }])('rejects unrelated child receipts: %j', async patch => {
    const invoke = vi.fn().mockResolvedValue({ version: 1, result: { ...result, ...patch } });
    await expect(createIpcTeaNativePort(invoke).mutate(request)).rejects.toMatchObject({ writeEvidence: 'unknown' });
  });
});

describe('Tea merge exact dual-target correlation', () => {
  const source = { sessionId: 'child', instance: 'a'.repeat(32), expectedRevision: 2 };
  const parent = { sessionId: 'parent', instance: 'b'.repeat(32), expectedRevision: 5 };
  const request: TeaWriteRequest = { version: 1, request: { action: 'merge', operationId: 'merge-1', source, parent, anchorMessageId: 'anchor', editedMessageId: 'edited' } };
  const result = { action: 'merge', operationId: 'merge-1', sessionId: 'parent', instance: parent.instance, revision: 6,
    source: { sessionId: 'child', instance: source.instance, revision: 2 } };
  it('accepts exact dual identities in direct and historical receipt responses', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ version: 1, result }).mockResolvedValueOnce({ version: 1,
      result: { action: 'receipt', receipt: { operationId: 'merge-1', digest: '0'.repeat(64), result } } });
    const port = createIpcTeaNativePort(invoke);
    expect((await port.mutate(request)).result).toEqual(result);
    expect((await port.read({ version: 1, request: { action: 'receipt', write: request } })).result.action).toBe('receipt');
  });
  it.each([{ sessionId: 'child' }, { instance: source.instance }, { revision: 5 }, { operationId: 'other' },
    { source: { ...result.source, sessionId: 'other' } }, { source: { ...result.source, instance: parent.instance } }, { source: { ...result.source, revision: 3 } }])('rejects mismatched merge evidence %j', async patch => {
    const changed = { ...result, ...patch };
    await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue({ version: 1, result: changed })).mutate(request)).rejects.toMatchObject({ writeEvidence: 'unknown' });
    await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue({ version: 1, result: { action: 'receipt', receipt: {
      operationId: 'merge-1', digest: '0'.repeat(64), result: changed,
    } } })).read({ version: 1, request: { action: 'receipt', write: request } })).rejects.toMatchObject({ code: 'tea-invalid' });
  });
  it.each([{ sessionId: 'other' }, { instance: parent.instance }, { expectedRevision: 3 }])('rejects a preview for another source snapshot %j', async patch => {
    const result = { action: 'merge-preview', source: { ...source, ...patch }, parent, sourceTitle: '分支', parentTitle: '父会话',
      anchorMessageId: 'anchor', editedMessageId: 'edited', anchorPreview: '原文', editedPreview: '修改', replacedMessageCount: 1, copiedMessageCount: 1 };
    await expect(createIpcTeaNativePort(vi.fn().mockResolvedValue({ version: 1, result })).read({ version: 1, request: { action: 'merge-preview', source } })).rejects.toMatchObject({ code: 'tea-invalid', writeEvidence: 'not-written' });
  });
});
