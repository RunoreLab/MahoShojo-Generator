import { z } from 'zod/v3';
import {
  CustomProviderRequestSchema,
  buildHostedGenerationErrorPayload,
  createSafeHostedGenerationError,
  jsonResponse,
  type CustomProviderRequest,
  type StepResult,
} from './regular-generation';

export const GAME_CARD_CUSTOM_INSTRUCTIONS_MAX_LENGTH = 2_000;

const GenerateGameCardRequestSchema = z.object({
  sourceCardJson: z.string().min(1),
  customInstructions: z.string().max(GAME_CARD_CUSTOM_INSTRUCTIONS_MAX_LENGTH).optional(),
  customProvider: CustomProviderRequestSchema.optional(),
});

export type GenerateGameCardInput = {
  sourceCardJson: string;
  customInstructions?: string;
  customProvider?: CustomProviderRequest;
};

export interface GenerateGameCardServiceDependencies<Generated, Output> {
  enforceSafety(_request: Request, _input: GenerateGameCardInput): Promise<Response | null>;
  checkRateLimit(_request: Request, _input: GenerateGameCardInput): Promise<Response | null>;
  generate(
    _request: Request,
    _input: GenerateGameCardInput,
  ): Promise<StepResult<Generated>>;
  applyOutputPolicy(
    _request: Request,
    _input: GenerateGameCardInput,
    _generated: Generated,
  ): Promise<StepResult<Output>>;
  recordActivity(_request: Request): void;
  logSuccess(_input: GenerateGameCardInput, _output: Output): void;
  buildResponse(
    _request: Request,
    _input: GenerateGameCardInput,
    _output: Output,
  ): Response | Promise<Response>;
  logError(_error: unknown): void;
}

export interface GenerateGameCardService {
  (_request: Request): Promise<Response>;
}

const formatZodIssues = (issues: z.ZodIssue[]): string => issues
  .map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '输入';
    return `${path}：${issue.message}`;
  })
  .join('；');

export const createGenerateGameCardService = <Generated, Output>(
  dependencies: GenerateGameCardServiceDependencies<Generated, Output>,
): GenerateGameCardService => async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const parsed = GenerateGameCardRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return jsonResponse({
        error: '请求参数无效',
        message: formatZodIssues(parsed.error.issues),
      }, 400);
    }

    const input = parsed.data as GenerateGameCardInput;
    const safetyResponse = await dependencies.enforceSafety(request, input);
    if (safetyResponse) return safetyResponse;

    const rateLimitResponse = await dependencies.checkRateLimit(request, input);
    if (rateLimitResponse) return rateLimitResponse;

    const generated = await dependencies.generate(request, input);
    if (!generated.completed) return generated.response;

    const output = await dependencies.applyOutputPolicy(request, input, generated.value);
    if (!output.completed) return output.response;

    dependencies.recordActivity(request);
    dependencies.logSuccess(input, output.value);
    return await dependencies.buildResponse(request, input, output.value);
  } catch (error) {
    dependencies.logError(createSafeHostedGenerationError(error));
    return jsonResponse(buildHostedGenerationErrorPayload(error, '卡牌卡面生成失败'), 500);
  }
};
