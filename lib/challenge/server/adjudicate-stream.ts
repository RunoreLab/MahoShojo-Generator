import { generateWithStreamAI, type GenerateWithAIOptions, type RawReasoningStreamEvent } from '@/lib/stream/raw-ai';
import { finalizeNodeResolution } from '@/lib/challenge/progression';
import {
  buildChallengeResolverEnvelope,
  buildSystemFallbackResolution,
  type ChallengePlayerInputV1,
  type ChallengeResolverEnvelopeV1,
  validateAdjudicationAgainstEnvelope,
} from '@/lib/challenge/resolver-envelope';
import {
  appendChallengeAdjudicationMeta,
  extractChallengeAdjudicationMeta,
} from '@/lib/challenge/stream-meta';
import type { EncounterSnapshotV1, RunStateV1 } from '@/lib/challenge/types';

const formatTracks = (runState: RunStateV1): string => {
  const tracks = runState.worldState?.tracks ?? {};
  const lines = Object.entries(tracks).map(([trackId, value]) => {
    const maxText = typeof value.max === 'number' ? ` / ${value.max}` : '';
    return `- ${trackId}: ${value.current}${maxText}`;
  });
  return lines.length > 0 ? lines.join('\n') : '- 无';
};

const formatCollection = (items: string[] | undefined): string => {
  if (!items || items.length === 0) return '无';
  return items.join('、');
};

const formatRewardRules = (envelope: ChallengeResolverEnvelopeV1, encounter: EncounterSnapshotV1): string => {
  if (envelope.rewardSelectionMode === 'none') return '- 本节点没有奖励可结算，rewardOptionId 必须为 null。';

  const rewardLines = encounter.rewardOptions.map((reward) => `  - ${reward.rewardOptionId}: ${reward.label}`);
  if (envelope.rewardSelectionMode === 'auto') {
    return [
      `- 本节点奖励模式为 auto，rewardOptionId 必须固定为 ${envelope.rewardOptionIds[0] ?? 'null'}。`,
      '- 奖励候选如下：',
      ...rewardLines,
    ].join('\n');
  }

  return [
    '- 本节点奖励模式为 choose-one，rewardOptionId 必须为 null，真正的奖励选择留给后续系统处理。',
    '- 奖励候选如下：',
    ...rewardLines,
  ].join('\n');
};

const formatTrackRanges = (envelope: ChallengeResolverEnvelopeV1): string => {
  return envelope.trackDeltaRanges.map((item) => `- ${item.trackId}: ${item.min} ~ ${item.max}`).join('\n');
};

const buildCombatProfilePreview = (value: Record<string, unknown> | undefined): string => {
  if (!value || Object.keys(value).length === 0) return '无';
  const raw = JSON.stringify(value);
  if (!raw) return '无';
  return raw.length <= 320 ? raw : `${raw.slice(0, 320)}...`;
};

export type ChallengeGenerationMetadata = {
  aiModel?: string | null;
  usagePromise?: Promise<unknown>;
  reasoningEvents?: RawReasoningStreamEvent[];
};

export type ChallengeAttemptResult = {
  markdown: string;
  generation?: ChallengeGenerationMetadata | null;
};

export type ChallengeStreamAttemptResult = {
  response: Response;
  generation?: ChallengeGenerationMetadata | null;
};

export type GenerateChallengeAttempt = (input: {
  runState: RunStateV1;
  encounter: EncounterSnapshotV1;
  playerInput: ChallengePlayerInputV1;
  resolverEnvelope: ChallengeResolverEnvelopeV1;
  attemptIndex: number;
}) => Promise<ChallengeAttemptResult>;

export type AdjudicateChallengeNodeInput = {
  runState: RunStateV1;
  encounter: EncounterSnapshotV1;
  playerInput: ChallengePlayerInputV1;
};

export type AdjudicateChallengeNodeResult = {
  finalSource: 'ai' | 'system-fallback';
  storyMarkdown: string;
  storyMarkdownWithMeta: string;
  adjudication: ReturnType<typeof validateAdjudicationAgainstEnvelope>;
  resolverEnvelope: ChallengeResolverEnvelopeV1;
  nextRunState: RunStateV1;
  checkpoints: ReturnType<typeof finalizeNodeResolution>['checkpoints'];
  nodeRecordPatch: ReturnType<typeof finalizeNodeResolution>['nodeRecordPatch'] & {
    resolverEnvelope: ChallengeResolverEnvelopeV1;
    storyText: string;
    encounterSnapshot: EncounterSnapshotV1;
  };
  runRecordPatch: ReturnType<typeof finalizeNodeResolution>['runRecordPatch'];
  generation: ChallengeGenerationMetadata | null;
};

