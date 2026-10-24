import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/desktop-magic-tea-party.json';
import { jsonUtf8ByteLength } from '../src/wire-size';
import {
  DESKTOP_TEA_LIMITS, TeaSessionDocumentSchema, TeaMessageDocumentSchema,
  TeaReadRequestSchema, TeaWriteRequestSchema, TeaReadResponseSchema, TeaStorageErrorSchema,
} from '../src/desktop-magic-tea-party';

const session = () => structuredClone(fixture.session);
const message = () => structuredClone(fixture.messages[1]);
const write = () => ({ version: 1, request: { action: 'import', operationId: 'import-a', entries: [{ session: session(), messages: fixture.messages }] } });
const placeholder = () => ({ id: 'assistant-a', sessionId: fixture.session.id, role: 'assistant', createdAt: 3, content: '', status: 'streaming' });
const maximumMessage = () => {
  const doc = { id: 'm', sessionId: 's', role: 'assistant', content: '', createdAt: 1, status: 'done' };
  doc.content = 'a'.repeat(DESKTOP_TEA_LIMITS.messageBytes - jsonUtf8ByteLength(doc));
  return doc;
};

describe('Desktop Tea closed local storage wire', () => {
  it('preserves real text fixture and unknown inert extensions', () => {
    expect(TeaSessionDocumentSchema.parse(session())).toEqual(fixture.session);
    expect(TeaMessageDocumentSchema.parse(message())).toEqual(fixture.messages[1]);
    expect(TeaWriteRequestSchema.parse(write())).toEqual(write());
    expect(TeaReadRequestSchema.parse({ version: 1, request: { action: 'receipt', write: write() } }).request.action).toBe('receipt');
  });
  it('does not silently strip unsafe JSON keys before the document gate', () => {
    for (const field of ['__proto__', 'constructor', 'prototype']) {
      const doc = { ...session(), future: JSON.parse(`{"${field}":{"payload":true}}`) };
      expect(TeaSessionDocumentSchema.safeParse(doc).success).toBe(false);
    }
  });
  it('rejects unsupported known media before writes', () => {
    expect(TeaSessionDocumentSchema.safeParse({ ...session(), tachieAssets: [] }).success).toBe(false);
    expect(TeaMessageDocumentSchema.safeParse({ ...message(), tachieId: 'image' }).success).toBe(false);
    expect(TeaSessionDocumentSchema.parse({ ...session(), roles: [{ ...session().roles[0], avatarUrl: 'https://synthetic.invalid/no-fetch' }] }).roles[0].avatarUrl).toBe('https://synthetic.invalid/no-fetch');
  });
  it.each(['\ud800', '\udfff'])('rejects a lone surrogate in value and key: %j', value => {
    expect(TeaMessageDocumentSchema.safeParse({ ...message(), content: value }).success).toBe(false);
    expect(TeaSessionDocumentSchema.safeParse({ ...session(), future: { [value]: true } }).success).toBe(false);
  });
  it('preserves paired scalars, JSON control escapes, and unnormalized user text', () => {
    const content = '🍵\u0001e\u0301';
    expect(TeaMessageDocumentSchema.parse({ ...message(), content }).content).toBe(content);
  });
  it('rejects executable or non-JSON data without invoking accessors', () => {
    let called = false;
    const unsafe = Object.defineProperty({}, 'hidden', { enumerable: true, get: () => { called = true; return 'secret'; } });
    for (const future of [unsafe, Infinity, undefined, new Date(0), () => undefined]) expect(TeaSessionDocumentSchema.safeParse({ ...session(), future }).success).toBe(false);
    expect(called).toBe(false);
  });
  it('closes operations, version, and host-selector fields', () => {
    expect(TeaWriteRequestSchema.safeParse({ ...write(), version: 2 }).success).toBe(false);
    expect(TeaWriteRequestSchema.safeParse({ version: 1, request: { action: 'create', session: session(), path: '/tmp/unrelated' } }).success).toBe(false);
    expect(TeaReadRequestSchema.safeParse({ version: 1, request: { action: 'sql', sql: 'SELECT 1' } }).success).toBe(false);
    expect(TeaReadRequestSchema.safeParse({ version: 1, request: { action: 'receipt', write: { version: 1, request: { action: 'create', session: session() } } } }).success).toBe(false);
  });
  it('admits only a minimal recoverable streaming placeholder', () => {
    const value = { version: 1, request: { action: 'begin-generation', sessionId: fixture.session.id, instance: fixture.instance, expectedRevision: 1, operationId: 'begin-a', session: session(), userMessage: null, assistantMessage: placeholder() } };
    expect(TeaWriteRequestSchema.safeParse(value).success).toBe(true);
    expect(TeaWriteRequestSchema.safeParse({ ...value, request: { ...value.request, assistantMessage: { ...placeholder(), meta: {} } } }).success).toBe(false);
  });
  it('rejects unsafe revision precision and non-progressing query limits', () => {
    const value = { version: 1, request: { action: 'messages', sessionId: fixture.session.id, instance: fixture.instance, expectedRevision: 1, cursor: null, expectedCatalogRevision: null, limit: 1 } };
    expect(TeaReadRequestSchema.safeParse(value).success).toBe(true);
    for (const expectedRevision of [0, Number.MAX_SAFE_INTEGER + 1, 1.5]) expect(TeaReadRequestSchema.safeParse({ ...value, request: { ...value.request, expectedRevision } }).success).toBe(false);
    expect(TeaReadRequestSchema.safeParse({ ...value, request: { ...value.request, limit: 0 } }).success).toBe(false);
  });
  it('accepts a message at the exact serialized byte limit', () => {
    const doc = maximumMessage();
    expect(jsonUtf8ByteLength(doc)).toBe(DESKTOP_TEA_LIMITS.messageBytes);
    expect(TeaMessageDocumentSchema.safeParse(doc).success).toBe(true);
  });
  it('rejects a message one byte above the serialized byte limit', () => {
    const doc = maximumMessage();
    expect(TeaMessageDocumentSchema.safeParse({ ...doc, content: `${doc.content}x` }).success).toBe(false);
  });
  it('fits a maximum-size message in a complete read response page', () => {
    const doc = maximumMessage();
    const page = { version: 1, result: { action: 'messages', catalogRevision: Number.MAX_SAFE_INTEGER, sessionId: 's', instance: fixture.instance, revision: Number.MAX_SAFE_INTEGER, rows: [{ ordinal: Number.MAX_SAFE_INTEGER, message: doc }], nextCursor: { ordinal: Number.MAX_SAFE_INTEGER, id: 'm' } } };
    expect(jsonUtf8ByteLength(page)).toBeLessThan(DESKTOP_TEA_LIMITS.pageBytes);
    expect(TeaReadResponseSchema.safeParse(page).success).toBe(true);
  });
  it('exposes fixed errors with honest commit uncertainty', () => {
    expect(TeaStorageErrorSchema.parse({ code: 'tea-commit-unknown', message: 'Local tea storage did not complete; retain the input or unsaved result', writeEvidence: 'unknown' }).writeEvidence).toBe('unknown');
    expect(TeaStorageErrorSchema.safeParse({ code: 'tea-io', message: '/private/path', writeEvidence: 'not-written' }).success).toBe(false);
  });
});

 describe('Tea organization closed operations', () => {
  const target = { sessionId: 'a', instance: fixture.instance, expectedRevision: 1 };
  it('admits desired pin and frozen unique selection receipts, not toggle or arbitrary patch', () => {
    for (const request of [{ action: 'set-pin', ...target, operationId: 'pin', pinned: true }, { action: 'delete-selected', operationId: 'delete', targets: [target] }]) {
      const write = { version: 1, request }; expect(TeaWriteRequestSchema.safeParse(write).success).toBe(true);
      expect(TeaReadRequestSchema.safeParse({ version: 1, request: { action: 'receipt', write } }).success).toBe(true);
    }
    for (const targets of [[], [target, target], Array.from({ length: 51 }, (_, i) => ({ ...target, sessionId: `s${i}` }))]) expect(TeaWriteRequestSchema.safeParse({ version: 1, request: { action: 'delete-selected', operationId: 'delete', targets } }).success).toBe(false);
    expect(TeaWriteRequestSchema.safeParse({ version: 1, request: { action: 'set-pin', ...target, operationId: 'pin', pinned: true, updatedAt: 99 } }).success).toBe(false);
  });
  it('requires all keyset fields and keeps malformed archive extensions inert', () => {
    const cursor = { catalogRevision: 1, updatedAt: 1, id: 'a', pinnedAt: 0, pinnedOrder: 0 };
    const request = { action: 'list', limit: 50, expectedCatalogRevision: null, cursor };
    expect(TeaReadRequestSchema.safeParse({ version: 1, request }).success).toBe(true);
    expect(TeaReadRequestSchema.safeParse({ version: 1, request: { ...request, cursor: { ...cursor, pinnedOrder: 1 } } }).success).toBe(false);
    for (const pinnedAt of ['legacy', {}, null, -1, 1.2]) expect(TeaSessionDocumentSchema.parse({ ...session(), pinnedAt }).pinnedAt).toEqual(pinnedAt);
  });
});

