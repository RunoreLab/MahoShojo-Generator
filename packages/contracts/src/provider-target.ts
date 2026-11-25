import { z } from './zod';
import { OpaqueKeySchema } from './primitives';

/** Identity is independent of execution location. Existing Profiles remain custom assets. */
export const ProviderPresetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/u);
export const ProviderTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('system') }).strict(),
  z.object({ kind: z.literal('preset'), providerId: ProviderPresetIdSchema }).strict(),
  z.object({ kind: z.literal('custom'), profileId: OpaqueKeySchema }).strict(),
]);
export type ProviderTarget = z.infer<typeof ProviderTargetSchema>;

const ChatGptConnectionIdSchema = z.string().regex(/^[a-f0-9]{32}$/u);
export const ChatGptPlanTargetSchema = z.object({
  kind: z.literal('chatgpt-plan'),
  connectionId: ChatGptConnectionIdSchema,
}).strict();
export const DesktopProviderTargetSchema = z.discriminatedUnion('kind', [
  ...ProviderTargetSchema.options,
  ChatGptPlanTargetSchema,
]);
export type DesktopProviderTarget = z.infer<typeof DesktopProviderTargetSchema>;

/** New choices use the Web limit. Existing Profile documents retain their legacy limit. */
export const PROVIDER_MODEL_ID_MAX_LENGTH = 200;
export const ProviderModelIdSchema = z.string().trim().min(1).max(PROVIDER_MODEL_ID_MAX_LENGTH)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'model ID must not contain control characters');
export const DesktopChatGptStatusSchema = z.object({
  supported: z.boolean(),
  connected: z.boolean(),
  consentRequired: z.boolean(),
  connectionId: ChatGptConnectionIdSchema.nullable(),
  accountLabel: z.string().min(1).max(400).nullable(),
  models: z.array(z.object({ id: ProviderModelIdSchema, label: z.string().min(1).max(400) }).strict()).max(256),
  revocationUnconfirmed: z.boolean(),
}).strict();
export type DesktopChatGptStatus = z.infer<typeof DesktopChatGptStatusSchema>;
export const providerTargetKey = (target: ProviderTarget): string => target.kind === 'system'
  ? 'system' : target.kind === 'preset' ? `preset:${target.providerId}` : `custom:${target.profileId}`;
export const presetApiKeyRef = (providerId: string): string =>
  `preset:${ProviderPresetIdSchema.parse(providerId)}:api-key`;
