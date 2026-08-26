import {
  HOSTED_GENERATION_ERROR_CODE,
  jsonResponse,
} from './regular-generation';
import {
  createQuestionnaireGenerationService,
  type QuestionnaireGenerationDependencies,
  type QuestionnaireGenerationService,
} from './questionnaire-generation';

export type GenerateSublimationServiceDependencies<Prepared, Execution, Generated> =
  QuestionnaireGenerationDependencies<Prepared, Execution, Generated>;

export type GenerateSublimationService = QuestionnaireGenerationService;

const sublimationErrorResponse = (): Response => {
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
    buildErrorResponse: () => jsonResponse({
      error: '流式生成失败',
      message: HOSTED_GENERATION_ERROR_CODE,
    }, 500),
  },
  dependencies,
);
