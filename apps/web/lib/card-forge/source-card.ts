import { stripLocalCardTransportMeta } from '@mahoshojo/local-library/digest';

export const formatSelectedDataCardJson = (payload: unknown): string => {
  const cleanedPayload = stripLocalCardTransportMeta(payload);
  return JSON.stringify(cleanedPayload ?? {}, null, 2);
};
