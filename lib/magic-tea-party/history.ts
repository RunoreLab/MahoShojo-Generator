import { estimateMagicTeaPartyTokens } from '@/lib/magic-tea-party/budget';
import type { MagicTeaPartyHistoryMessage, MagicTeaPartyMessage } from '@/lib/magic-tea-party/types';

const isMessageSuperseded = (message: MagicTeaPartyMessage): boolean => {
  const meta = message.meta && typeof message.meta === 'object' ? (message.meta as Record<string, unknown>) : null;
  return Boolean(meta && meta.superseded === true);
};

const shouldIncludeInHistory = (message: MagicTeaPartyMessage): boolean => {
  if (message.role === 'user') return true;
  if (message.role !== 'assistant') return false;
  if (message.status === 'blocked' || message.status === 'error') return false;
  if (isMessageSuperseded(message)) return false;
  return true;
};

type BuildHistoryOptions = {
  includeEmptyContent?: boolean;
  extraFilter?: (message: MagicTeaPartyMessage) => boolean;
};

export const buildMagicTeaPartyHistory = (
  messages: MagicTeaPartyMessage[],
  options?: BuildHistoryOptions
): MagicTeaPartyHistoryMessage[] => {
  const includeEmptyContent = options?.includeEmptyContent ?? true;
  const extraFilter = options?.extraFilter;

  return messages
    .filter(shouldIncludeInHistory)
    .filter((message) => (extraFilter ? extraFilter(message) : true))
    .filter((message) => {
      if (includeEmptyContent) return true;
      return typeof message.content === 'string' && message.content.trim().length > 0;
    })
    .map((message) => ({ id: message.id, role: message.role, content: message.content }));
};

export type TrimMagicTeaPartyHistoryOptions = {
  maxMessages: number;
  tokenBudget: number;
  providerId?: string | null;
  userDisplayName?: string;
  minKeep?: number;
};

export const trimMagicTeaPartyHistory = (
  history: MagicTeaPartyHistoryMessage[],
  options: TrimMagicTeaPartyHistoryOptions
): MagicTeaPartyHistoryMessage[] => {
  if (!Array.isArray(history) || history.length === 0) return [];

  const maxMessages = Number.isFinite(options.maxMessages) ? Math.max(1, Math.floor(options.maxMessages)) : history.length;
  const minKeepRaw = typeof options.minKeep === 'number' ? options.minKeep : 1;
  const minKeep = Number.isFinite(minKeepRaw) ? Math.max(1, Math.floor(minKeepRaw)) : 1;
  const trimmedByCount = history.slice(-maxMessages);

  const budget = Number.isFinite(options.tokenBudget) ? Math.max(0, Math.floor(options.tokenBudget)) : 0;
  if (budget <= 0 || trimmedByCount.length <= minKeep) {
    return trimmedByCount.slice(-minKeep);
  }

  const userLabel = options.userDisplayName?.trim() || '{{user}}';
  const kept: MagicTeaPartyHistoryMessage[] = [];
  let usedTokens = 0;

  for (let idx = trimmedByCount.length - 1; idx >= 0; idx -= 1) {
    const message = trimmedByCount[idx];
    const prefix = message.role === 'user' ? userLabel : message.role;
    const line = `${prefix}: ${message.content}`;
    const estimate = estimateMagicTeaPartyTokens(line, options.providerId);

    if (kept.length < minKeep || usedTokens + estimate <= budget) {
      kept.push(message);
      usedTokens += estimate;
    }
  }

  return kept.reverse();
};
