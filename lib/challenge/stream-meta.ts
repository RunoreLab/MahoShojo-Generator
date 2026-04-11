import { z } from 'zod/v3';

import { stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';
import { repairNormalizeValidate } from '@/lib/repair-pipeline';

export type ChallengeAdjudicationOutcome = 'victory' | 'costly_victory' | 'defeat';

export const ChallengeAdjudicationResultSchema = z
  .object({
    outcome: z.enum(['victory', 'costly_victory', 'defeat']),
    trackDeltas: z.record(z.number().finite()).default({}),
    addStatuses: z.array(z.string()).default([]),
    removeStatuses: z.array(z.string()).default([]),
    rewardOptionId: z.string().min(1).nullable(),
    summary: z.string().min(1),
  })
  .passthrough();

export type ChallengeAdjudicationResultV1 = z.infer<typeof ChallengeAdjudicationResultSchema>;

export const ChallengeAdjudicationStreamMetaSchema = z
  .object({
    version: z.number().int().min(1),
    adjudication: ChallengeAdjudicationResultSchema,
  })
  .passthrough();

export type ChallengeAdjudicationStreamMetaV1 = z.infer<typeof ChallengeAdjudicationStreamMetaSchema>;

export type ExtractedChallengeAdjudicationMeta = {
  meta: ChallengeAdjudicationStreamMetaV1;
  rawComment: string;
  strippedMarkdown: string;
};

const findJsonishCandidate = (input: string): string | null => {
  if (typeof input !== 'string' || !input.trim()) return null;

  const startObject = input.indexOf('{');
  const startArray = input.indexOf('[');
  const start =
    startObject === -1 ? startArray : startArray === -1 ? startObject : Math.min(startObject, startArray);

  if (start === -1) return null;

  const lastObject = input.lastIndexOf('}');
  const lastArray = input.lastIndexOf(']');
  const end = Math.max(lastObject, lastArray);

  if (end > start) {
    return input.slice(start, end + 1).trim();
  }

  return input.slice(start).trim();
};

const sanitizeAdjudication = (
  value: ChallengeAdjudicationResultV1
): ChallengeAdjudicationResultV1 => {
  const normalizeStatuses = (items: string[]) =>
    Array.from(
      new Set(
        items
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
      )
    );

  const trackDeltas = Object.fromEntries(
    Object.entries(value.trackDeltas ?? {})
      .filter(
        ([trackId, delta]) =>
          typeof trackId === 'string'
          && trackId.trim().length > 0
          && typeof delta === 'number'
          && Number.isFinite(delta)
      )
      .map(([trackId, delta]) => [trackId.trim(), Math.trunc(delta)])
  );

  const rewardOptionId =
    typeof value.rewardOptionId === 'string' && value.rewardOptionId.trim().length > 0
      ? value.rewardOptionId.trim()
      : null;

  return {
    ...value,
    trackDeltas,
    addStatuses: normalizeStatuses(value.addStatuses ?? []),
    removeStatuses: normalizeStatuses(value.removeStatuses ?? []),
    rewardOptionId,
    summary: value.summary.trim(),
  };
};

export const serializeChallengeAdjudicationMeta = (
  adjudication: ChallengeAdjudicationResultV1
): string => {
  return `<!-- MAHOSHOJO_ARENA_META ${JSON.stringify({
    version: 1,
    adjudication: sanitizeAdjudication(adjudication),
  })} -->`;
};

export const appendChallengeAdjudicationMeta = (
  markdown: string,
  adjudication: ChallengeAdjudicationResultV1
): string => {
  const content = typeof markdown === 'string' ? markdown.trimEnd() : '';
  const metaComment = serializeChallengeAdjudicationMeta(adjudication);
  return content ? `${content}\n${metaComment}` : metaComment;
};

export const extractChallengeAdjudicationMeta = async (
  markdown: string
): Promise<ExtractedChallengeAdjudicationMeta | null> => {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;

  const stripped = stripStreamUpdateMetaComment(markdown);
  if (!stripped) return null;

  const candidate = findJsonishCandidate(stripped.rawComment);
  if (!candidate) {
    throw new Error('CHALLENGE_ADJUDICATION_META_JSON_MISSING');
  }

  const meta = await repairNormalizeValidate({
    input: candidate,
    schema: ChallengeAdjudicationStreamMetaSchema,
    unwrapCandidates: ['meta', 'data', 'payload', 'result', 'value'],
    textFieldCandidates: ['json', 'text', 'raw', 'content', 'body'],
    coerce: { wrapSingleToArray: true, emptyStringToUndefined: true },
    postProcess: (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const record = value as Record<string, unknown>;
      if (record.adjudication && typeof record.adjudication === 'object' && !Array.isArray(record.adjudication)) {
        const adjudication = record.adjudication as Record<string, unknown>;
        if (!Array.isArray(adjudication.addStatuses)) adjudication.addStatuses = [];
        if (!Array.isArray(adjudication.removeStatuses)) adjudication.removeStatuses = [];
        if (!adjudication.trackDeltas || typeof adjudication.trackDeltas !== 'object' || Array.isArray(adjudication.trackDeltas)) {
          adjudication.trackDeltas = {};
        }
      }
      return record;
    },
    as: 'object',
  });

  const normalizedMeta = {
    ...(meta as ChallengeAdjudicationStreamMetaV1),
    adjudication: sanitizeAdjudication((meta as ChallengeAdjudicationStreamMetaV1).adjudication),
  };

  return {
    meta: normalizedMeta,
    rawComment: stripped.rawComment,
    strippedMarkdown: stripped.strippedMarkdown,
  };
};
