import { z } from 'zod/v3';
import {
  CustomProviderRequestSchema,
  jsonResponse,
  type CustomProviderRequest,
  type StepResult,
} from './regular-generation';

export const FREE_GENERATION_MAX_SAFETY_TEXT_CHARS = 50_000;
export const FREE_GENERATION_MAX_ATTACHMENT_CHARS = 50_000;
export const FREE_GENERATION_MAX_TOTAL_ATTACHMENT_CHARS = 200_000;
export const FREE_GENERATION_MAX_ATTACHMENTS = 50;

const AttachmentSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().optional().default('application/octet-stream'),
  size: z.number().int().nonnegative().optional(),
  content: z.string().max(FREE_GENERATION_MAX_ATTACHMENT_CHARS),
  truncated: z.boolean().optional(),
});

const AttachmentsSchema = z.array(AttachmentSchema)
  .max(FREE_GENERATION_MAX_ATTACHMENTS)
  .optional()
  .default([])
  .superRefine((items, context) => {
    const total = items.reduce((sum, item) => sum + item.content.length, 0);
    if (total > FREE_GENERATION_MAX_TOTAL_ATTACHMENT_CHARS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `附件内容总长度超出限制（上限 ${FREE_GENERATION_MAX_TOTAL_ATTACHMENT_CHARS.toLocaleString()} 字符）`,
      });
    }
  });

const FreeSchemaIdSchema = z.enum([
  'magical-girl',
  'canshou',
  'scenario',
  'general',
  'general-scenario',
]);

const FreeStreamSchemaIdSchema = z.enum(['general', 'general-scenario']);

const createRequestSchema = (schema: typeof FreeSchemaIdSchema | typeof FreeStreamSchemaIdSchema) => z.object({
  schema,
  prompt: z.string().min(1),
  attachments: AttachmentsSchema,
  language: z.string().optional().default('zh-CN'),
  customProvider: CustomProviderRequestSchema.optional(),
});

const GenerateFreeRequestSchema = createRequestSchema(FreeSchemaIdSchema);
const GenerateFreeStreamRequestSchema = createRequestSchema(FreeStreamSchemaIdSchema);

export type FreeTextAttachment = z.infer<typeof AttachmentSchema>;

export type GenerateFreeInput = {
  schema: z.infer<typeof FreeSchemaIdSchema>;
  prompt: string;
  attachments: FreeTextAttachment[];
  language: string;
  customProvider?: CustomProviderRequest;
};

export type GenerateFreeStreamInput = Omit<GenerateFreeInput, 'schema'> & {
  schema: z.infer<typeof FreeStreamSchemaIdSchema>;
};

interface FreeServiceDependenciesBase<Input> {
  checkRateLimit(_request: Request, _input: Input): Promise<Response | null>;
  enforceSafety(
    _request: Request,
    _input: Input,
    _safetyText: string,
  ): Promise<Response | null>;
  recordActivity(_request: Request): void;
  logError(_error: unknown): void;
}

export interface GenerateFreeServiceDependencies<Generated, Output>
  extends FreeServiceDependenciesBase<GenerateFreeInput> {
  generate(_request: Request, _input: GenerateFreeInput): Promise<StepResult<Generated>>;
  normalizeOutput(
    _request: Request,
    _input: GenerateFreeInput,
    _generated: Generated,
  ): Promise<StepResult<Output>>;
  buildResponse(
    _request: Request,
    _input: GenerateFreeInput,
    _output: Output,
  ): Response | Promise<Response>;
}

export interface GenerateFreeStreamServiceDependencies<Output>
  extends FreeServiceDependenciesBase<GenerateFreeStreamInput> {
  generate(_request: Request, _input: GenerateFreeStreamInput): Promise<StepResult<Output>>;
  buildResponse(
    _request: Request,
    _input: GenerateFreeStreamInput,
    _output: Output,
  ): Response | Promise<Response>;
}

export interface GenerateFreeService {
  (_request: Request): Promise<Response>;
}

const buildSafetyText = (input: Pick<GenerateFreeInput, 'prompt' | 'attachments'>): string => {
  const combined = [input.prompt, ...input.attachments.map((item) => item.content)]
    .filter((text) => text.trim())
    .join('\n\n');
  return combined.length > FREE_GENERATION_MAX_SAFETY_TEXT_CHARS
    ? combined.slice(0, FREE_GENERATION_MAX_SAFETY_TEXT_CHARS)
    : combined;
};

const createFreeService = <
  Input extends GenerateFreeInput | GenerateFreeStreamInput,
  Generated,
  Output,
>(options: {
  schema: z.ZodType<Input>;
  dependencies: FreeServiceDependenciesBase<Input> & {
    generate(_request: Request, _input: Input): Promise<StepResult<Generated>>;
    buildResponse(_request: Request, _input: Input, _output: Output): Response | Promise<Response>;
  };
  transformOutput: (
    _request: Request,
    _input: Input,
    _output: Generated,
  ) => Promise<StepResult<Output>>;
}): GenerateFreeService => async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const parsed = options.schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: '请求参数无效' }, 400);

    const input = parsed.data;
    const rateLimitResponse = await options.dependencies.checkRateLimit(request, input);
    if (rateLimitResponse) return rateLimitResponse;

    const safetyResponse = await options.dependencies.enforceSafety(
      request,
      input,
      buildSafetyText(input),
    );
    if (safetyResponse) return safetyResponse;

    const generated = await options.dependencies.generate(request, input);
    if (!generated.completed) return generated.response;

    const output = await options.transformOutput(request, input, generated.value);
    if (!output.completed) return output.response;
    options.dependencies.recordActivity(request);
    return await options.dependencies.buildResponse(request, input, output.value);
  } catch (error) {
    options.dependencies.logError(error);
    const message = error instanceof Error ? error.message : '未知错误';
    return jsonResponse({ error: '生成失败', message }, 500);
  }
};

export const createGenerateFreeService = <Generated, Output>(
  dependencies: GenerateFreeServiceDependencies<Generated, Output>,
): GenerateFreeService => createFreeService<GenerateFreeInput, Generated, Output>({
  schema: GenerateFreeRequestSchema as z.ZodType<GenerateFreeInput>,
  dependencies,
  transformOutput: dependencies.normalizeOutput,
});

export const createGenerateFreeStreamService = <Output>(
  dependencies: GenerateFreeStreamServiceDependencies<Output>,
): GenerateFreeService => createFreeService<GenerateFreeStreamInput, Output, Output>({
  schema: GenerateFreeStreamRequestSchema as z.ZodType<GenerateFreeStreamInput>,
  dependencies,
  transformOutput: async (_request, _input, output) => ({ completed: true, value: output }),
});
