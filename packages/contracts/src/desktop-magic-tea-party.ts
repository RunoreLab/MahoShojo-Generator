import { z } from './zod';
import { JsonValueSchema } from './json-value';
import { jsonUtf8ByteLength, utf8ByteLength } from './wire-size';

/** Local product admission limits, not guarantees for arbitrary Web archives. */
export const DESKTOP_TEA_LIMITS = {
  messageBytes: 32 * 1024 * 1024,
  sessionBytes: 8 * 1024 * 1024,
  writeBytes: 64 * 1024 * 1024,
  receiptReadBytes: 64 * 1024 * 1024 + 1024,
  pageBytes: 33 * 1024 * 1024,
  directoryBytes: 128 * 1024,
  documentNodes: 2_000_000,
  envelopeNodes: 4_000_000,
  depth: 64,
  importSessions: 128,
  importMessages: 10_000,
  directoryRows: 50,
  messageRows: 100,
} as const;

const scalarText = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};

/** Keep unknown extensions as inert JSON. Never spread them into AI or host options. */
const boundedJson = (input: unknown, maxBytes: number, maxNodes: number, maxDepth: number = DESKTOP_TEA_LIMITS.depth): boolean => {
  if (!JsonValueSchema.safeParse(input).success) return false;
  const stack = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > maxNodes || depth > maxDepth) return false;
    if (typeof value === 'string' && !scalarText(value)) return false;
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (!scalarText(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) return false;
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return jsonUtf8ByteLength(input) <= maxBytes;
};
const data = z.record(z.string(), z.unknown());
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const instance = z.string().regex(/^[a-f0-9]{32}$/u);
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const revision = integer.min(1);
const preview = z.string().refine(value => scalarText(value) && utf8ByteLength(value) <= 192);
const source = z.enum(['local', 'cloud', 'public', 'tavern', 'random', 'preset']);
const role = z.object({ id, name: z.string(), source, card: data }).passthrough();
const scenario = z.object({ id, title: z.string(), source, card: data }).passthrough();
const choice = z.object({ id: z.string(), text: z.string() }).passthrough();
const segment = z.discriminatedUnion('type', [
  z.object({ type: z.literal('narration'), text: z.string() }).passthrough(),
  z.object({ type: z.literal('dialogue'), speakerId: z.string(), speakerName: z.string().optional(), text: z.string() }).passthrough(),
  z.object({ type: z.literal('choices'), items: z.array(choice) }).passthrough(),
]);

const sessionShape = z.object({
  id, title: z.string(), createdAt: integer, updatedAt: integer,
  roles: z.array(role), scenario: scenario.optional(), auxScenarios: z.array(scenario).optional(),
  settings: z.object({ providerId: z.string(), modelId: z.string() }).passthrough(),
  summary: z.string().optional(), summarySections: z.record(z.string(), z.string()).optional(),
  summaryMeta: data.optional(), protocolShadow: data.optional(), updateSnapshot: data.optional(),
  forkedFrom: z.object({ sessionId: id, messageId: id, createdAt: integer }).passthrough().optional(),
  lastChoices: z.array(choice).optional(), draft: z.string().optional(),
  tachieAssets: z.never().optional(),
}).passthrough();
export const TeaSessionDocumentSchema = z.preprocess((value, context) => {
  if (!boundedJson(value, DESKTOP_TEA_LIMITS.sessionBytes, DESKTOP_TEA_LIMITS.documentNodes)) { context.addIssue({ code: 'custom', message: 'Tea session exceeds the local JSON boundary' }); return z.NEVER; }
  return value;
}, sessionShape);
const messageShape = z.object({
  id, sessionId: id, role: z.enum(['user', 'assistant', 'system']), content: z.string(), createdAt: integer,
  status: z.enum(['streaming', 'done', 'error', 'blocked']).optional(),
  segments: z.array(segment).optional(), choices: z.array(choice).optional(),
  sourceMessageId: id.optional(), revisionOf: id.optional(),
  error: z.object({ code: z.string(), message: z.string() }).passthrough().optional(),
  meta: data.optional(), tachieId: z.never().optional(),
}).passthrough();
export const TeaMessageDocumentSchema = z.preprocess((value, context) => {
  if (!boundedJson(value, DESKTOP_TEA_LIMITS.messageBytes, DESKTOP_TEA_LIMITS.documentNodes)) { context.addIssue({ code: 'custom', message: 'Tea message exceeds the local JSON boundary' }); return z.NEVER; }
  return value;
}, messageShape);

