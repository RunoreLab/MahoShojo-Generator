import { z } from 'zod/v3';

const QuestionnaireOptionSchema = z.union([
  z.string(),
  z.object({
    value: z.string(),
    label: z.string(),
    disabled: z.boolean().optional(),
  }),
]);

const QuestionnaireQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.string().optional(),
  options: z.array(QuestionnaireOptionSchema).optional(),
  optionsFrom: z.union([
    z.string(),
    z.object({
      key: z.string().optional(),
      questionId: z.string().optional(),
      questionnaireId: z.string().optional(),
    }),
  ]).optional(),
  placeholder: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
  suggestionsFrom: z.union([
    z.string(),
    z.object({
      key: z.string().optional(),
      questionId: z.string().optional(),
      questionnaireId: z.string().optional(),
    }),
  ]).optional(),
  allowCustom: z.boolean().optional(),
  helperText: z.string().optional(),
  maxLength: z.union([z.number().int().nonnegative(), z.null()]).optional(),
  required: z.boolean().optional(),
  displayIf: z.union([
    z.object({
      any: z.array(z.any()).optional(),
      all: z.array(z.any()).optional(),
      not: z.any().optional(),
      key: z.string().optional(),
      questionId: z.string().optional(),
      questionnaireId: z.string().optional(),
      operator: z.string().optional(),
      value: z.union([z.string(), z.array(z.string())]).optional(),
    }),
    z.array(z.any()),
  ]).optional(),
  jump: z.union([
    z.object({
      when: z.any(),
      to: z.union([
        z.string(),
        z.object({
          key: z.string().optional(),
          questionId: z.string().optional(),
          questionnaireId: z.string().optional(),
        }),
      ]).optional(),
      toEnd: z.boolean().optional(),
    }),
    z.array(z.any()),
  ]).optional(),
});

export const QuestionnaireSchema = z.object({
  templateId: z.string().optional(),
  kind: z.enum(['magical-girl', 'canshou']),
  title: z.string(),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  version: z.string().optional(),
  nativeAllowed: z.boolean().optional(),
  questions: z.array(QuestionnaireQuestionSchema).min(1),
}).catchall(z.unknown());

export type QuestionnaireData = z.infer<typeof QuestionnaireSchema>;
