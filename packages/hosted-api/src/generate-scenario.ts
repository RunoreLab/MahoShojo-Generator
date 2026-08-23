import {
  jsonResponse,
  type StepResult,
} from './regular-generation';

export type GenerateScenarioInput = {
  answers: Record<string, unknown>;
  language: string;
  fieldsToKeepEmpty: unknown;
  customProvider?: unknown;
};

export type GenerateScenarioStreamInput = GenerateScenarioInput & {
  titleHint?: unknown;
};

interface ScenarioServiceDependenciesBase<Input> {
  checkRateLimit(_request: Request, _input: Input): Promise<Response | null>;
  enforceSafety(
    _request: Request,
    _input: Input,
    _safetyText: string,
  ): Promise<Response | null>;
  recordActivity(_request: Request): void;
  logError(_error: unknown): void;
}

export interface GenerateScenarioServiceDependencies<Output>
  extends ScenarioServiceDependenciesBase<GenerateScenarioInput> {
  generate(_request: Request, _input: GenerateScenarioInput): Promise<StepResult<Output>>;
  finalize(
    _request: Request,
    _input: GenerateScenarioInput,
    _output: Output,
  ): Response | Promise<Response>;
}

export interface GenerateScenarioStreamServiceDependencies<Output>
  extends ScenarioServiceDependenciesBase<GenerateScenarioStreamInput> {
  generate(
    _request: Request,
    _input: GenerateScenarioStreamInput,
  ): Promise<StepResult<Output>>;
  buildResponse(
    _request: Request,
    _input: GenerateScenarioStreamInput,
    _output: Output,
  ): Response | Promise<Response>;
}

export interface GenerateScenarioService {
  (_request: Request): Promise<Response>;
}

const readInput = async (
  request: Request,
  rejectArrays: boolean,
  throwOnNullBody: boolean,
): Promise<GenerateScenarioStreamInput | null> => {
  const parsedBody = await request.json();
  if (throwOnNullBody && parsedBody === null) {
    // 非流式 legacy handler 直接对 JSON 结果解构；JSON null 因此进入 500 分支。
    const { answers: _answers } = await Promise.resolve(
      parsedBody as Record<string, unknown>,
    );
    void _answers;
  }
  const body = (parsedBody ?? {}) as Record<string, unknown>;
  const answers = body?.answers;
  if (
    !answers
    || typeof answers !== 'object'
    || (rejectArrays && Array.isArray(answers))
    || Object.keys(answers).length === 0
  ) {
    return null;
  }

  return {
    answers: answers as Record<string, unknown>,
    language: (body?.language === undefined ? 'zh-CN' : body.language) as string,
    fieldsToKeepEmpty: body?.fieldsToKeepEmpty === undefined ? [] : body.fieldsToKeepEmpty,
    ...(Object.prototype.hasOwnProperty.call(body, 'customProvider')
      ? { customProvider: body.customProvider }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'titleHint')
      ? { titleHint: body.titleHint }
      : {}),
  };
};

const createScenarioService = <Input extends GenerateScenarioInput, Output>(options: {
  rejectArrays: boolean;
  includeJsonContentType: boolean;
  throwOnNullBody: boolean;
  dependencies: ScenarioServiceDependenciesBase<Input> & {
    generate(_request: Request, _input: Input): Promise<StepResult<Output>>;
    buildResponse(_request: Request, _input: Input, _output: Output): Response | Promise<Response>;
  };
}): GenerateScenarioService => async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed' },
      405,
      options.includeJsonContentType,
    );
  }

  try {
    const input = await readInput(
      request,
      options.rejectArrays,
      options.throwOnNullBody,
    ) as Input | null;
    if (!input) {
      return jsonResponse(
        { error: 'Answers object is required' },
        400,
        options.includeJsonContentType,
      );
    }

    const rateLimitResponse = await options.dependencies.checkRateLimit(request, input);
    if (rateLimitResponse) return rateLimitResponse;

    const safetyResponse = await options.dependencies.enforceSafety(
      request,
      input,
      Object.values(input.answers).join(' '),
    );
    if (safetyResponse) return safetyResponse;

    const generated = await options.dependencies.generate(request, input);
    if (!generated.completed) return generated.response;

    options.dependencies.recordActivity(request);
    return await options.dependencies.buildResponse(request, input, generated.value);
  } catch (error) {
    options.dependencies.logError(error);
    const message = error instanceof Error ? error.message : '未知错误';
    return jsonResponse(
      { error: '生成失败', message },
      500,
      options.includeJsonContentType,
    );
  }
};

export const createGenerateScenarioService = <Output>(
  dependencies: GenerateScenarioServiceDependencies<Output>,
): GenerateScenarioService => createScenarioService<GenerateScenarioInput, Output>({
  rejectArrays: false,
  includeJsonContentType: false,
  throwOnNullBody: true,
  dependencies: {
    ...dependencies,
    buildResponse: dependencies.finalize,
  },
});

export const createGenerateScenarioStreamService = <Output>(
  dependencies: GenerateScenarioStreamServiceDependencies<Output>,
): GenerateScenarioService => createScenarioService<GenerateScenarioStreamInput, Output>({
  rejectArrays: true,
  includeJsonContentType: true,
  throwOnNullBody: false,
  dependencies,
});
