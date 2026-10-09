import { MAX_DATA_CARD_BYTES } from '../data-card-size';

export const TAVERN_IMPORT_ATTACHMENT_LIMITS = {
  maxBytesPerFile: MAX_DATA_CARD_BYTES,
  maxBytesTotal: MAX_DATA_CARD_BYTES,
  maxCharsPerFile: MAX_DATA_CARD_BYTES,
  maxCharsTotal: MAX_DATA_CARD_BYTES,
  maxCount: 10,
} as const;

// Local file and total decompressed text budgets; unrelated to cloud upload/slot policy.
// 4 cloud-card units for local text (same scale as existing Desktop document cap);
// allow 8x that for image pixels. Saving a converted document still obeys its host limit.
export const MAX_TAVERN_TEXT_BYTES = 4 * MAX_DATA_CARD_BYTES;
export const MAX_TAVERN_FILE_BYTES = 8 * MAX_TAVERN_TEXT_BYTES;

// V3 compatibility export carries the same JSON in both ccv3 and chara Base64 chunks.
// Budget both encoded copies plus their framing, rather than rejecting our own export.
export const MAX_TAVERN_PNG_TEXT_BYTES = 2 * Math.ceil(MAX_TAVERN_TEXT_BYTES / 3) * 4 + 1024;
