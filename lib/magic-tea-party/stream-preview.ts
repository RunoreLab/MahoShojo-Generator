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

const buildPreviewContentFromSegments = (segments: MagicTeaPartyMessage['segments'] | undefined): string => {
  if (!segments || segments.length === 0) return '';
  const lines: string[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.type === 'narration') {
      if (seg.text) lines.push(seg.text);
      continue;
    }
    if (seg.type === 'dialogue') {
      const name = seg.speakerName || seg.speakerId || '角色';
      lines.push(`${name}: ${seg.text}`);
      continue;
    }
    if (seg.type === 'choices') {
      for (const item of seg.items) {
        lines.push(`- ${item.text}`);
      }
    }
  }
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
        lastNoticeCount = 0;
      }
      lastSafeSnapshot = safeText;
      const notices =
        jsonlStreamState.notices.length > lastNoticeCount
          ? jsonlStreamState.notices.slice(lastNoticeCount)
          : [];
      lastNoticeCount = jsonlStreamState.notices.length;

      onUpdate({
        content: buildPreviewContentFromSegments(jsonlStreamState.segments),
        status,
        includeJsonl: true,
        segments: [...jsonlStreamState.segments],
        choices: jsonlStreamState.choices ? [...jsonlStreamState.choices] : undefined,
        notices,
      });
    },
  };
}