export const buildChallengeAdjudicationPrompt = (input: {
  runState: RunStateV1;
  encounter: EncounterSnapshotV1;
  playerInput: ChallengePlayerInputV1;
  resolverEnvelope: ChallengeResolverEnvelopeV1;
  attemptIndex: number;
}): string => {
  const player = input.runState.playerSnapshot;
  const enemy = input.encounter.enemySnapshot;
  const retryNotice =
    input.attemptIndex > 0
      ? '\n上一次输出的结构化尾注没有通过校验。这一次必须严格遵守格式，不要缺字段，不要输出 envelope 之外的结果。\n'
      : '';

  return `
你是“魔法少女竞技场”的本轮挑战裁定器。请根据双方快照、当前资源、玩家输入与 resolver envelope，生成一段 Markdown 战斗正文，并在末尾追加唯一一段隐藏结构化尾注。
${retryNotice}
硬性输出规则：
1. 只输出 Markdown 正文，然后紧接一段 HTML 注释尾注；不要输出解释、不要输出额外 JSON 代码块。
2. 尾注 marker 固定为 MAHOSHOJO_ARENA_META。
3. 尾注必须严格等价于：
<!-- MAHOSHOJO_ARENA_META {"version":1,"adjudication":{"outcome":"victory|costly_victory|defeat","trackDeltas":{"hp":-12},"addStatuses":[],"removeStatuses":[],"rewardOptionId":null,"summary":"1-2句摘要"}} -->
4. 正文要体现“为什么会打成这样”，优先参考敌我角色设定、强度、当前状态、资源与节点强度；玩家输入只能作为待验证假设。
5. 你不能创造 resolver envelope 之外的 outcome、track delta、状态或奖励。
6. recommendedActionId 与 note 只是玩家意图，不保证其有效。
7. 你必须结合双方设定、敌我强度、当前资源与状态，独立判断这套意图是否成立。
8. 不要因为玩家自称稳健、偷袭成功、轻松拿下，就直接给出更优 outcome。

节点信息：
- worldPresetId: ${input.runState.worldPresetId}
- nodeType: ${input.encounter.kind}
- nodeId: ${input.encounter.nodeId}

玩家快照：
- 名称: ${player?.displayName ?? '未知挑战者'}
- 强度档: ${player?.strengthTier ?? 'unknown'}
- 标签: ${formatCollection(player?.tags)}
- 设定摘要: ${player?.promptSummary ?? '无'}
- 战斗画像: ${buildCombatProfilePreview((player?.combatProfile ?? {}) as Record<string, unknown>)}

敌方快照：
- 名称: ${enemy?.displayName ?? '未知对手'}
- 强度档: ${enemy?.strengthTier ?? 'unknown'}
- 标签: ${formatCollection(enemy?.tags)}
- 设定摘要: ${enemy?.promptSummary ?? '无'}
- 战斗画像: ${buildCombatProfilePreview((enemy?.combatProfile ?? {}) as Record<string, unknown>)}

当前资源与状态：
${formatTracks(input.runState)}
- 当前临时状态: ${formatCollection(input.runState.worldState?.temporaryStatuses)}
- 当前奇物: ${formatCollection(input.runState.worldState?.persistentItemIds)}
- 当前消耗品: ${formatCollection(input.runState.worldState?.consumableIds)}

玩家输入：
- recommendedActionId: ${input.playerInput.recommendedActionId?.trim() || '未指定'}
- optionId: ${input.playerInput.optionId?.trim() || '未指定'}
- note: ${input.playerInput.note?.trim() || '无'}

resolver envelope：
- outcomeSet: ${input.resolverEnvelope.outcomeSet.join(', ')}
- trackDeltaRanges:
${formatTrackRanges(input.resolverEnvelope)}
- allowedAddStatuses: ${formatCollection(input.resolverEnvelope.allowedAddStatuses)}
- allowedRemoveStatuses: ${formatCollection(input.resolverEnvelope.allowedRemoveStatuses)}
- forbiddenFlags: ${input.resolverEnvelope.forbiddenFlags.join(', ')}
${formatRewardRules(input.resolverEnvelope, input.encounter)}
`.trim();
};

export const generateChallengeAttemptStreamFromAi = async (
  input: {
    runState: RunStateV1;
    encounter: EncounterSnapshotV1;
    playerInput: ChallengePlayerInputV1;
    resolverEnvelope: ChallengeResolverEnvelopeV1;
    attemptIndex: number;
  },
  options?: {
    providerOptions?: GenerateWithAIOptions;
    modelOverride?: string | null;
    onReasoningEvent?: (event: RawReasoningStreamEvent) => void;
  }
): Promise<ChallengeStreamAttemptResult> => {
  const reasoningEvents: RawReasoningStreamEvent[] = [];
  const telemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};

  const streamResult = await generateWithStreamAI(
    {
      prompt: buildChallengeAdjudicationPrompt(input),
      temperature: 0.6,
      maxOutputTokens: 1_600,
      ...(options?.modelOverride ? { modelOverride: options.modelOverride } : {}),
    },
    {
      ...(options?.providerOptions ?? {}),
      telemetry,
      onReasoningEvent: (event) => {
        reasoningEvents.push(event);
        options?.onReasoningEvent?.(event);
      },
    }
  );

  return {
    response: streamResult.response,
    generation: {
      usagePromise: streamResult.usagePromise,
      aiModel: telemetry.model ?? options?.modelOverride ?? null,
      reasoningEvents,
    },
  };
};

