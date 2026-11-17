import type { PublicSeasonMeta } from '@mahoshojo/contracts/public-ranking';
import type { QuestionnaireDefinition } from './questionnaire-definition';
import type { QuestionnaireSelection, QuestionnaireSelectionIdFactory } from './questionnaire-selection';
import { normalizeScenarioPresetFilename } from './scenario-presets';
import { formatBattleModeLabel } from './public-ranking';
import { isStrictRankedModelBlacklisted } from './arena-ranked-model-policy';

export type SeasonBattleMode = 'classic' | 'kizuna' | 'daily' | 'scenario';

/** Server-persisted policy; historical v1 keeps its original ownership rules. */
export const ARENA_STRICT_POLICY = '1+3:v2';
export const isSelfSelectedStrictPolicy = (value: string | null | undefined): boolean =>
  value === '1+3:v1' || value === ARENA_STRICT_POLICY;

export type SeasonStrictRules = {
  mode: SeasonBattleMode;
  storyGuidance: string;
  scenarioPresetFilename: string | null;
  questionnaireLoreAllowed: boolean;
  questionnaireLorePresetIds: string[];
};

export const normalizeStrictStoryGuidance = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 200);
};
const normalizeSeasonBattleMode = (value: unknown): SeasonBattleMode | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (raw === 'classic' || raw === 'kizuna' || raw === 'daily' || raw === 'scenario') return raw;
  return null;
};

const normalizeSeasonScenarioPresetFilename = (mode: SeasonBattleMode, value: unknown): string | null => {
  if (mode !== 'scenario') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return normalizeScenarioPresetFilename(trimmed);
  } catch {
    return null;
  }
};

const normalizeSeasonQuestionnaireLoreAllowed = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return false;
};

const normalizeSeasonQuestionnaireLorePresetIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => Boolean(item));
  return cleaned.slice(0, 10);
};

export const deriveSeasonStrictRules = (season: Pick<PublicSeasonMeta, 'specialRules'> | null | undefined): SeasonStrictRules => {
  const special = season?.specialRules && typeof season.specialRules === 'object' ? season.specialRules : null;
  const mode = normalizeSeasonBattleMode(special?.mode) ?? 'classic';
  const storyGuidance = normalizeStrictStoryGuidance(special?.storyGuidance);
  const scenarioPresetFilename = normalizeSeasonScenarioPresetFilename(mode, special?.scenarioPresetFilename);
  const questionnaireLorePresetIds = normalizeSeasonQuestionnaireLorePresetIds(special?.questionnaireLorePresetIds);
  const questionnaireLoreAllowed =
    questionnaireLorePresetIds.length > 0 || normalizeSeasonQuestionnaireLoreAllowed(special?.questionnaireLoreAllowed);
  return { mode, storyGuidance, scenarioPresetFilename, questionnaireLoreAllowed, questionnaireLorePresetIds };
};

/** 一次性设置投影；宿主保留执行位置、模型、故事会话和其它自由模式设置的所有权。 */
export const buildStrictSetupConfiguration = (
  rules: SeasonStrictRules,
  readableCombatantFilenames: readonly string[],
) => ({
  battleMode: rules.mode,
  selectedLanguage: 'zh-CN' as const,
  settings: {
    userGuidance: rules.storyGuidance || '',
    readArenaHistory: false,
    readCurrentState: false,
    readNarrativeHistory: false,
  },
  adjudicationEvents: [] as never[],
  characterGuidanceUpdates: readableCombatantFilenames.map((filename) => ({ filename, characterGuidance: '' })),
  clearScenario: rules.mode !== 'scenario',
  clearAuxScenarios: true,
  clearMaterials: true,
});

/** presetId 来自宿主实际加载的预设索引项，不接受同名上传/缓存选择代替预设资源。 */
export type LoadedStrictQuestionnairePreset = {
  presetId: string;
  questionnaire: QuestionnaireDefinition;
};

export type StrictQuestionnaireSetupProjection = {
  selections: QuestionnaireSelection[];
  changed: boolean;
  addedQuestionnaireLoreCount: number;
  disabledQuestionnaireLoreCount: number;
};

/**
 * 只投影已加载/规范化的资源。加载失败时宿主不调用本函数；缺少必选资源也拒绝投影。
 * ID 后缀由宿主提供，纯层不触达 fetch、crypto、时钟或持久化。
 */
