import type { WebPackageRef, WebPackagePromptProjection } from '@mahoshojo/contracts/web-package';
import {
  buildPackageTargetSystemPrompt,
  createPromptBuilder,
  createStreamPromptBuilder,
  DEFAULT_ARENA_PROMPT_QUESTIONS,
  getSystemPrompt,
  type ArenaPromptAdjudicationResult,
} from './prompt';

export type ArenaGenerationPromptOutputContract =
  | 'stream-markdown'
  | 'structured-report'
  | 'web-document'
  | 'web-package-target';

export type ArenaGenerationPromptAssemblyInput = {
  /** Host-prepared input; authority and delivery-specific bounds remain host-owned. */
  payload: Record<string, unknown>;
  outputContract: ArenaGenerationPromptOutputContract;
  reporterInfo: { name: string; publication: string };
  adjudicationResults: ArenaPromptAdjudicationResult[] | null;
  /** Already resolved and checked by the host. This layer never loads a package. */
  packageContext?: {
    ref: WebPackageRef;
    projection?: WebPackagePromptProjection;
    prompt?: string;
  };
};

export type AssembledArenaGenerationPrompt = {
  prompt: string;
  systemPrompt?: string;
  metadata: Record<string, unknown>;
};

const isWebArenaOutputContract = (contract: ArenaGenerationPromptOutputContract): boolean =>
  contract === 'web-document' || contract === 'web-package-target';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const questionnaireLore = (value: unknown): string => (
  Array.isArray(value)
    ? value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const lore = record.useLore === false ? '' : text(record.loreMarkdown);
      const title = text(record.title);
      return lore ? [`【设定来源：${title || '未命名问卷'}】\n${lore}`] : [];
    }).join('\n\n')
    : ''
);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

/** Prompt-shape classification only; this does not establish ranked eligibility or server authority. */
export const isStrictRankedArenaRequest = (payload: Record<string, unknown>): boolean => {
  const mode = text(payload.mode) || 'classic';
  const language = text(payload.language) || 'zh-CN';
  const combatants = Array.isArray(payload.combatants) ? payload.combatants : [];
  return mode === 'classic'
    && language === 'zh-CN'
    && !text(payload.userGuidance)
    && (!Array.isArray(payload.materials) || payload.materials.length === 0)
    && !questionnaireLore(payload.questionnaires)
    && payload.readArenaHistory === false
    && payload.readCurrentState === false
    && payload.readNarrativeHistory === false
    && (!Array.isArray(payload.adjudicationEvents) || payload.adjudicationEvents.length === 0)
    && combatants.length === 2
    && combatants.every((value) => !text(asRecord(value)?.characterGuidance));
};