describe('Desktop Tea user-message fork wire', () => {
  const fork = () => ({ version: 1, request: { action: 'fork', operationId: 'fork-1', sessionId: fixture.session.id,
    instance: fixture.instance, expectedRevision: 1, anchorMessageId: 'user-a', editedContent: '新话题 🍵', targetSessionId: 'child' } });
  it('accepts the narrow command and original-operation receipt query', () => {
    expect(TeaWriteRequestSchema.parse(fork())).toEqual(fork());
    expect(TeaReadRequestSchema.parse({ version: 1, request: { action: 'receipt', write: fork() } }).request.action).toBe('receipt');
  });
  it('rejects empty edits, same target, client-selected IDs/timestamps and invalid CAS', () => {
    for (const patch of [{ editedContent: ' \n\t' }, { editedContent: '\ud800' }, { targetSessionId: fixture.session.id },
      { expectedRevision: 0 }, { instance: 'old' }, { messages: [] }, { createdAt: 1 }, { newMessageId: 'new' }]) {
      expect(TeaWriteRequestSchema.safeParse({ ...fork(), request: { ...fork().request, ...patch } }).success).toBe(false);
    }
  });
});

describe('Desktop Tea reviewed dual-target merge wire', () => {
  const source = { sessionId: 'child', instance: 'a'.repeat(32), expectedRevision: 2 };
  const parent = { sessionId: 'parent', instance: 'b'.repeat(32), expectedRevision: 5 };
  const merge = () => ({ version: 1, request: { action: 'merge', operationId: 'merge-1', source, parent, anchorMessageId: 'anchor', editedMessageId: 'edited' } });
  it('accepts both exact targets and the original-operation receipt query', () => {
    expect(TeaWriteRequestSchema.parse(merge())).toEqual(merge());
    expect(TeaReadRequestSchema.parse({ version: 1, request: { action: 'receipt', write: merge() } }).request.action).toBe('receipt');
    expect(TeaReadRequestSchema.parse({ version: 1, request: { action: 'merge-preview', source } }).request.action).toBe('merge-preview');
  });
  it('rejects same parent/source, injected replacement content, missing anchors and ambiguous target extensions', () => {
    for (const patch of [{ parent: source }, { messages: [] }, { session: session() }, { summary: 'client override' }, { editedMessageId: '' },
      { anchorMessageId: undefined }, { source: { ...source, expectedRevision: 0 } }, { parent: { ...parent, path: '/arbitrary' } }, { source: { ...source, instance: 'old' } }]) {
      expect(TeaWriteRequestSchema.safeParse({ ...merge(), request: { ...merge().request, ...patch } }).success).toBe(false);
    }
    expect(TeaReadRequestSchema.safeParse({ version: 1, request: { action: 'merge-preview', source, parent } }).success).toBe(false);
  });
  it('bounds titles, text previews and affected counts without accepting full message bodies', () => {
    const result = { action: 'merge-preview', source, parent, sourceTitle: '分支', parentTitle: '父会话', anchorPreview: '原文', editedPreview: '修改',
      anchorMessageId: 'anchor', editedMessageId: 'edited', replacedMessageCount: 1, copiedMessageCount: 1 };
    expect(TeaReadResponseSchema.safeParse({ version: 1, result }).success).toBe(true);
    for (const patch of [{ sourceTitle: 'x'.repeat(193) }, { editedPreview: '\ud800' }, { copiedMessageCount: 0 }, { replacedMessageCount: 10_001 }, { messages: [] }]) {
      expect(TeaReadResponseSchema.safeParse({ version: 1, result: { ...result, ...patch } }).success).toBe(false);
    }
  });
});
