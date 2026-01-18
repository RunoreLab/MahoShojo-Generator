import { createMagicTeaPartyJsonlStreamState, ingestMagicTeaPartyJsonlChunk } from '@/lib/magic-tea-party/jsonl';
import type { MagicTeaPartyMessage, MagicTeaPartyNotice, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

type MagicTeaPartyOutputFormat = NonNullable<MagicTeaPartySession['settings']['outputFormat']>;

export type MagicTeaPartyStreamPreviewUpdate = {
  content: string;
  status?: MagicTeaPartyMessage['status'];
  includeJsonl: boolean;
  segments?: MagicTeaPartyMessage['segments'];
  choices?: MagicTeaPartyMessage['choices'];
  notices?: MagicTeaPartyNotice[];
};

export type MagicTeaPartyStreamPreviewController = {
  applySafeText: (safeText: string, status?: MagicTeaPartyMessage['status']) => void;
};

type StreamPreviewOptions = {
  outputFormat: MagicTeaPartyOutputFormat;
  onUpdate: (update: MagicTeaPartyStreamPreviewUpdate) => void;
};

const buildPreviewContentFromState = (state: ReturnType<typeof createMagicTeaPartyJsonlStreamState>): string => {
  const lines = Array.isArray(state.previewLines) ? [...state.previewLines] : [];
  const tail = state.buffer;
  if (tail) lines.push(tail);
  return lines.join('\n');
};

export function createMagicTeaPartyStreamPreview(options: StreamPreviewOptions): MagicTeaPartyStreamPreviewController {
  const { outputFormat, onUpdate } = options;

  if (outputFormat !== 'jsonl') {
    return {
      applySafeText: (safeText, status) => {
        onUpdate({ content: safeText, status, includeJsonl: false });
      },
    };
  }

  const jsonlStreamState = createMagicTeaPartyJsonlStreamState();
  let lastSafeSnapshot = '';
  let lastNoticeCount = 0;

  return {
    applySafeText: (safeText, status) => {
      if (safeText.startsWith(lastSafeSnapshot)) {
        const delta = safeText.slice(lastSafeSnapshot.length);
        ingestMagicTeaPartyJsonlChunk(jsonlStreamState, delta);
      } else {
        const resetState = createMagicTeaPartyJsonlStreamState();
        ingestMagicTeaPartyJsonlChunk(resetState, safeText);
        jsonlStreamState.buffer = resetState.buffer;
        jsonlStreamState.segments = resetState.segments;
        jsonlStreamState.choices = resetState.choices;
        jsonlStreamState.notices = resetState.notices;
        jsonlStreamState.previewLines = resetState.previewLines;
        lastNoticeCount = 0;
      }
      lastSafeSnapshot = safeText;
      const notices =
        jsonlStreamState.notices.length > lastNoticeCount
          ? jsonlStreamState.notices.slice(lastNoticeCount)
          : [];
      lastNoticeCount = jsonlStreamState.notices.length;

      onUpdate({
        content: buildPreviewContentFromState(jsonlStreamState),
        status,
        includeJsonl: true,
        segments: [...jsonlStreamState.segments],
        choices: jsonlStreamState.choices ? [...jsonlStreamState.choices] : undefined,
        notices,
      });
    },
  };
}
