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

/** New choices use the Web limit. Existing Profile documents retain their legacy limit. */
export const PROVIDER_MODEL_ID_MAX_LENGTH = 200;
export const ProviderModelIdSchema = z.string().trim().min(1).max(PROVIDER_MODEL_ID_MAX_LENGTH)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'model ID must not contain control characters');
export const providerTargetKey = (target: ProviderTarget): string => target.kind === 'system'
  ? 'system' : target.kind === 'preset' ? `preset:${target.providerId}` : `custom:${target.profileId}`;
export const presetApiKeyRef = (providerId: string): string =>
  `preset:${ProviderPresetIdSchema.parse(providerId)}:api-key`;