const generationPlaceholder = TeaMessageDocumentSchema.refine(value => value.role === 'assistant' && value.status === 'streaming' && value.content === ''
  && Object.keys(value).length === 6 && ['id', 'sessionId', 'role', 'content', 'createdAt', 'status'].every(key => Object.hasOwn(value, key)), 'Generation placeholders contain only identity and empty content');

const target = { sessionId: id, instance, expectedRevision: revision };
const sessionTarget = z.object(target).strict();
const listCursor = z.object({ catalogRevision: revision, pinnedAt: integer, pinnedOrder: integer, updatedAt: integer, id }).strict().refine(value => value.pinnedAt > 0 || value.pinnedOrder === 0);
const messageCursor = z.object({ ordinal: revision, id }).strict();
const importEntry = z.object({ session: TeaSessionDocumentSchema, messages: z.array(TeaMessageDocumentSchema).max(DESKTOP_TEA_LIMITS.importMessages) }).strict();
const writeOperation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), session: TeaSessionDocumentSchema }).strict(),
  z.object({ action: z.literal('update'), ...target, session: TeaSessionDocumentSchema }).strict(),
  z.object({ action: z.literal('delete'), ...target }).strict(),
  z.object({ action: z.literal('fork'), ...target, operationId: id, anchorMessageId: id, editedContent: z.string().refine(value => value.trim().length > 0 && scalarText(value) && utf8ByteLength(value) <= DESKTOP_TEA_LIMITS.messageBytes), targetSessionId: id }).strict(),
  z.object({ action: z.literal('merge'), operationId: id, source: sessionTarget, parent: sessionTarget, anchorMessageId: id, editedMessageId: id }).strict(),
  z.object({ action: z.literal('set-pin'), ...target, operationId: id, pinned: z.boolean() }).strict(),
  z.object({ action: z.literal('delete-selected'), operationId: id, targets: z.array(z.object(target).strict()).min(1).max(DESKTOP_TEA_LIMITS.directoryRows) }).strict(),
  z.object({ action: z.literal('import'), operationId: id, entries: z.array(importEntry).min(1).max(DESKTOP_TEA_LIMITS.importSessions) }).strict(),
  z.object({ action: z.literal('begin-generation'), ...target, operationId: id, session: TeaSessionDocumentSchema, userMessage: TeaMessageDocumentSchema.nullable(), assistantMessage: generationPlaceholder }).strict(),
  z.object({ action: z.literal('finish-generation'), ...target, operationId: id, beginOperationId: id, session: TeaSessionDocumentSchema, assistantMessage: TeaMessageDocumentSchema }).strict(),
]);
export const TeaWriteRequestSchema = z.object({ version: z.literal(1), request: writeOperation }).strict()
  .refine(value => boundedJson({ request: value }, DESKTOP_TEA_LIMITS.writeBytes, DESKTOP_TEA_LIMITS.envelopeNodes), 'Tea write exceeds the local transport boundary')
  .superRefine(({ request }, context) => {
    const invalid = () => context.addIssue({ code: 'custom', message: 'Tea record identities or generation state disagree' });
    if (request.action === 'merge' && request.source.sessionId === request.parent.sessionId) invalid();
    if (request.action === 'fork' && request.sessionId === request.targetSessionId) invalid();
    if (request.action === 'delete-selected' && new Set(request.targets.map(row => row.sessionId)).size !== request.targets.length) invalid();
    if (request.action === 'import') {
      const sessions = new Set<string>(); const messages = new Set<string>(); let count = 0;
      for (const entry of request.entries) {
        if (sessions.has(entry.session.id)) invalid(); sessions.add(entry.session.id);
        for (const message of entry.messages) {
          if (messages.has(message.id) || message.sessionId !== entry.session.id || message.status === 'streaming') invalid();
          messages.add(message.id); count += 1;
        }
      }
      if (count > DESKTOP_TEA_LIMITS.importMessages) invalid();
    } else if ('sessionId' in request && 'session' in request && request.sessionId !== request.session.id) invalid();
    if (request.action === 'begin-generation' || request.action === 'finish-generation') {
      if (request.assistantMessage.sessionId !== request.sessionId || request.assistantMessage.role !== 'assistant') invalid();
      if (request.action === 'finish-generation' && !['done', 'error', 'blocked'].includes(request.assistantMessage.status ?? '')) invalid();
      if (request.action === 'begin-generation' && request.userMessage && (request.userMessage.sessionId !== request.sessionId || request.userMessage.role !== 'user' || request.userMessage.status === 'streaming' || request.userMessage.id === request.assistantMessage.id)) invalid();
    }
  });

