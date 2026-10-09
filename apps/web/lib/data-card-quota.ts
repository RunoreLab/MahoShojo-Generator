import { HOT_CARD_FAVORITE_THRESHOLD, HOT_CARD_USAGE_THRESHOLD } from '@/lib/constants';
import { getUtf8ByteLength } from '@/lib/data-card-size';

export type DataCardSlotUsageInput = {
  data: string;
  favoriteCount?: number | null;
  usageCount?: number | null;
  pendingData?: string | null;
};

export { getDataCardBaseSlotCostFromBytes } from '@mahoshojo/domain/data-card-size';
import { getDataCardBaseSlotCostFromBytes } from '@mahoshojo/domain/data-card-size';

export const isHotDataCardForQuota = (favoriteCount?: number | null, usageCount?: number | null): boolean =>
  (favoriteCount ?? 0) > HOT_CARD_FAVORITE_THRESHOLD &&
  (usageCount ?? 0) > HOT_CARD_USAGE_THRESHOLD;

export const getDataCardChargedSlotsFromBytes = (bytes: number, isHot: boolean): number =>
  Math.max(0, getDataCardBaseSlotCostFromBytes(bytes) - (isHot ? 1 : 0));

export const getDataCardSlotUsage = (input: DataCardSlotUsageInput): number => {
  const currentBytes = getUtf8ByteLength(input.data);
  const pendingBytes = input.pendingData == null ? 0 : getUtf8ByteLength(input.pendingData);
  const effectiveBytes = Math.max(currentBytes, pendingBytes);
  return getDataCardChargedSlotsFromBytes(
    effectiveBytes,
    isHotDataCardForQuota(input.favoriteCount, input.usageCount),
  );
};
