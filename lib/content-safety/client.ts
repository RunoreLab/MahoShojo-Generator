import { quickCheck } from '@/lib/sensitive-word-filter';

const isSensitiveWordFilterEnabled = (): boolean =>
  (process.env.NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER ?? 'true') === 'true';

export type ArrestedRedirectTarget =
  | string
  | {
      pathname: '/arrested';
      query?: Record<string, string>;
    };

export const buildArrestedRedirectTarget = (reason?: string): ArrestedRedirectTarget => {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmed) return '/arrested';
  return {
    pathname: '/arrested',
    query: { reason: trimmed },
  };
};

export const getSensitiveWordRedirectTarget = async (
  text: string,
  options?: {
    reason?: string;
    enabled?: boolean;
  }
): Promise<ArrestedRedirectTarget | null> => {
  const enabled = options?.enabled ?? isSensitiveWordFilterEnabled();
  if (!enabled) return null;

  const check = await quickCheck(text);
  if (!check.hasSensitiveWords) return null;
  return buildArrestedRedirectTarget(options?.reason);
};
