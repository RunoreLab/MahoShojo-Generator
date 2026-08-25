import type { ArenaGenerationPrompt } from './runtime';
import {
  createStreamPromptBuilder,
  DEFAULT_ARENA_PROMPT_QUESTIONS,
  getSystemPrompt,
} from './compatibility-prompt';

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

const JOURNALISTS = [
  ['蓝星单推人', '兽扑'],
  ['间界上单', 'molimoli弹幕视频网'],
  ['情报专家Mentha', '国度论坛-魔法少女板块-A.R.E.N.A.大腿榜'],
  ['弧盐'], ['佚名'], ['牢雀'], ['冲师逆徒'], ['嗜血观众'], ['长颈鹿'],
  ['魔法少女战队unofficial'], ['扣137送萝莉小前辈'], ['魔法少女苍蓝星'],
  ['下班，然后观察魔法少女'], ['向日葵（征集新闻线索中）'], ['妖精保护协会'],
  ['野史学家'], ['A[LI]CE'], ['蓝色小屁孩'], ['大道至简受害者'],
  ['AAA竞技场专业修复小银全天无休'],
] as const;
const PUBLICATIONS = [
  'A.R.E.N.A.论坛-综合板块',
  'MGA论坛-魔法少女国家地理-竞技场',
  '魔乎-如何评价魔法少女？',
  '摆渡贴吧-A.R.E.N.A.吧-【精】近期新闻合集',
  '银廊树洞-A.R.E.N.A.相关',
  'MagicRevue-命运的舞台',
  '国度论坛-魔法少女板块',
  '魔法国度娱乐中心-时事趣闻',
  '魔信公众号平台',
] as const;

const randomReporter = (): { name: string; publication: string } => {
  const journalist = JOURNALISTS[Math.floor(Math.random() * JOURNALISTS.length)]
    ?? ['佚名'];
  return {
    name: journalist[0],
    publication: journalist[1]
      ?? PUBLICATIONS[Math.floor(Math.random() * PUBLICATIONS.length)]
      ?? '魔法国度时报',
  };
};

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

export const buildArenaGenerationPrompt = async (input: {
  actorKey: string;
  payload: Record<string, unknown>;
}): Promise<ArenaGenerationPrompt> => {
  const { payload } = input;
  const mode = text(payload.mode) || 'classic';
  const language = text(payload.language) || 'zh-CN';
  const combatants = Array.isArray(payload.combatants) ? payload.combatants : [];
  const lore = questionnaireLore(payload.questionnaires);
  const userGuidance = text(payload.userGuidance) || null;
  const materials = Array.isArray(payload.materials) ? payload.materials : [];
  const adjudicationResults = Array.isArray(payload.adjudicationResults)
    ? payload.adjudicationResults
    : null;
  const strictRankedMatch = isStrictRankedArenaRequest(payload);
  const writeArenaHistory = payload.writeArenaHistory !== false;
  const writeCurrentState = payload.writeCurrentState !== false;
  const forceStreamMeta = payload.forceStreamMeta === true;
  const expectsMeta = forceStreamMeta || writeArenaHistory || writeCurrentState;
  const streamPrompt = createStreamPromptBuilder(
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
  )({ combatants });
  const characterGuidances = combatants.flatMap((value) => {
    const combatant = asRecord(value);
    const data = asRecord(combatant?.data);
    const characterName = text(data?.codename) || text(data?.name);
    const guidance = text(combatant?.characterGuidance);
    return characterName && guidance ? [{ characterName, guidance }] : [];
  });
  const reporterInfo = randomReporter();

  return {
    prompt: `${getSystemPrompt(mode, combatants)}\n\n${streamPrompt}`,
    metadata: {
      mode,
      language,
      expectsMeta,
      combatantCount: combatants.length,
      pvpContext: asRecord(payload.pvpContext),
      scenarioTitle: text(payload.scenarioTitle) || text(asRecord(payload.scenario)?.title) || null,
      userGuidance,
      characterGuidances,
      adjudicationResults,
      reporterInfo,
      strictRankedMatch,
    },
  };
};