export const projectStrictSetupQuestionnaires = (input: {
  rules: Pick<SeasonStrictRules, 'questionnaireLoreAllowed' | 'questionnaireLorePresetIds'>;
  selectedQuestionnaires: readonly QuestionnaireSelection[];
  loadedPresets: readonly LoadedStrictQuestionnairePreset[];
  createSelectionSuffix: QuestionnaireSelectionIdFactory;
}): StrictQuestionnaireSetupProjection => {
  const { rules, selectedQuestionnaires, loadedPresets, createSelectionSuffix } = input;
  const isInjecting = (selection: QuestionnaireSelection) =>
    selection.useLore !== false && Boolean(selection.questionnaire.loreMarkdown?.trim());
  let addedQuestionnaireLoreCount = 0;
  let disabledQuestionnaireLoreCount = 0;
  const requiredPresetIds = Array.from(new Set(rules.questionnaireLorePresetIds.map((id) => id.trim()).filter(Boolean)));

  if (requiredPresetIds.length === 0) {
    const changed = !rules.questionnaireLoreAllowed && selectedQuestionnaires.some(isInjecting);
    const selections = selectedQuestionnaires.map((selection) => {
      if (!changed || selection.useLore === false) return selection;
      if (isInjecting(selection)) disabledQuestionnaireLoreCount += 1;
      return { ...selection, useLore: false };
    });
    return { selections, changed, addedQuestionnaireLoreCount, disabledQuestionnaireLoreCount };
  }

  const requiredIdSet = new Set(requiredPresetIds);
  const usedSelectionIds = new Set<string>();
  selectedQuestionnaires.forEach((selection) => {
    const key = (selection.selectionId ?? selection.questionnaire.id).trim();
    if (key) usedSelectionIds.add(key);
  });
  const allocSelectionId = (base: string): string => {
    const cleaned = base.trim() || 'questionnaire';
    const nextId = !usedSelectionIds.has(cleaned)
      ? cleaned
      : !usedSelectionIds.has(`${cleaned}::season`)
        ? `${cleaned}::season`
        : `${cleaned}::${createSelectionSuffix()}`;
    usedSelectionIds.add(nextId);
    return nextId;
  };

  const requiredSelectionsById = new Map<string, QuestionnaireSelection>();
  for (const id of requiredPresetIds) {
    const loaded = loadedPresets.find((preset) => preset.presetId === id);
    if (!loaded) throw new Error(`未找到赛季指定的预设问卷：${id}`);
    const questionnaire = loaded.questionnaire;
    if (questionnaire.id !== id) throw new Error(`预设问卷标识不匹配：${id}`);
    if (!questionnaire.loreMarkdown?.trim()) {
      const title = questionnaire.title.trim();
      throw new Error(title ? `「${title}」不包含 loreMarkdown，无法用于设定注入` : '该问卷不包含 loreMarkdown，无法用于设定注入');
    }
    const existing = selectedQuestionnaires.find((selection) => selection.source === 'preset' && selection.questionnaire.id === id);
    if (existing) {
      requiredSelectionsById.set(id, { ...existing, questionnaire, useLore: true });
    } else {
      requiredSelectionsById.set(id, { source: 'preset', questionnaire, useLore: true, selectionId: allocSelectionId(id) });
      addedQuestionnaireLoreCount += 1;
    }
  }

  const appendedRequiredIds = new Set<string>();
  const selections = selectedQuestionnaires.map((selection) => {
    const id = selection.questionnaire.id.trim();
    if (requiredIdSet.has(id) && selection.source === 'preset' && !appendedRequiredIds.has(id)) {
      appendedRequiredIds.add(id);
      return requiredSelectionsById.get(id)!;
    }
    if (isInjecting(selection)) disabledQuestionnaireLoreCount += 1;
    return selection.useLore === false ? selection : { ...selection, useLore: false };
  });
  for (const id of requiredPresetIds) {
    if (!appendedRequiredIds.has(id)) selections.push(requiredSelectionsById.get(id)!);
  }
  return { selections, changed: true, addedQuestionnaireLoreCount, disabledQuestionnaireLoreCount };
};

export type StrictSetupInput = {
  isAuthenticated: boolean | null;
  battleMode: string;
  requiredMode: SeasonBattleMode;
  requiredStoryGuidance: string;
  requiredScenarioPresetFilename: string | null;
  scenarioFileName: string | null;
  scenarioIsPreset: boolean | null;
  rankableCombatants: readonly { characterGuidance?: string }[];
  userGuidance: string;
  selectedLanguage: string;
  readArenaHistory: boolean;
  readCurrentState: boolean;
  readNarrativeHistory: boolean;
  adjudicationEventCount: number;
  userProviderConfigModelId: string | null;
  scenarioEnabled: boolean;
  auxScenarioCount: number;
  materialCount: number;
  questionnaireLoreEnabled: boolean;
  questionnaireLoreAllowed: boolean;
  requiredQuestionnaireLorePresetIds: string[];
  questionnaireLoreIds: string[];
};

