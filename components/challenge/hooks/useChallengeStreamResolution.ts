'use client';

import { stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';
import { finalizeNodeResolution } from '@/lib/challenge/progression';
import {
  buildChallengeResolverEnvelope,
  buildSystemFallbackResolution,
  validateAdjudicationAgainstEnvelope,
  type ChallengePlayerInputV1,
} from '@/lib/challenge/resolver-envelope';
import { appendChallengeAdjudicationMeta, extractChallengeAdjudicationMeta } from '@/lib/challenge/stream-meta';
import type {
  ChallengeNodeRecord,
  EncounterSnapshotV1,
  RunStateV1,
} from '@/lib/challenge/types';
import { readTextAndReasoningStreamFromResponse } from '@/lib/stream/read-text-and-reasoning-stream';

export type ChallengeNodeExecutionMode = 'ai' | 'system';

export const resolveNodeExecutionMode = (
  encounter: EncounterSnapshotV1
): ChallengeNodeExecutionMode => {
  if (encounter.kind === 'battle' || encounter.kind === 'elite' || encounter.kind === 'boss') {
    return 'ai';
  }
  if (encounter.kind === 'event') {
    return encounter.inputMode === 'choice-only' ? 'system' : 'ai';
  }
  return 'system';
};

const sanitizeStreamingMarkdown = (markdown: string): string => {
  const stripped = stripStreamUpdateMetaComment(markdown);
  return stripped?.strippedMarkdown ?? markdown;
};

const isAbortLikeError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'AbortError';
};

const readErrorMessage = async (response: Response): Promise<string> => {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
      if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
    }
  }

  const text = await response.text().catch(() => '');
  return text.trim() || '挑战流式裁定失败。';
};

export type RunChallengeStreamResolutionInput = {
  runState: RunStateV1;
  encounter: EncounterSnapshotV1;
  playerInput: ChallengePlayerInputV1;
  baseNodeRecord: ChallengeNodeRecord;
  response?: Response;
  apiPath?: string;
  customProvider?: unknown;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  onText?: (text: string) => void;
};

export type RunChallengeStreamResolutionResult = {
  storyMarkdown: string;
  storyMarkdownWithMeta: string;
  adjudication: ReturnType<typeof validateAdjudicationAgainstEnvelope>;
  resolverEnvelope: ReturnType<typeof buildChallengeResolverEnvelope>;
  nextRunState: RunStateV1;
  checkpoints: ReturnType<typeof finalizeNodeResolution>['checkpoints'];
  nodeRecord: ChallengeNodeRecord;
  runRecordPatch: ReturnType<typeof finalizeNodeResolution>['runRecordPatch'];
  reasoning: Awaited<ReturnType<typeof readTextAndReasoningStreamFromResponse>>['reasoning'];
  telemetry: Awaited<ReturnType<typeof readTextAndReasoningStreamFromResponse>>['telemetry'];
};

export type ResolveChallengeNodeWithStreamingFallbackResult = RunChallengeStreamResolutionResult & {
  finalSource: 'ai' | 'system-fallback';
  fallbackReason: string | null;
};

export const isChallengeStreamAbortError = (error: unknown): boolean => isAbortLikeError(error);

const buildChallengeSystemFallbackResult = (
  input: RunChallengeStreamResolutionInput & {
    fallbackReason: string;
  }
): ResolveChallengeNodeWithStreamingFallbackResult => {
  const activeRunState =
    input.runState.currentNodeId === input.encounter.nodeId
      ? input.runState
      : {
        ...input.runState,
        currentNodeId: input.encounter.nodeId,
      };

  const resolverEnvelope = buildChallengeResolverEnvelope({
    runState: activeRunState,
    encounter: input.encounter,
    playerInput: input.playerInput,
  });
  const fallback = buildSystemFallbackResolution({
    runState: activeRunState,
    encounter: input.encounter,
    playerInput: input.playerInput,
    resolverEnvelope,
  });
  const adjudication = validateAdjudicationAgainstEnvelope(resolverEnvelope, fallback.adjudication);
  const finalized = finalizeNodeResolution(activeRunState, {
    ...adjudication,
    rewardOptions: input.encounter.rewardOptions,
  });
  const storyMarkdownWithMeta = appendChallengeAdjudicationMeta(fallback.storyMarkdown, fallback.adjudication);

  return {
    finalSource: 'system-fallback',
    fallbackReason: input.fallbackReason,
    storyMarkdown: fallback.storyMarkdown,
    storyMarkdownWithMeta,
    adjudication,
    resolverEnvelope,
    nextRunState: finalized.nextRunState,
    checkpoints: finalized.checkpoints,
    nodeRecord: {
      ...input.baseNodeRecord,
      ...finalized.nodeRecordPatch,
      encounterSnapshot: input.encounter,
      playerInput: {
        recommendedActionId: input.playerInput.recommendedActionId ?? '',
        optionId: input.playerInput.optionId ?? '',
        note: input.playerInput.note ?? '',
      },
      resolverEnvelope,
      storyText: fallback.storyMarkdown,
    },
    runRecordPatch: finalized.runRecordPatch,
    reasoning: null,
    telemetry: null,
  };
};

