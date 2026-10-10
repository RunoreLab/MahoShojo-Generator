import { z } from './zod';
import { jsonUtf8ByteLength, utf8ByteLimitedStringSchema } from './wire-size';
import { ARENA_COMPANION_PROTOCOL_VERSION } from './arena-companion';
import {
  DESKTOP_ARENA_HOSTED_LIMITS, DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION,
  DesktopArenaHostedCreateRequestSchema, DesktopArenaHostedGenerationIdSchema,
  DesktopArenaHostedRecoveryCredentialStateSchema, DesktopArenaHostedRecoveryPointerSchema,
  DesktopArenaHostedRequestIdSchema,
} from './desktop-arena-hosted';

/** Uses the existing Arena flight/control/detach commands; no new URL or credentials authority. */
export const DesktopArenaHostedJsonCreateRequestSchema = z.object({
  ...DesktopArenaHostedCreateRequestSchema.shape, operation: z.literal('create-json'),
}).strict().refine((value) => !(value.systemConfig && value.presetConfig), { message: 'funding selections are mutually exclusive' });
export type DesktopArenaHostedJsonCreateRequest = z.infer<typeof DesktopArenaHostedJsonCreateRequestSchema>;
const sequence = { requestId: DesktopArenaHostedRequestIdSchema, sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) };
export const DesktopArenaHostedJsonChannelEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('json-response'), ...sequence, status: z.number().int().min(100).max(599),
    generationId: DesktopArenaHostedGenerationIdSchema.optional(), generationRequestId: DesktopArenaHostedRequestIdSchema.optional(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(), recoveryCredentialState: DesktopArenaHostedRecoveryCredentialStateSchema,
  }).strict(),
  z.object({ kind: z.literal('json-fragment'), ...sequence, text: utf8ByteLimitedStringSchema(DESKTOP_ARENA_HOSTED_LIMITS.ipcTextBytes), final: z.boolean() }).strict(),
  z.object({ kind: z.literal('json-end'), ...sequence }).strict(),
]).refine((value) => jsonUtf8ByteLength(value) <= DESKTOP_ARENA_HOSTED_LIMITS.ipcEnvelopeBytes);
export type DesktopArenaHostedJsonChannelEvent = z.infer<typeof DesktopArenaHostedJsonChannelEventSchema>;

export const DesktopArenaHostedRecoveryPointerV2Schema = z.object({
  ...DesktopArenaHostedRecoveryPointerSchema.shape,
  version: z.literal(2), delivery: z.enum(['stream', 'non-stream']),
  protocolVersion: z.enum([DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION, ARENA_COMPANION_PROTOCOL_VERSION]),
}).strict().refine((value) => JSON.stringify(value).length <= DESKTOP_ARENA_HOSTED_LIMITS.recoveryPointerCodeUnits
  && (value.format === 'web' || value.webPackageRef === undefined)
  && (value.delivery === 'stream'
    ? value.protocolVersion === DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION
    : value.protocolVersion === ARENA_COMPANION_PROTOCOL_VERSION));
export type DesktopArenaHostedRecoveryPointerV2 = z.infer<typeof DesktopArenaHostedRecoveryPointerV2Schema>;
export const DesktopArenaHostedAnyRecoveryPointerSchema = z.union([DesktopArenaHostedRecoveryPointerSchema, DesktopArenaHostedRecoveryPointerV2Schema]);
export type DesktopArenaHostedAnyRecoveryPointer = z.infer<typeof DesktopArenaHostedAnyRecoveryPointerSchema>;
