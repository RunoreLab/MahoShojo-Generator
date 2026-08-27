import {
  HOSTED_GENERATION_ERROR_CODE,
  buildHostedGenerationErrorPayload,
  jsonResponse,
  readSafePublicAiError,
} from './regular-generation';
import {
  createQuestionnaireGenerationService,
  type QuestionnaireGenerationDependencies,
  type QuestionnaireGenerationService,
} from './questionnaire-generation';

export type GenerateSublimationServiceDependencies<Prepared, Execution, Generated> =
  QuestionnaireGenerationDependencies<Prepared, Execution, Generated>;

export type GenerateSublimationService = QuestionnaireGenerationService;

const sublimationErrorResponse = (error: unknown): Response => {
  if (readSafePublicAiError(error)) {
    return jsonResponse(buildHostedGenerationErrorPayload(error, '角色成长升华失败'), 500);
  }
  const message = `角色成长升华失败: ${HOSTED_GENERATION_ERROR_CODE}`;
  return jsonResponse({ error: message, message }, 500);
};

export const createGenerateSublimationService = <Prepared, Execution, Generated>(
  dependencies: GenerateSublimationServiceDependencies<Prepared, Execution, Generated>,
): GenerateSublimationService => createQuestionnaireGenerationService(
  {
    invalidJsonResponse: 'route-error',
    executionOrder: 'after-policies',
    buildErrorResponse: sublimationErrorResponse,
  },
  dependencies,
);

export const createGenerateSublimationStreamService = <Prepared, Execution, Generated>(
  dependencies: GenerateSublimationServiceDependencies<Prepared, Execution, Generated>,
): GenerateSublimationService => createQuestionnaireGenerationService(
  {
    invalidJsonResponse: 'route-error',
    executionOrder: 'after-policies',
    buildErrorResponse: (error) => readSafePublicAiError(error)
      ? jsonResponse(buildHostedGenerationErrorPayload(error, '生成失败'), 500)
      : jsonResponse({
        error: '生成失败',
        message: HOSTED_GENERATION_ERROR_CODE,
      }, 500),
  },
  dependencies,
);
