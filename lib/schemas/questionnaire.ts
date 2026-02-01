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
  placeholder: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
  allowCustom: z.boolean().optional(),
  helperText: z.string().optional(),
  maxLength: z.union([z.number().int().nonnegative(), z.null()]).optional(),
  required: z.boolean().optional(),
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
