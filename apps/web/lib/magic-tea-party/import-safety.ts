import { persistArrestedBackup } from '@/lib/arrested-backup';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { applyShieldWords } from '@/lib/shield-word-filter';

export type MagicTeaPartySensitiveCheckParams = {
  text: string;
  reason: string;
  origin: string;
  label: string;
  filename?: string;
  mimeType?: string;
};

export type MagicTeaPartySensitiveCheckResult = {
  blocked: boolean;
  redirectTarget?: string;
};

export async function checkMagicTeaPartySensitiveText(
  params: MagicTeaPartySensitiveCheckParams
): Promise<MagicTeaPartySensitiveCheckResult> {
  const trimmed = params.text.trim();
  if (!trimmed) return { blocked: false };
  const redirectTarget = await getSensitiveWordRedirectTarget(trimmed, { reason: params.reason });
  if (!redirectTarget) return { blocked: false };

  persistArrestedBackup({
    triggerSource: 'input',
    reason: params.reason,
    origin: params.origin,
    items: [
      {
        label: params.label,
        filename: params.filename ?? 'magic-tea-party-import.txt',
        mimeType: params.mimeType ?? 'text/plain',
        content: trimmed,
      },
    ],
  });

  return { blocked: true, redirectTarget: redirectTarget as string };
}

export type MagicTeaPartyMaskResult<T> = {
  value: T;
  hasShieldWords: boolean;
  detectedWords: string[];
};

export const maskMagicTeaPartyText = (text: string): MagicTeaPartyMaskResult<string> => {
  const result = applyShieldWords(text);
  return {
    value: result.filteredText,
    hasShieldWords: result.hasShieldWords,
    detectedWords: result.detectedWords ?? [],
  };
};

export const maskMagicTeaPartyJsonValue = <T,>(value: T): MagicTeaPartyMaskResult<T> => {
  const detected = new Set<string>();
  let hasShieldWords = false;

  const maskValue = (input: unknown): unknown => {
    if (typeof input === 'string') {
      const masked = maskMagicTeaPartyText(input);
      if (masked.hasShieldWords) {
        hasShieldWords = true;
        masked.detectedWords.forEach((word) => detected.add(word));
      }
      return masked.value;
    }
    if (Array.isArray(input)) return input.map((item) => maskValue(item));
    if (!input || typeof input !== 'object') return input;
    const record = input as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, val]) => {
      next[key] = maskValue(val);
    });
    return next;
  };

  const maskedValue = maskValue(value) as T;
  return { value: maskedValue, hasShieldWords, detectedWords: Array.from(detected) };
};
