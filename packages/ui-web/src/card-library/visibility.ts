import {
  OnlineDataCardVisibilitySchema,
  type OnlineDataCardVisibility,
} from '@mahoshojo/contracts/data-cards';

export const normalizeOnlineDataCardVisibilityCompat = (
  value: unknown,
): OnlineDataCardVisibility | null => {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const result = OnlineDataCardVisibilitySchema.safeParse(value);
  return result.success ? result.data : null;
};
