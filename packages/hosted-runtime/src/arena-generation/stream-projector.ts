import type { GenerationEventInput } from '@mahoshojo/hosted-api/arena-generation/service';

const META_GUARD_CHARS = 256;
const META_RAW_LIMIT = 8_000;
const META_START = /<!---*\s*(MAHOSHOJO_ARENA_META|MAHOSHOJO_META|MAHOSHOJO_STREAM_META)\b/iu;

export type ArenaStreamProjectionResult = {
  metaEvent: GenerationEventInput | null;
};

export type ArenaStreamProjector = {
  push(_chunk: string): string[];
  finish(): { markdown: string[] };
  result(): ArenaStreamProjectionResult;
};

export const createArenaStreamProjector = (
  options: { expectsMeta: boolean },
): ArenaStreamProjector => {
  let pending = '';
  let metaBuffer: string | null = null;
  let trailing = '';
  let finished = false;
  let metaEvent: GenerationEventInput | null = null;

  const push = (chunk: string): string[] => {
    if (finished) throw new Error('ARENA_STREAM_PROJECTOR_FINISHED');
    if (!chunk) return [];
    if (!options.expectsMeta) return [chunk];
    if (metaBuffer !== null) {
      const endBefore = metaBuffer.indexOf('-->');
      if (endBefore >= 0) {
        trailing += chunk;
        return [];
      }
      metaBuffer += chunk;
      const end = metaBuffer.indexOf('-->');
      if (end >= 0) {
        trailing += metaBuffer.slice(end + '-->'.length);
        metaBuffer = metaBuffer.slice(0, end + '-->'.length);
      }
      return [];
    }

    pending += chunk;
    const match = META_START.exec(pending);
    if (match && typeof match.index === 'number') {
      const markdown = pending.slice(0, match.index);
      metaBuffer = pending.slice(match.index);
      pending = '';
      const end = metaBuffer.indexOf('-->');
      if (end >= 0) {
        trailing = metaBuffer.slice(end + '-->'.length);
        metaBuffer = metaBuffer.slice(0, end + '-->'.length);
      }
      return markdown ? [markdown] : [];
    }

    if (pending.length <= META_GUARD_CHARS) return [];
    const safe = pending.slice(0, pending.length - META_GUARD_CHARS);
    pending = pending.slice(-META_GUARD_CHARS);
    return safe ? [safe] : [];
  };

  const parseMeta = (): GenerationEventInput | null => {
    if (!metaBuffer) {
      return options.expectsMeta
        ? {
          type: 'meta_error',
          data: { parseOk: false, error: '未检测到 MAHOSHOJO_ARENA_META' },
        }
        : null;
    }
    const raw = metaBuffer;
    const marker = META_START.exec(raw);
    const end = raw.lastIndexOf('-->');
    if (!marker || end < 0) {
      return {
        type: 'meta_error',
        data: {
          parseOk: false,
          error: 'MAHOSHOJO_ARENA_META 未闭合',
          raw: raw.slice(0, 2_000),
          rawTruncated: raw.length > 2_000,
        },
      };
    }
    const payloadStart = marker.index + marker[0].length;
    const jsonText = raw.slice(payloadStart, end).trim().replace(/^[:=]\s*/u, '');
    try {
      const meta = JSON.parse(jsonText) as unknown;
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('invalid');
      return {
        type: 'meta',
        data: {
          parseOk: true,
          meta,
          raw: raw.slice(0, META_RAW_LIMIT),
          rawTruncated: raw.length > META_RAW_LIMIT,
        },
      };
    } catch {
      return {
        type: 'meta_error',
        data: {
          parseOk: false,
          error: 'MAHOSHOJO_ARENA_META JSON 无效',
          raw: raw.slice(0, 2_000),
          rawTruncated: raw.length > 2_000,
        },
      };
    }
  };

  return Object.freeze({
    push,
    finish(): { markdown: string[] } {
      if (finished) return { markdown: [] };
      finished = true;
      metaEvent = options.expectsMeta ? parseMeta() : null;
      const markdown = [pending, trailing].filter(Boolean);
      pending = '';
      trailing = '';
      return { markdown };
    },
    result: () => ({ metaEvent }),
  });
};
