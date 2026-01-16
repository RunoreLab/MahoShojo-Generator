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
