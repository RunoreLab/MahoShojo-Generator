import {
  createQuestionnaireGenerationService,
  generationErrorResponse,
  type QuestionnaireGenerationDependencies,
  type QuestionnaireGenerationService,
} from './questionnaire-generation';

export type GenerateCanshouServiceDependencies<Prepared, Execution, Generated> =
  QuestionnaireGenerationDependencies<Prepared, Execution, Generated>;

export type GenerateCanshouService = QuestionnaireGenerationService;

export const createGenerateCanshouService = <Prepared, Execution, Generated>(
  dependencies: GenerateCanshouServiceDependencies<Prepared, Execution, Generated>,
): GenerateCanshouService => createQuestionnaireGenerationService(
  {
    invalidJsonResponse: 'route-error',
    executionOrder: 'after-policies',
    buildErrorResponse: (error) => generationErrorResponse(
      error,
      '生成失败，当前服务器可能正忙，请稍后重试',
    ),
  },
  dependencies,
);

export const createGenerateCanshouStreamService = <Prepared, Execution, Generated>(
  dependencies: GenerateCanshouServiceDependencies<Prepared, Execution, Generated>,
): GenerateCanshouService => createQuestionnaireGenerationService(
  {
    invalidJsonResponse: 'route-error',
    executionOrder: 'after-policies',
    buildErrorResponse: (error) => generationErrorResponse(error, '生成失败'),
  },
  dependencies,
);
