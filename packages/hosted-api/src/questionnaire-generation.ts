import {
  jsonResponse,
  type StepResult,
} from './regular-generation';

export interface QuestionnaireGenerationDependencies<Prepared, Execution, Generated> {
  prepare(_request: Request, _body: unknown): Promise<StepResult<Prepared>>;
  resolveExecution(
    _request: Request,
    _input: Prepared,
  ): Promise<StepResult<Execution>>;
  checkRateLimit(_request: Request, _input: Prepared): Promise<Response | null>;
  enforceSafety(_request: Request, _input: Prepared): Promise<Response | null>;
  generate(
    _request: Request,
    _input: Prepared,
    _execution: Execution,
  ): Promise<StepResult<Generated>>;
  recordActivity(_request: Request): void;
  buildResponse(
    _request: Request,
    _input: Prepared,
    _generated: Generated,
  ): Response | Promise<Response>;
  logError(_error: unknown, _input?: Prepared): void;
}

export interface QuestionnaireGenerationService {
  (_request: Request): Promise<Response>;
}

type QuestionnaireGenerationOptions = {
  invalidJsonResponse: 'creator-400' | 'route-error';
  executionOrder: 'before-policies' | 'after-policies';
  buildErrorResponse(_error: unknown): Response;
};

const runGeneration = async <Prepared, Execution, Generated>(
  request: Request,
  body: unknown,
  options: QuestionnaireGenerationOptions,
  dependencies: QuestionnaireGenerationDependencies<Prepared, Execution, Generated>,
): Promise<Response> => {
  let preparedInput: Prepared | undefined;
  try {
    const prepared = await dependencies.prepare(request, body);
    if (!prepared.completed) return prepared.response;
    preparedInput = prepared.value;

    let execution: StepResult<Execution> | undefined;
    if (options.executionOrder === 'before-policies') {
      execution = await dependencies.resolveExecution(request, preparedInput);
      if (!execution.completed) return execution.response;
    }

    const rateLimitResponse = await dependencies.checkRateLimit(request, preparedInput);
    if (rateLimitResponse) return rateLimitResponse;

    const safetyResponse = await dependencies.enforceSafety(request, preparedInput);
    if (safetyResponse) return safetyResponse;

    if (options.executionOrder === 'after-policies') {
      execution = await dependencies.resolveExecution(request, preparedInput);
      if (!execution.completed) return execution.response;
    }

    if (!execution?.completed) {
      throw new Error('Questionnaire generation execution was not resolved');
    }

    const generated = await dependencies.generate(
      request,
      preparedInput,
      execution.value,
    );
    if (!generated.completed) return generated.response;

    dependencies.recordActivity(request);
    return await dependencies.buildResponse(request, preparedInput, generated.value);
  } catch (error) {
    dependencies.logError(error, preparedInput);
    return options.buildErrorResponse(error);
  }
};

export const createQuestionnaireGenerationService = <Prepared, Execution, Generated>(
  options: QuestionnaireGenerationOptions,
  dependencies: QuestionnaireGenerationDependencies<Prepared, Execution, Generated>,
): QuestionnaireGenerationService => async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (options.invalidJsonResponse === 'creator-400') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
    return runGeneration(request, body, options, dependencies);
  }

  try {
    const body = await request.json();
    return await runGeneration(request, body, options, dependencies);
  } catch (error) {
    dependencies.logError(error);
    return options.buildErrorResponse(error);
  }
};

export const generationErrorResponse = (
  error: unknown,
  publicMessage: string,
): Response => jsonResponse(
  {
    error: publicMessage,
    message: error instanceof Error ? error.message : '服务器内部错误',
  },
  500,
);
