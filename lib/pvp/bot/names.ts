import { getRandomJournalist } from '@/lib/random-choose-journalist';

export const pickBotBaseName = (): string => {
  const name = getRandomJournalist()?.name;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || '佚名';
};

export const buildBotUsername = (baseName: string, suffixIndex: number): string => {
  const base = typeof baseName === 'string' ? baseName.trim() : '';
  const safeBase = base || '佚名';
  const suffix = Math.max(0, Math.floor(suffixIndex));
  if (suffix <= 0) return safeBase;
  return `${safeBase}#${suffix + 1}`;
};

