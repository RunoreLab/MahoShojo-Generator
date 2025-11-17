import { z } from 'zod';

export const AdjudicatorEventSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['binary', 'custom']).optional(),
  probability: z.number().min(0).max(100).optional(),
  onSuccess: z.object({ event: AdjudicatorEventSchema }).optional(),
  onFailure: z.object({ event: AdjudicatorEventSchema }).optional(),
  outcomes: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    probability: z.number().min(0).max(100).optional(),
    chainedEvent: z.object({ event: AdjudicatorEventSchema }).optional()
  })).optional()
}));
