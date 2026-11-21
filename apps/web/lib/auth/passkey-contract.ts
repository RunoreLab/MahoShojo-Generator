import { z } from 'zod';

export const PASSKEY_API_PREFIX = '/api/auth';
export const PASSKEY_ROUTES = {
  status: '/passkey/status',
  list: '/passkey/list',
  loginOptions: '/passkey/login-options',
  login: '/passkey/login',
  confirmOptions: '/passkey/confirm-options',
  registerOptions: '/passkey/register-options',
  register: '/passkey/register',
  rename: '/passkey/rename',
  delete: '/passkey/delete',
} as const;

export const PASSKEY_MAX_CREDENTIALS = 10;
export const PASSKEY_MAX_NAME_LENGTH = 64;

const id = z.uuid();
const base64url = (maxLength: number) => z.string().min(1).max(maxLength).regex(/^[A-Za-z0-9_-]+$/u);
const credential = z.object({
  id: base64url(1400),
  rawId: base64url(1400),
  type: z.literal('public-key'),
  clientExtensionResults: z.object({}),
});

const registrationResponse = credential.extend({
  response: z.object({
    clientDataJSON: base64url(4096),
    attestationObject: base64url(16_384),
    transports: z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).max(7).optional(),
  }),
});
const assertionResponse = credential.extend({
  response: z.object({
    clientDataJSON: base64url(4096),
    authenticatorData: base64url(4096),
    signature: base64url(2048),
    userHandle: base64url(86).nullable().optional().transform((value) => value ?? undefined),
  }),
});

const passkeyName = z.string().trim().min(1).max(PASSKEY_MAX_NAME_LENGTH)
  .regex(/^[^\p{Cc}]+$/u);
export const PasskeyAssertionSchema = z.object({ flowId: id, response: assertionResponse }).strict();
export const PasskeyConfirmationSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('password'), password: z.string().min(1).max(256) }).strict(),
  PasskeyAssertionSchema.extend({ method: z.literal('passkey') }),
]);

export const PasskeyManagementActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('register') }).strict(),
  z.object({ kind: z.literal('delete'), id }).strict(),
]);
export const PasskeyRegisterOptionsSchema = z.object({ confirmation: PasskeyConfirmationSchema }).strict();
export const PasskeyRegisterSchema = z.object({
  flowId: id,
  name: passkeyName.optional(),
  response: registrationResponse,
}).strict();
export const PasskeyRenameSchema = z.object({ id, name: passkeyName }).strict();
export const PasskeyDeleteSchema = z.object({ id, confirmation: PasskeyConfirmationSchema }).strict();

export type PasskeyManagementAction = z.infer<typeof PasskeyManagementActionSchema>;
export type PasskeyConfirmation = z.infer<typeof PasskeyConfirmationSchema>;
export type PasskeyAssertion = z.infer<typeof PasskeyAssertionSchema>;
export type PasskeyRegistration = z.infer<typeof PasskeyRegisterSchema>;
export type PasskeyRequestOptions = { flowId: string; options: PublicKeyCredentialRequestOptionsJSON };
export type PasskeyCreationOptions = { flowId: string; options: PublicKeyCredentialCreationOptionsJSON };
export type PasskeySummary = { id: string; name: string; createdAt: number; lastUsedAt: number | null };
