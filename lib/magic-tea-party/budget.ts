import type { MagicTeaPartySession } from '@/lib/magic-tea-party/types';
import { estimateTokensFromText } from '@/lib/token-estimator';

export const MAGIC_TEA_PARTY_DEFAULT_CONTEXT_WINDOW = 128_000;
export const MAGIC_TEA_PARTY_FALLBACK_CONTEXT_WINDOW = 32_000;
export const MAGIC_TEA_PARTY_CONTEXT_MARGIN = 2_000;

const PROVIDER_TOKEN_MULTIPLIER: Record<string, number> = {
  openai: 1.0,
  anthropic: 1.1,
  google: 1.05,
  deepseek: 1.0,
};

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.floor(value);
};

export const resolveMagicTeaPartyTokenBudget = (
  settings: MagicTeaPartySession['settings'] | null | undefined,
  providerId?: string | null
) => {
  const fallbackContextWindow = MAGIC_TEA_PARTY_FALLBACK_CONTEXT_WINDOW;
  const defaultContextWindow = MAGIC_TEA_PARTY_DEFAULT_CONTEXT_WINDOW;
  const contextWindowTokens =
    normalizeNumber(settings?.contextWindowTokens) ?? (providerId ? defaultContextWindow : fallbackContextWindow);

  const responseReserveTokens =
    normalizeNumber(settings?.responseReserveTokens) ?? Math.max(4096, Math.floor(contextWindowTokens * 0.08));

  const historyBudgetTokens = Math.max(0, contextWindowTokens - responseReserveTokens - MAGIC_TEA_PARTY_CONTEXT_MARGIN);

  const summaryTriggerRatio = clampNumber(
    typeof settings?.summaryTriggerRatio === 'number' ? settings.summaryTriggerRatio : 0.85,
    0.5,
    0.95
  );

  const warnTokens = Math.floor(historyBudgetTokens * summaryTriggerRatio);

  return {
    contextWindowTokens,
    responseReserveTokens,
    historyBudgetTokens,
    summaryTriggerRatio,
    warnTokens,
    maxContextMessages: normalizeNumber(settings?.maxContextMessages) ?? 120,
    summaryMaxTokens: normalizeNumber(settings?.summaryMaxTokens) ?? 1200,
    summaryMinGapMessages: normalizeNumber(settings?.summaryMinGapMessages) ?? 8,
  };
};

export const getMagicTeaPartyTokenMultiplier = (providerId?: string | null): number => {
  const key = typeof providerId === 'string' ? providerId.trim() : '';
  if (key && Number.isFinite(PROVIDER_TOKEN_MULTIPLIER[key])) return PROVIDER_TOKEN_MULTIPLIER[key];
  return 1.2;
};

export const estimateMagicTeaPartyTokens = (text: string, providerId?: string | null): number => {
  const base = estimateTokensFromText(text);
  const multiplier = getMagicTeaPartyTokenMultiplier(providerId);
  return Math.max(0, Math.round(base * multiplier));
};
