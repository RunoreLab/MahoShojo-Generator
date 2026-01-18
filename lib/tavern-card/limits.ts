import { MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';

export const TAVERN_IMPORT_ATTACHMENT_LIMITS = {
  maxBytesPerFile: MAX_DATA_CARD_BYTES,
  maxBytesTotal: MAX_DATA_CARD_BYTES,
  maxCharsPerFile: MAX_DATA_CARD_BYTES,
  maxCharsTotal: MAX_DATA_CARD_BYTES,
  maxCount: 10,
} as const;