const readOperation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('merge-preview'), source: sessionTarget }).strict(),
  z.object({ action: z.literal('list'), cursor: listCursor.nullable(), expectedCatalogRevision: revision.nullable(), limit: integer.min(1).max(DESKTOP_TEA_LIMITS.directoryRows) }).strict(),
  z.object({ action: z.literal('session'), sessionId: id, expectedCatalogRevision: revision.nullable() }).strict(),
  z.object({ action: z.literal('messages'), ...target, cursor: messageCursor.nullable(), expectedCatalogRevision: revision.nullable(), limit: integer.min(1).max(DESKTOP_TEA_LIMITS.messageRows) }).strict(),
  z.object({ action: z.literal('receipt'), write: TeaWriteRequestSchema.refine(value => ['import', 'begin-generation', 'finish-generation', 'set-pin', 'delete-selected', 'fork', 'merge'].includes(value.request.action)) }).strict(),
]);
export const TeaReadRequestSchema = z.object({ version: z.literal(1), request: readOperation }).strict()
  .refine(value => boundedJson({ request: value }, value.request.action === 'receipt' ? DESKTOP_TEA_LIMITS.receiptReadBytes : 4096, value.request.action === 'receipt' ? DESKTOP_TEA_LIMITS.envelopeNodes + 8 : 100, value.request.action === 'receipt' ? DESKTOP_TEA_LIMITS.depth + 4 : DESKTOP_TEA_LIMITS.depth), 'Tea read request exceeds the local transport boundary');

export const TeaHeadSchema = z.object({
  id, instance, revision, title: preview, titleTruncated: z.boolean(), createdAt: integer, updatedAt: integer,
  pinnedAt: integer, pinnedOrder: integer, messageCount: integer, roleNames: z.array(preview).max(8), roleCount: integer, scenarioTitle: preview.nullable(),
}).strict();
const saved = z.object({ sessionId: id, instance, revision }).strict();
const mutationResult = z.discriminatedUnion('action', [
  saved.extend({ action: z.literal('create'), revision: z.literal(1) }).strict(),
  saved.extend({ action: z.literal('update') }).strict(),
  saved.extend({ action: z.literal('delete') }).strict(),
  saved.extend({ action: z.literal('fork'), operationId: id, revision: z.literal(1) }).strict(),
  saved.extend({ action: z.literal('merge'), operationId: id, source: saved }).strict(),
  saved.extend({ action: z.literal('set-pin'), operationId: id, pinnedAt: integer, pinnedOrder: integer }).strict(),
  z.object({ action: z.literal('delete-selected'), operationId: id, sessions: z.array(saved).min(1).max(DESKTOP_TEA_LIMITS.directoryRows) }).strict(),
  z.object({ action: z.literal('import'), operationId: id, sessions: z.array(saved.extend({ revision: z.literal(1) })).min(1).max(DESKTOP_TEA_LIMITS.importSessions) }).strict(),
  saved.extend({ action: z.literal('begin-generation'), operationId: id, assistantMessageId: id }).strict(),
  saved.extend({ action: z.literal('finish-generation'), operationId: id, assistantMessageId: id }).strict(),
]);
export const TeaReceiptSchema = z.object({ operationId: id, digest: z.string().regex(/^[a-f0-9]{64}$/u), result: mutationResult }).strict()
  .refine(value => 'operationId' in value.result && value.result.operationId === value.operationId
    && ((value.result.action !== 'import' && value.result.action !== 'delete-selected') || (new Set(value.result.sessions.map(row => row.sessionId)).size === value.result.sessions.length
      && new Set(value.result.sessions.map(row => row.instance)).size === value.result.sessions.length)));