const shouldFallbackForStreamError = (error: unknown): boolean => {
  if (isAbortLikeError(error)) return false;
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  if (typeof status !== 'number') return true;
  return status >= 500;
};

export async function runChallengeStreamResolution(
  input: RunChallengeStreamResolutionInput
): Promise<RunChallengeStreamResolutionResult> {
  const activeRunState =
    input.runState.currentNodeId === input.encounter.nodeId
      ? input.runState
      : {
        ...input.runState,
        currentNodeId: input.encounter.nodeId,
      };

  const response =
    input.response
    ?? await (input.fetcher ?? fetch)(input.apiPath ?? '/api/challenge/adjudicate-stream?format=sse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      signal: input.signal,
      body: JSON.stringify({
        runState: activeRunState,
        encounter: input.encounter,
        playerInput: input.playerInput,
        ...(typeof input.customProvider === 'undefined' ? {} : { customProvider: input.customProvider }),
      }),
    });

  if (!response.ok) {
    const error = new Error(await readErrorMessage(response));
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const streamResult = await readTextAndReasoningStreamFromResponse(response, {
    label: '挑战节点流式裁定',
    onText: (markdown) => {
      input.onText?.(sanitizeStreamingMarkdown(markdown));
    },
  });

  const extractedMeta = await extractChallengeAdjudicationMeta(streamResult.text);
  if (!extractedMeta) {
    throw new Error('挑战裁定结果缺少隐藏尾注。');
  }

  const resolverEnvelope = buildChallengeResolverEnvelope({
    runState: activeRunState,
    encounter: input.encounter,
    playerInput: input.playerInput,
  });
  const adjudication = validateAdjudicationAgainstEnvelope(
    resolverEnvelope,
    extractedMeta.meta.adjudication
  );
  const finalized = finalizeNodeResolution(activeRunState, {
    ...adjudication,
    rewardOptions: input.encounter.rewardOptions,
  });

  const nodeRecord: ChallengeNodeRecord = {
    ...input.baseNodeRecord,
    ...finalized.nodeRecordPatch,
    encounterSnapshot: input.encounter,
    playerInput: {
      recommendedActionId: input.playerInput.recommendedActionId ?? '',
      optionId: input.playerInput.optionId ?? '',
      note: input.playerInput.note ?? '',
    },
    resolverEnvelope,
    storyText: extractedMeta.strippedMarkdown,
  };

  return {
    storyMarkdown: extractedMeta.strippedMarkdown,
    storyMarkdownWithMeta: streamResult.text,
    adjudication,
    resolverEnvelope,
    nextRunState: finalized.nextRunState,
    checkpoints: finalized.checkpoints,
    nodeRecord,
    runRecordPatch: finalized.runRecordPatch,
    reasoning: streamResult.reasoning,
    telemetry: streamResult.telemetry,
  };
}

export async function resolveChallengeNodeWithStreamingFallback(
  input: RunChallengeStreamResolutionInput & {
    onStreamError?: (error: Error) => void;
  }
): Promise<ResolveChallengeNodeWithStreamingFallbackResult> {
  try {
    const result = await runChallengeStreamResolution(input);
    return {
      ...result,
      finalSource: 'ai',
      fallbackReason: null,
    };
  } catch (error) {
    if (!shouldFallbackForStreamError(error)) {
      throw error;
    }

    const normalizedError = error instanceof Error ? error : new Error('挑战流式裁定失败。');
    input.onStreamError?.(normalizedError);
    return buildChallengeSystemFallbackResult({
      ...input,
      fallbackReason: normalizedError.message,
    });
  }
}
