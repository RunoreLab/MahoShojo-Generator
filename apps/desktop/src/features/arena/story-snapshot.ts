import {
  buildBattleStoryDeterministicDigest, buildBattleStorySummaryFallback,
  type BattleStoryChapterPlan,
} from '@mahoshojo/domain/arena-battle-story-session';
import type { BattleStoryArenaSeed } from '@mahoshojo/domain/arena-battle-story-request';
import { buildCompletedBattleStoryRecords, freezeBattleStoryCommit, type BattleStoryCommitSession } from '@mahoshojo/domain/arena-story-commit';
import { getArenaPostBattleWorldLineIndices } from '@mahoshojo/domain/arena-post-battle';
import { planUnsignedArenaPostBattleCandidates } from '@mahoshojo/domain/arena-post-battle-candidates';
import type { AdjudicationResult } from '@mahoshojo/domain/arena-types';
import { StorySourceSchema } from '@mahoshojo/contracts/desktop-arena-story';
import type { ArenaDirectOutcome } from './direct';
import { inheritedArenaAdjudication, type ArenaDraft, type DesktopArenaProduct } from './session';

export type StorySource = ReturnType<typeof StorySourceSchema.parse>;
export type StorySessionSnapshot = BattleStoryCommitSession & {
  source: StorySource; seed: Omit<BattleStoryArenaSeed, 'mode' | 'language' | 'storyLength' | 'customStoryLength'>;
  chapterPlan?: BattleStoryChapterPlan; sessionSummary?: string;
  summaryMeta?: { coveredUntilChapterIndex: number; coveredChapterIds: string[]; refreshedAt: number; mode: 'deterministic-fallback' };
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('连续故事角色快照无效');
  return value as Record<string, unknown>;
};

/** Same seed fields as the Hosted session. Single-shot drafts, teams' display names and
 * activity/history-reference lists are deliberately not extra implicit chapter inputs. */
export const captureDesktopStorySeed = (draft: ArenaDraft, product: DesktopArenaProduct): StorySessionSnapshot['seed'] => {
  return {
    combatants: draft.combatants.map((combatant) => ({ type: combatant.type, data: combatant.data, isNative: combatant.isValid, isPreset: combatant.isPreset, filename: combatant.isPreset ? combatant.filename : null, teamId: typeof combatant.teamId === 'number' ? combatant.teamId : null, characterGuidance: typeof combatant.characterGuidance === 'string' ? combatant.characterGuidance : null, sourceDataCardId: combatant.sourceDataCardId, sourceDataCardUpdatedAt: combatant.sourceDataCardUpdatedAt })),
    scenario: draft.battleMode === 'scenario' ? draft.scenario.content : null,
    auxScenarios: draft.battleMode === 'scenario' ? draft.auxScenarios.map((scenario) => scenario.content) : [],
    materials: [...draft.materials],
    questionnaires: (draft.selectedQuestionnaires ?? []).map(({ questionnaire, useLore }) => ({
      id: questionnaire.id, title: questionnaire.title, kind: questionnaire.kind,
      ...(useLore === false ? { useLore: false } : questionnaire.loreMarkdown ? { loreMarkdown: questionnaire.loreMarkdown } : {}),
    })),
    adjudicationEvents: inheritedArenaAdjudication(draft, product).events,
    settings: (({ userGuidance: _userGuidance, ...settings }) => settings)(draft.settings),
  };
};

/** Uses the canonical copy-on-write effect producer and completed-record assembly.
 * No amplified deep clone, no mutation of the single-shot draft or original card. */
export const completeDesktopStoryRecords = (input: {
  session: StorySessionSnapshot; action: 'start' | 'continue'; chapterIndex: number;
  operationId: string; checkpointId: string; initialCheckpointId?: string;
  now: number; source: StorySource; workingCombatants: unknown[]; userGuidance: string;
  outcome: Extract<ArenaDirectOutcome, { status: 'completed' }>; adjudicationResults: AdjudicationResult[];
}) => {
  const { outcome, session, workingCombatants, now } = input;
  const report = outcome.report as unknown as Record<string, unknown>;
  const settings = session.seed.settings;
  const effectsInput = {
    combatants: workingCombatants, report, impacts: outcome.impacts,
    userGuidance: input.userGuidance, scenario: session.seed.scenario ?? null,
    writeArenaHistory: settings.writeArenaHistory, writeCurrentState: settings.writeCurrentState,
    // The story's chapter is its narrative history. Never append into a single-shot activity draft.
    writeNarrativeHistory: false,
    narrativeHistory: { entries: [], title: outcome.report.headline, content: outcome.markdown },
  };
  const worldLineIds = Object.fromEntries(getArenaPostBattleWorldLineIndices({ ...effectsInput, generationId: outcome.requestId })
    .map((index) => [index, `${outcome.requestId}:${index}`]));
  const candidates = planUnsignedArenaPostBattleCandidates(effectsInput, {
    scopeKey: outcome.scopeKey, requestId: outcome.requestId, generationId: outcome.requestId,
    occurredAt: new Date(now).toISOString(), worldLineIds,
  });
  const effects = new Map(candidates.characterEffects.map((item) => [item.combatantIndex, item.data]));
  const nextWorkingCombatants = workingCombatants.map((value, index) => effects.has(index)
    ? { ...object(value), data: effects.get(index)!, isNative: false, isPreset: false }
    : value);
  const digest = buildBattleStoryDeterministicDigest({ markdown: outcome.markdown, reportJson: report, impacts: outcome.impacts, chapterIndex: input.chapterIndex });
  const sessionSummary = buildBattleStorySummaryFallback({ previousSummary: session.sessionSummary, digests: [{ ...digest, index: input.chapterIndex }] });
  const records = buildCompletedBattleStoryRecords({
    action: input.action, session: { ...session, sessionSummary, summaryMeta: {
      coveredUntilChapterIndex: input.chapterIndex,
      coveredChapterIds: [...(session.summaryMeta?.coveredChapterIds ?? []), input.operationId],
      refreshedAt: now, mode: 'deterministic-fallback' as const,
    } },
    operationId: input.operationId, checkpointId: input.checkpointId, initialCheckpointId: input.initialCheckpointId,
    now, source: input.source, inputCombatants: workingCombatants,
    generated: { chapterIndex: input.chapterIndex, markdown: outcome.markdown, reportJson: { report, impacts: outcome.impacts },
      digest, generationId: outcome.requestId, nextWorkingCombatants,
      cardSnapshot: {
        reporterInfo: outcome.report.reporterInfo, userGuidance: input.userGuidance,
        adjudicationResults: input.adjudicationResults, aiUsage: outcome.usage ?? null,
        aiModel: outcome.report.aiModel ?? input.source.modelId,
        ...(outcome.reasoning ? { aiReasoning: { status: 'done', source: 'provider', text: outcome.reasoning } } : {}),
      },
    },
  });
  return freezeBattleStoryCommit(records);
};
