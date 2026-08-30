import type { AIProvider } from '@/lib/config';

export type MaxOutputTokenGenerationConfig = {
  maxOutputTokens?: number;
};

export const resolveMaxOutputTokens = (
  generationConfig: MaxOutputTokenGenerationConfig,
  provider: Pick<AIProvider, 'defaultMaxOutputTokens'>,
): number | null => {
  const candidate =
    typeof generationConfig.maxOutputTokens === 'number'
      ? generationConfig.maxOutputTokens
      : provider.defaultMaxOutputTokens;

  if (typeof candidate !== 'number') return null;
  if (!Number.isFinite(candidate)) return null;
  if (candidate <= 0) return null;
  return Math.floor(candidate);
};

export const resolveMaxOutputTokensOption = (
  generationConfig: MaxOutputTokenGenerationConfig,
  provider: Pick<AIProvider, 'defaultMaxOutputTokens'>,
): { maxOutputTokens?: number } => {
  const maxOutputTokens = resolveMaxOutputTokens(generationConfig, provider);
  return maxOutputTokens === null ? {} : { maxOutputTokens };
};
