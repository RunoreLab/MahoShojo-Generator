import { z } from 'zod/v3';

export const MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS = 1_000_000;
export const HOSTED_GENERATION_INTERNAL_MESSAGE = '服务器内部错误';
export const HOSTED_GENERATION_ERROR_CODE = 'HOSTED_GENERATION_FAILED';

export const createSafeHostedGenerationError = (): Error => {
  const error = new Error(HOSTED_GENERATION_ERROR_CODE);
  error.name = 'HostedGenerationError';
  return error;
};

const ThinkingEffortSchema = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const UserThinkingOverrideSchema = z.union([
  z.object({ mode: z.literal('default') }),
  z.object({ mode: z.literal('disabled') }),
  z.object({ mode: z.literal('enabled'), effort: ThinkingEffortSchema.optional() }),
]);

export const UserGenerationOverridesRequestSchema = z.object({
  maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
  temperature: z.number().finite().min(0).optional(),
  thinking: UserThinkingOverrideSchema.optional(),
}).strict();

export const CustomProviderRequestSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
  generationOverrides: UserGenerationOverridesRequestSchema.optional(),
});

export type CustomProviderRequest = z.infer<typeof CustomProviderRequestSchema>;

export type StepResult<T> =
  | { completed: true; value: T }
  | { completed: false; response: Response };

export const completeStep = <T>(value: T): StepResult<T> => ({
  completed: true,
  value,
});

export const respondStep = (response: Response): StepResult<never> => ({
  completed: false,
  response,
});

export const jsonResponse = (
  payload: unknown,
  status: number,
  includeJsonContentType = true,
): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    ...(includeJsonContentType
      ? { headers: { 'Content-Type': 'application/json' } }
      : {}),
  },
);
