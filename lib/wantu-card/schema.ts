import { z } from 'zod/v3';
import { WANTU_CARD_KINDS, type WantuCard, type WantuCardKind } from './types';

const wantuCardKindValues = WANTU_CARD_KINDS as unknown as [WantuCardKind, ...WantuCardKind[]];
const unknownRecordSchema = z.record(z.unknown());

export const WantuCardKindSchema = z.enum(wantuCardKindValues);

export const WantuCardSchema = z.object({
  id: z.string().optional(),
  cardKind: WantuCardKindSchema,
  name: z.string().min(1, 'name is required'),
  content: z.string(),
  fields: unknownRecordSchema.optional(),
  meta: unknownRecordSchema.optional(),
  references: z.array(z.unknown()).optional(),
  visualAssets: z.array(z.unknown()).optional(),
  generationHints: unknownRecordSchema.optional(),
}).catchall(z.unknown());

export function isWantuCardKind(value: unknown): value is WantuCardKind {
  return typeof value === 'string' && WANTU_CARD_KINDS.includes(value as WantuCardKind);
}

export function isWantuCard(value: unknown): value is WantuCard {
  return WantuCardSchema.safeParse(value).success;
}
