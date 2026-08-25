import { stripBattleSelectionTransportMeta } from '@/lib/data-card-read-mappers';

export const formatSelectedDataCardJson = (payload: unknown): string => {
  const cleanedPayload = stripBattleSelectionTransportMeta(payload);
  return JSON.stringify(cleanedPayload ?? {}, null, 2);
};
