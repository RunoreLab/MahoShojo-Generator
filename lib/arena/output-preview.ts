import { buildContentPreview } from '@/lib/arena/battle-report-log-utils';

export type OutputPreviewMode = 'full' | 'truncate';

export type OutputPreviewStrategy = {
  mode: OutputPreviewMode;
  headChars: number;
  tailChars: number;
  ellipsis: string;
  /**
   * 流式场景：为避免把超长输出全部留在内存里，这里设置一个“最多保留多少字符作为 fullText”的上限。
   * - mode=full：只要没有超过上限，就会把完整输出写入 output_preview。
   * - mode=truncate：超过上限时会退化为 head/tail 拼接。
   */
  maxStoreChars: number;
};

const clampInt = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const n = value ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const readMode = (value: string | undefined): OutputPreviewMode => {
  const v = (value || '').trim().toLowerCase();
  if (v === 'truncate') return 'truncate';
  return 'full';
};

export const getOutputPreviewStrategy = (): OutputPreviewStrategy => {
  const mode = readMode(process.env.BATTLE_REPORT_OUTPUT_PREVIEW_MODE);
  const headChars = clampInt(process.env.BATTLE_REPORT_OUTPUT_PREVIEW_HEAD_CHARS, 800, 0, 200_000);
  const tailChars = clampInt(process.env.BATTLE_REPORT_OUTPUT_PREVIEW_TAIL_CHARS, 800, 0, 200_000);
  const maxStoreChars = clampInt(process.env.BATTLE_REPORT_OUTPUT_PREVIEW_MAX_STORE_CHARS, 2_000_000, 1_000, 20_000_000);
  const ellipsis = (process.env.BATTLE_REPORT_OUTPUT_PREVIEW_ELLIPSIS || '……').toString();
  return { mode, headChars, tailChars, ellipsis, maxStoreChars };
};

export const buildOutputPreviewForStorage = (text: string): string => {
  const strategy = getOutputPreviewStrategy();
  if (strategy.mode === 'full') return text;
  return buildContentPreview(text, { headChars: strategy.headChars, tailChars: strategy.tailChars, ellipsis: strategy.ellipsis });
};

export type OutputPreviewCollector = {
  append: (text: string) => void;
  finish: () => { outputPreview: string; didFallbackToTruncate: boolean };
};

export const createOutputPreviewCollector = (): OutputPreviewCollector => {
  const strategy = getOutputPreviewStrategy();
  const { headChars, tailChars, maxStoreChars, ellipsis, mode } = strategy;

  let headText = '';
  let tailText = '';
  let fullText: string | null = '';

  const append = (text: string) => {
    if (!text) return;

    if (fullText !== null) {
      if (fullText.length + text.length <= maxStoreChars) {
        fullText += text;
      } else {
        fullText = null;
      }
    }

    if (headChars > 0 && headText.length < headChars) {
      headText += text.slice(0, headChars - headText.length);
    }

    if (tailChars > 0) {
      tailText = (tailText + text).slice(-tailChars);
    }
  };

  const finish = (): { outputPreview: string; didFallbackToTruncate: boolean } => {
    const didFallbackToTruncate = fullText === null;

    if (mode === 'full') {
      if (fullText !== null) return { outputPreview: fullText, didFallbackToTruncate };
      return { outputPreview: `${headText}${ellipsis}${tailText}`, didFallbackToTruncate };
    }

    if (fullText !== null) {
      const outputPreview = buildContentPreview(fullText, { headChars, tailChars, ellipsis });
      return { outputPreview, didFallbackToTruncate };
    }

    // fullText 过长时：至少保证 head/tail 拼接可用
    return { outputPreview: `${headText}${ellipsis}${tailText}`, didFallbackToTruncate };
  };

  return { append, finish };
};