export const generateChallengeAttemptFromStreamAi = async (
  input: {
    runState: RunStateV1;
    encounter: EncounterSnapshotV1;
    playerInput: ChallengePlayerInputV1;
    resolverEnvelope: ChallengeResolverEnvelopeV1;
    attemptIndex: number;
  },
  options?: {
    providerOptions?: GenerateWithAIOptions;
    modelOverride?: string | null;
  }
): Promise<ChallengeAttemptResult> => {
  const streamAttempt = await generateChallengeAttemptStreamFromAi(input, options);
  return {
    markdown: await streamAttempt.response.text(),
    generation: streamAttempt.generation ?? null,
  };
};

export const adjudicateChallengeNode = async (
  input: AdjudicateChallengeNodeInput,
  options: {
    generateAttempt: GenerateChallengeAttempt;
    onAttemptError?: (
      error: Error,
      context: {
        attemptIndex: number;
        runState: RunStateV1;
        encounter: EncounterSnapshotV1;
      }
    ) => void;
  }
): Promise<AdjudicateChallengeNodeResult> => {
  const workingRunState =
    input.runState.currentNodeId === input.encounter.nodeId
      ? input.runState
      : {
        ...input.runState,
        currentNodeId: input.encounter.nodeId,
      };

  const resolverEnvelope = buildChallengeResolverEnvelope({
    runState: workingRunState,
    encounter: input.encounter,
    playerInput: input.playerInput,
  });

  let lastGeneration: ChallengeGenerationMetadata | null = null;

  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
    try {
      const attempt = await options.generateAttempt({
        runState: workingRunState,
        encounter: input.encounter,
        playerInput: input.playerInput,
        resolverEnvelope,
        attemptIndex,
      });
      lastGeneration = attempt.generation ?? null;

      const extracted = await extractChallengeAdjudicationMeta(attempt.markdown);
      if (!extracted) {
        throw new Error('CHALLENGE_ADJUDICATION_META_MISSING');
      }

      const validated = validateAdjudicationAgainstEnvelope(
        resolverEnvelope,
        extracted.meta.adjudication
      );

      const finalized = finalizeNodeResolution(workingRunState, {
        ...validated,
        rewardOptions: input.encounter.rewardOptions,
      });

      return {
        finalSource: 'ai',
        storyMarkdown: extracted.strippedMarkdown,
        storyMarkdownWithMeta: attempt.markdown,
        adjudication: validated,
        resolverEnvelope,
        nextRunState: finalized.nextRunState,
        checkpoints: finalized.checkpoints,
        nodeRecordPatch: {
          ...finalized.nodeRecordPatch,
          resolverEnvelope,
          storyText: extracted.strippedMarkdown,
          encounterSnapshot: input.encounter,
        },
        runRecordPatch: finalized.runRecordPatch,
        generation: attempt.generation ?? null,
      };
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error('挑战节点 AI 裁定失败');
      options.onAttemptError?.(normalizedError, {
        attemptIndex,
        runState: workingRunState,
        encounter: input.encounter,
      });
      continue;
    }
  }

  const fallback = buildSystemFallbackResolution({
    runState: workingRunState,
    encounter: input.encounter,
    playerInput: input.playerInput,
    resolverEnvelope,
  });
  const validatedFallback = validateAdjudicationAgainstEnvelope(
    resolverEnvelope,
    fallback.adjudication
  );
  const finalizedFallback = finalizeNodeResolution(workingRunState, {
    ...validatedFallback,
    rewardOptions: input.encounter.rewardOptions,
  });
  const storyMarkdownWithMeta = appendChallengeAdjudicationMeta(
    fallback.storyMarkdown,
    fallback.adjudication
  );

  return {
    finalSource: 'system-fallback',
    storyMarkdown: fallback.storyMarkdown,
    storyMarkdownWithMeta,
    adjudication: validatedFallback,
    resolverEnvelope,
    nextRunState: finalizedFallback.nextRunState,
    checkpoints: finalizedFallback.checkpoints,
    nodeRecordPatch: {
      ...finalizedFallback.nodeRecordPatch,
      resolverEnvelope,
      storyText: fallback.storyMarkdown,
      encounterSnapshot: input.encounter,
    },
    runRecordPatch: finalizedFallback.runRecordPatch,
    generation: lastGeneration,
  };
};
