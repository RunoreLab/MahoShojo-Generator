import {
  createQuestionnaireGenerationService,
  generationErrorResponse,
  type QuestionnaireGenerationDependencies,
  type QuestionnaireGenerationService,
} from './questionnaire-generation';

export type GenerateCreatorServiceDependencies<Prepared, Execution, Generated> =
  QuestionnaireGenerationDependencies<Prepared, Execution, Generated>;

export type GenerateCreatorService = QuestionnaireGenerationService;

export const createGenerateCreatorService = <Prepared, Execution, Generated>(
  dependencies: GenerateCreatorServiceDependencies<Prepared, Execution, Generated>,
): GenerateCreatorService => createQuestionnaireGenerationService(
  {
    invalidJsonResponse: 'creator-400',
    executionOrder: 'before-policies',
    buildErrorResponse: (error) => generationErrorResponse(
      error,
      '生成失败，当前服务器可能正忙，请稍后重试',
    ),
  },
  dependencies,
);

export const createGenerateCreatorStreamService = <Prepared, Execution, Generated>(
  dependencies: GenerateCreatorServiceDependencies<Prepared, Execution, Generated>,
): GenerateCreatorService => createQuestionnaireGenerationService(
  {
    invalidJsonResponse: 'route-error',
    executionOrder: 'after-policies',
    buildErrorResponse: (error) => generationErrorResponse(error, '生成失败'),
  },
  dependencies,
);