const readResult = z.discriminatedUnion('action', [
  z.object({ action: z.literal('merge-preview'), source: sessionTarget, parent: sessionTarget, anchorMessageId: id, editedMessageId: id,
    sourceTitle: preview, parentTitle: preview, anchorPreview: preview, editedPreview: preview, replacedMessageCount: integer.min(1).max(DESKTOP_TEA_LIMITS.importMessages), copiedMessageCount: integer.min(1).max(DESKTOP_TEA_LIMITS.importMessages) }).strict(),
  z.object({ action: z.literal('list'), catalogRevision: revision, rows: z.array(TeaHeadSchema).max(DESKTOP_TEA_LIMITS.directoryRows), nextCursor: listCursor.nullable() }).strict(),
  z.object({ action: z.literal('session'), catalogRevision: revision, record: z.object({ instance, revision, session: TeaSessionDocumentSchema }).strict().nullable() }).strict(),
  z.object({ action: z.literal('messages'), catalogRevision: revision, sessionId: id, instance, revision, rows: z.array(z.object({ ordinal: revision, message: TeaMessageDocumentSchema }).strict()).max(DESKTOP_TEA_LIMITS.messageRows), nextCursor: messageCursor.nullable() }).strict(),
  z.object({ action: z.literal('receipt'), receipt: TeaReceiptSchema.nullable() }).strict(),
]);
export const TeaReadResponseSchema = z.object({ version: z.literal(1), result: readResult }).strict()
  .refine(value => boundedJson(value, value.result.action === 'list' ? DESKTOP_TEA_LIMITS.directoryBytes : DESKTOP_TEA_LIMITS.pageBytes, DESKTOP_TEA_LIMITS.envelopeNodes, DESKTOP_TEA_LIMITS.depth + 4), 'Tea read exceeds the local transport boundary');
export const TeaWriteResponseSchema = z.object({ version: z.literal(1), result: mutationResult }).strict();
export const TeaStorageErrorSchema = z.object({
  code: z.enum(['tea-invalid', 'tea-too-large', 'tea-missing', 'tea-stale', 'tea-busy', 'tea-operation-mismatch', 'tea-corrupt', 'tea-io', 'tea-commit-unknown', 'maintenance-busy']),
  message: z.literal('Local tea storage did not complete; retain the input or unsaved result'),
  writeEvidence: z.enum(['not-written', 'unknown']),
}).strict();
export type TeaSessionDocument = z.infer<typeof TeaSessionDocumentSchema>;
export type TeaMessageDocument = z.infer<typeof TeaMessageDocumentSchema>;
export type TeaReadRequest = z.infer<typeof TeaReadRequestSchema>;
export type TeaWriteRequest = z.infer<typeof TeaWriteRequestSchema>;
export type TeaReadResponse = z.infer<typeof TeaReadResponseSchema>;
export type TeaWriteResponse = z.infer<typeof TeaWriteResponseSchema>;
export type TeaReceipt = z.infer<typeof TeaReceiptSchema>;
export type TeaHead = z.infer<typeof TeaHeadSchema>;
