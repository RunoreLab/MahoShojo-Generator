'use client';

import { stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';
import { finalizeNodeResolution } from '@/lib/challenge/progression';
import {
  buildChallengeResolverEnvelope,
  validateAdjudicationAgainstEnvelope,
  type ChallengePlayerInputV1,
} from '@/lib/challenge/resolver-envelope';
import { extractChallengeAdjudicationMeta } from '@/lib/challenge/stream-meta';
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
      body: JSON.stringify({
        runState: activeRunState,
        encounter: input.encounter,
        playerInput: input.playerInput,
        ...(typeof input.customProvider === 'undefined' ? {} : { customProvider: input.customProvider }),
      }),
    });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
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