/** Pure assembly: no randomness, server context, credentials, package lookup or persistence. */
export const assembleArenaGenerationPrompt = (
  input: ArenaGenerationPromptAssemblyInput,
): AssembledArenaGenerationPrompt => {
  const { payload, outputContract, reporterInfo, adjudicationResults, packageContext } = input;
  const mode = text(payload.mode) || 'classic';
  const language = text(payload.language) || 'zh-CN';
  const combatants = Array.isArray(payload.combatants) ? payload.combatants : [];
  const lore = questionnaireLore(payload.questionnaires);
  const webPackageRef = packageContext?.ref;
  const trustedProjection = packageContext?.projection;
  const packagePrompt = packageContext?.prompt;
  const userGuidance = typeof payload.userGuidance === 'string' ? payload.userGuidance || null : null;
  const materials = Array.isArray(payload.materials) ? payload.materials : [];
  const strictRankedMatch = isStrictRankedArenaRequest(payload);
  const writeArenaHistory = payload.writeArenaHistory !== false;
  const writeCurrentState = payload.writeCurrentState !== false;
  const forceStreamMeta = payload.forceStreamMeta === true;
  const expectsMeta = isWebArenaOutputContract(outputContract) || outputContract === 'stream-markdown'
    && (forceStreamMeta || writeArenaHistory || writeCurrentState);
  const promptBuilder = outputContract === 'structured-report'
    ? createPromptBuilder(
      {
        ...DEFAULT_ARENA_PROMPT_QUESTIONS,
        default: DEFAULT_ARENA_PROMPT_QUESTIONS.magicalGirl,
      },
      userGuidance,
      text(payload.internalGuidance) || null,
      false,
      language,
      mode,
      asRecord(payload.scenario),
      Array.isArray(payload.auxScenarios) ? payload.auxScenarios : null,
      asRecord(payload.teams) as Record<string, string[]> | null ?? undefined,
      asRecord(payload.teamNames) as Record<string, string> | null ?? undefined,
      payload.readArenaHistory === true,
      payload.arenaHistoryReadLimit === null
        ? null
        : typeof payload.arenaHistoryReadLimit === 'number'
          ? payload.arenaHistoryReadLimit
          : 3,
      payload.readCurrentState === true,
      writeCurrentState,
      adjudicationResults,
      text(payload.storyLength) || undefined,
      text(payload.customStoryLength) || undefined,
      Array.isArray(payload.narrativeHistory) ? payload.narrativeHistory : null,
      lore || null,
      !strictRankedMatch,
      materials,
    )
    : createStreamPromptBuilder(
    {
      ...DEFAULT_ARENA_PROMPT_QUESTIONS,
      default: DEFAULT_ARENA_PROMPT_QUESTIONS.magicalGirl,
    },
    userGuidance,
    text(payload.internalGuidance) || null,
    false,
    language,
    mode,
    asRecord(payload.scenario),
    Array.isArray(payload.auxScenarios) ? payload.auxScenarios : null,
    asRecord(payload.teams) as Record<string, string[]> | null ?? undefined,
    asRecord(payload.teamNames) as Record<string, string> | null ?? undefined,
    payload.readArenaHistory === true,
    payload.arenaHistoryReadLimit === null
      ? null
      : typeof payload.arenaHistoryReadLimit === 'number'
        ? payload.arenaHistoryReadLimit
        : 3,
    payload.readCurrentState === true,
    writeArenaHistory,
    writeCurrentState,
    forceStreamMeta,
    adjudicationResults,
    text(payload.storyLength) || undefined,
    text(payload.customStoryLength) || undefined,
    Array.isArray(payload.narrativeHistory) ? payload.narrativeHistory : null,
    lore || null,
    !strictRankedMatch,
    materials,
    outputContract,
    packagePrompt,
    trustedProjection?.target.mediaType ?? null,
  );
  const taskPrompt = promptBuilder({ combatants });
  const systemPrompt = getSystemPrompt(mode, combatants);
  const characterGuidances = combatants.flatMap((value) => {
    const combatant = asRecord(value);
    const data = asRecord(combatant?.data);
    const characterName = text(data?.codename) || text(data?.name);
    const guidance = text(combatant?.characterGuidance).slice(0, 100);
    return characterName && guidance ? [{ characterName, guidance }] : [];
  });

  return {
    // Package targets carry the mode persona in the system role, so repeating it
    // here would re-introduce the "prose author" framing the system role exists
    // to subordinate. The host output contract stays in the task prompt, so a
    // provider that ignores the system role still sees the shape requirements.
    ...(outputContract === 'web-package-target'
      ? { prompt: taskPrompt, systemPrompt: buildPackageTargetSystemPrompt(systemPrompt, trustedProjection?.target.mediaType ?? null) }
      : { prompt: `${systemPrompt}\n\n${taskPrompt}` }),
    metadata: {
      mode,
      language,
      outputContract,
      reportFormat: isWebArenaOutputContract(outputContract) ? 'web' : 'markdown',
      ...(webPackageRef ? { webPackageRef } : {}),
      ...(trustedProjection ? { webPackagePromptProjection: trustedProjection } : {}),
      expectsMeta,
      combatantCount: combatants.length,
      pvpContext: asRecord(payload.pvpContext),
      scenarioTitle: text(payload.scenarioTitle) || text(asRecord(payload.scenario)?.title) || null,
      userGuidance,
      narrativeHistoryReadCount: typeof payload.narrativeHistoryReadCount === 'number'
        ? payload.narrativeHistoryReadCount
        : 0,
      characterGuidances,
      adjudicationResults,
      reporterInfo,
      strictRankedMatch,
    },
  };
};
