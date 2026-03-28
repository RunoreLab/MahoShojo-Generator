import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';
import {
  applySublimationArenaHistoryStrategy,
  buildSublimationHistoryEntry,
} from '@/lib/sublimation/arena-history';

type SupportedTargetTemplate = 'magical-girl' | 'canshou' | 'general';

type SublimationEvent = {
  title: string;
  impact: string;
};

type BuildFinalSublimationDataInput = {
  originalCharacterData: Record<string, any>;
  baseOutputData: Record<string, any>;
  updatedDataFromAI: Record<string, any> | null | undefined;
  targetTemplate: SupportedTargetTemplate;
  allowReshapeNames: boolean;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
  arenaHistoryRetentionStrategy: unknown;
  sublimationEvent: SublimationEvent;
  finalUserGuidance: string | null;
  hasNarrativeHistory: boolean;
  hasQuestionnaireLore: boolean;
  hasNonNativeQuestionnaireLore: boolean;
  questionnaireSelectionCount: number;
  isNative: boolean;
  nowISO?: string;
  createWorldLineId?: () => string;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function isObject(item: unknown): item is Record<string, unknown> {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item));
}

function safeDeepMerge(target: any, source: any): any {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key]) && key in target && isObject(target[key])) {
        output[key] = safeDeepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    });
  }
  return output;
}

const resolveTargetTemplateId = (targetTemplate: SupportedTargetTemplate): string => {
  if (targetTemplate === 'magical-girl') return '魔法少女/心之花/魔法少女（问卷生成）';
  if (targetTemplate === 'canshou') return '魔法少女/心之花/残兽（问卷生成）';
  return GENERAL_CHARACTER_TEMPLATE_ID;
};

export const buildFinalSublimationData = (input: BuildFinalSublimationDataInput) => {
  const nowISO = input.nowISO ?? new Date().toISOString();

  // 1) clone base
  const sublimatedData: any = cloneJson(input.baseOutputData ?? {});

  // 2) templateId fallback
  const targetTemplateId = resolveTargetTemplateId(input.targetTemplate);
  if (!sublimatedData.templateId) {
    sublimatedData.templateId = targetTemplateId;
  }

  // 3) safeDeepMerge
  Object.assign(sublimatedData, safeDeepMerge(sublimatedData, input.updatedDataFromAI ?? {}));
  // 防止被 AI patch 覆盖为错误模板
  sublimatedData.templateId = targetTemplateId;

  // 4) immutable names restore
  if (input.targetTemplate === 'magical-girl' && !input.allowReshapeNames) {
    const baseMagicName = input.baseOutputData?.magicConstruct?.name;
    const baseWonderlandName = input.baseOutputData?.wonderlandRule?.name;
    const baseBloomingName = input.baseOutputData?.blooming?.name;
    if (baseMagicName && sublimatedData.magicConstruct) {
      sublimatedData.magicConstruct.name = baseMagicName;
    }
    if (baseWonderlandName && sublimatedData.wonderlandRule) {
      sublimatedData.wonderlandRule.name = baseWonderlandName;
    }
    if (baseBloomingName && sublimatedData.blooming) {
      sublimatedData.blooming.name = baseBloomingName;
    }
  }

  // 5) arena_history
  if (input.writeArenaHistory) {
    const participantsName = input.targetTemplate === 'magical-girl'
      ? (typeof sublimatedData.codename === 'string' ? sublimatedData.codename : null)
      : (typeof sublimatedData.name === 'string' ? sublimatedData.name : null);

    const entry = buildSublimationHistoryEntry({
      title: input.sublimationEvent.title,
      impact: input.sublimationEvent.impact,
      participantsName,
      finalUserGuidance: input.finalUserGuidance,
      hasQuestionnaireLore: input.hasQuestionnaireLore,
      questionnaireSelectionCount: input.questionnaireSelectionCount,
      nonNativeDataInvolved:
        !input.isNative ||
        Boolean(input.finalUserGuidance) ||
        input.hasNarrativeHistory ||
        input.hasNonNativeQuestionnaireLore,
    });

    sublimatedData.arena_history = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: input.originalCharacterData?.arena_history,
      strategy: input.arenaHistoryRetentionStrategy,
      newEntry: entry,
      nowISO,
      createWorldLineId: input.createWorldLineId,
    });
  } else if (
    typeof input.originalCharacterData?.arena_history !== 'undefined' &&
    input.originalCharacterData.arena_history !== null
  ) {
    sublimatedData.arena_history = cloneJson(input.originalCharacterData.arena_history);
  } else {
    delete sublimatedData.arena_history;
  }

  // 6) current_state
  if (input.writeCurrentState) {
    if (sublimatedData.current_state) {
      const preservedFields = Array.isArray(input.originalCharacterData?.current_state?.fields)
        ? cloneJson(input.originalCharacterData.current_state.fields)
        : Array.isArray(sublimatedData.current_state?.fields)
          ? cloneJson(sublimatedData.current_state.fields)
          : [];

      if (!isObject(sublimatedData.current_state)) {
        sublimatedData.current_state = {};
      }

      sublimatedData.current_state.fields = preservedFields;
      sublimatedData.current_state.updated_at = nowISO;
    }
  } else if (
    typeof input.originalCharacterData?.current_state !== 'undefined' &&
    input.originalCharacterData.current_state !== null
  ) {
    sublimatedData.current_state = cloneJson(input.originalCharacterData.current_state);
  } else {
    delete sublimatedData.current_state;
  }

  return sublimatedData;
};

export type { BuildFinalSublimationDataInput };
