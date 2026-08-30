import {
  createQuestionnaireGenerationService,
  generationErrorResponse,
  type QuestionnaireGenerationDependencies,
  type QuestionnaireGenerationService,
} from './questionnaire-generation';

export type GenerateMagicalGirlDetailsServiceDependencies<Prepared, Execution, Generated> =
  QuestionnaireGenerationDependencies<Prepared, Execution, Generated>;

export type GenerateMagicalGirlDetailsService = QuestionnaireGenerationService;

export const createGenerateMagicalGirlDetailsService = <Prepared, Execution, Generated>(
  dependencies: GenerateMagicalGirlDetailsServiceDependencies<Prepared, Execution, Generated>,
): GenerateMagicalGirlDetailsService => createQuestionnaireGenerationService(
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

export const createGenerateMagicalGirlDetailsStreamService = <Prepared, Execution, Generated>(
  dependencies: GenerateMagicalGirlDetailsServiceDependencies<Prepared, Execution, Generated>,
): GenerateMagicalGirlDetailsService => createQuestionnaireGenerationService(
  {
    invalidJsonResponse: 'route-error',
    executionOrder: 'after-policies',
    buildErrorResponse: (error) => generationErrorResponse(error, '生成失败'),
  },
  dependencies,
);