/** Local configuration hints only; the server remains the eligibility authority. */
export const buildStrictSetupMissingReasons = (input: StrictSetupInput): string[] => {
  const reasons: string[] = [];
  if (input.isAuthenticated === null) reasons.push('账号登录状态尚未确认');
  else if (!input.isAuthenticated) reasons.push('需要先登录');
  if (input.battleMode !== input.requiredMode) reasons.push(`模式需为「${formatBattleModeLabel(input.requiredMode)}」`);
  if (input.rankableCombatants.length <= 0) reasons.push('需先选择 1 位可计分的参战角色（数据卡/预设）');
  if (input.selectedLanguage !== 'zh-CN') reasons.push('生成语言需为「简体中文」');

  const actualStoryGuidance = normalizeStrictStoryGuidance(input.userGuidance);
  if (input.requiredStoryGuidance) {
    if (actualStoryGuidance !== input.requiredStoryGuidance) {
      reasons.push('需使用赛季指定的「故事引导」');
    }
  } else if (actualStoryGuidance) {
    reasons.push('需清空「故事引导」');
  }

  if (input.readArenaHistory) reasons.push('需关闭「读取历战」');
  if (input.readCurrentState) reasons.push('需关闭「读取当前状态」');
  if (input.readNarrativeHistory) reasons.push('需关闭「读取叙事历史」');
  if (input.adjudicationEventCount > 0) reasons.push('需清空「随机判定器事件」');
  if (input.rankableCombatants.some((c) => (c.characterGuidance ?? '').trim())) reasons.push('需清空「角色行动引导」');
  if (input.requiredQuestionnaireLorePresetIds.length > 0) {
    const requiredSet = new Set(input.requiredQuestionnaireLorePresetIds);
    const actualSet = new Set(input.questionnaireLoreIds);
    let ok = requiredSet.size === actualSet.size;
    if (ok) {
      for (const id of requiredSet) {
        if (!actualSet.has(id)) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) reasons.push('需启用赛季指定的「问卷/设定卡 Lore 注入」');
  } else if (input.questionnaireLoreEnabled && !input.questionnaireLoreAllowed) {
    reasons.push('需关闭「问卷/设定卡 Lore 注入」');
  }

  if (input.requiredMode === 'scenario') {
    if (!input.scenarioEnabled) reasons.push('需启用「情景模式」并选择主情景');
    if (input.requiredScenarioPresetFilename) {
      const fileName = typeof input.scenarioFileName === 'string' ? input.scenarioFileName.trim() : '';
      if (fileName === input.requiredScenarioPresetFilename && input.scenarioIsPreset === null) {
        reasons.push('主情景的预设来源尚未确认');
      } else if (!input.scenarioIsPreset || fileName !== input.requiredScenarioPresetFilename) {
        reasons.push('需选择赛季指定的「预设情景」');
      }
    }
  } else if (input.scenarioEnabled) {
    reasons.push('需关闭「情景模式」');
  }

  if (input.auxScenarioCount > 0) reasons.push('需移除「辅助情景」');
  if (input.materialCount > 0) reasons.push('需移除「素材」');
  if (input.userProviderConfigModelId && isStrictRankedModelBlacklisted(input.userProviderConfigModelId)) {
    reasons.push('需改用支持严格排位计分的 AI 模型');
  }
  return reasons;
};

export const formatStrictReason = (code: string): string => {
  const map: Record<string, string> = {
    'entity-binding-missing': '缺少服务器角色来源校验，不计分',
    'entity-body-mismatch': '角色正文与所选来源不一致，不计分',
    'entity-reference-unavailable': '角色来源当前不可验证，不计分',
    'entity-version-changed': '生成后角色来源已更新，不计分',
    'need-login': '需要先登录',
    'mode-not-classic': '需使用「经典模式」',
    'mode-not-season': '需使用赛季指定模式',
    'combatant-count-not-2': '需 2 人对战',
    'combatants-unrankable': '参战者需为数据卡/预设',
    'season-questionnaire-lore-not-allowed': '赛季规则不允许使用「问卷/设定卡 Lore 注入」',
    'season-questionnaire-lore-mismatch': '「问卷/设定卡 Lore 注入」不符合赛季规则',
    'strict-card-missing': '数据卡不存在/已删除（严格排位不计分）',
    'strict-not-character': '仅“角色”数据卡可参与严格排位计分',
    'strict-not-public': '严格排位仅允许公开角色卡',
    'strict-not-approved': '严格排位仅允许已审核通过的公开角色卡',
    'strict-no-owned-combatant': '严格排位要求两名参战者中至少一名为当前账号的线上角色卡',
    'strict-out-of-range': '对手分差过大（不计严格排位）',
    'dedup-user-pair': '同一对手组合仍处于计分冷却期（严格去重）',
    'pair-daily-limit': '同一对手组合今日计分已达上限（严格去重）',
    'strict-check-failed': '严格计分检查失败（已降级为不计）',
    'language-not-zh-cn': '生成语言需为「简体中文」',
    'has-user-guidance': '需清空「故事引导」',
    'season-user-guidance-missing': '需填写赛季指定「故事引导」',
    'season-user-guidance-mismatch': '「故事引导」与赛季规则不一致',
    'has-adjudication-events': '需清空「随机判定器事件」',
    'read-arena-history': '需关闭「读取历战」',
    'read-current-state': '需关闭「读取当前状态」',
    'read-narrative-history': '需关闭「读取叙事历史」',
    'has-character-guidance': '需清空「角色行动引导」',
    'season-scenario-missing': '需选择主情景（赛季规则）',
    'season-scenario-preset-mismatch': '主情景需为赛季指定预设',
    'season-aux-scenarios-not-allowed': '需移除「辅助情景」（赛季规则）',
    'has-materials': '需移除「素材」',
    'daily-limit': '今日严格排位计分次数已达上限（按 UTC 00:00/北京时间 08:00 刷新）',
    'ai-model-blacklisted': '选择了不支持严格排位计分的模型',
  };
  return map[code] ?? code;
};
