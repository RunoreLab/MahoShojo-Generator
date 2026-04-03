import { tryLoadBuildRulePresetById } from '@/lib/creator/build-rules';
import { getFieldDisplayName } from '@/lib/fieldTranslations';

export type CharacterParameterSourceKey = 'initial' | 'current';

export interface CharacterParameterEntry {
  key: string;
  label: string;
  value: string;
}

export interface CharacterParameterRuleSection {
  key: string;
  title: string;
  entries: CharacterParameterEntry[];
  note?: string;
}

export interface CharacterParameterRuleView {
  ruleId: string;
  title: string;
  version: string;
  sections: CharacterParameterRuleSection[];
  valid: boolean;
  statusLabel: string;
  issues: string[];
}

export interface CharacterParameterSourceView {
  key: CharacterParameterSourceKey;
  label: string;
  rules: CharacterParameterRuleView[];
}

export interface CharacterParameterView {
  activeSource: CharacterParameterSourceKey;
  sources: CharacterParameterSourceView[];
}

type CharacterParameterViewInput = {
  creationInputs?: unknown;
  buildState?: unknown;
};

type NormalizedRuleSnapshot = {
  ruleId: string;
  version: string;
  blockResults: Record<string, unknown>;
  derived: Record<string, unknown>;
  validationSummary: {
    valid: boolean;
    issues: string[];
    missingRequiredBlockKeys: string[];
  };
};

const FRIENDLY_FIELD_LABELS: Record<string, string> = {
  proficiencyBonus: '熟练加值',
  hitDie: '命中骰',
  spellcastingKind: '施法类型',
  abilityModifiers: '能力调整值',
  armorClass: '护甲等级',
  hitPoints: '生命值',
  passivePerception: '被动察觉',
  creditRating: '信用评级',
  DamageBonus: '伤害加值',
  Build: 'Build',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getFriendlyLabel = (key: string): string => FRIENDLY_FIELD_LABELS[key] ?? getFieldDisplayName(key);

const formatSignedNumber = (value: number): string => (value > 0 ? `+${Math.trunc(value)}` : `${Math.trunc(value)}`);

const formatSpellcastingKind = (value: unknown): string => {
  switch (value) {
    case 'full':
      return '完整施法';
    case 'half':
      return '半施法';
    case 'pact':
      return '契约施法';
    case 'none':
      return '无施法';
    default:
      return typeof value === 'string' && value.trim() ? value.trim() : '-';
  }
};

const formatPrimitiveValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim() || '-';
  if (typeof value === 'number' && Number.isFinite(value)) return `${Math.trunc(value)}`;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return '-';
};

const formatDisplayValue = (key: string, value: unknown): string => {
  if (key === 'spellcastingKind') {
    return formatSpellcastingKind(value);
  }

  if (key === 'proficiencyBonus' && typeof value === 'number' && Number.isFinite(value)) {
    return formatSignedNumber(value);
  }

  if (key === 'abilityModifiers' && isRecord(value)) {
    const parts = Object.entries(value)
      .filter(([, nestedValue]) => typeof nestedValue === 'number' && Number.isFinite(nestedValue))
      .map(([nestedKey, nestedValue]) => `${nestedKey} ${formatSignedNumber(nestedValue as number)}`);
    return parts.length > 0 ? parts.join(' / ') : '-';
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatDisplayValue(key, item))
      .filter((item) => item !== '-');
    return parts.length > 0 ? parts.join('、') : '-';
  }

  if (isRecord(value)) {
    const parts = Object.entries(value)
      .map(([nestedKey, nestedValue]) => `${getFriendlyLabel(nestedKey)} ${formatDisplayValue(nestedKey, nestedValue)}`)
      .filter((item) => !item.endsWith(' -'));
    return parts.length > 0 ? parts.join(' / ') : '-';
  }

  return formatPrimitiveValue(value);
};

const normalizeValidationSummary = (value: unknown): NormalizedRuleSnapshot['validationSummary'] => {
  if (!isRecord(value)) {
    return {
      valid: true,
      issues: [],
      missingRequiredBlockKeys: [],
    };
  }

  return {
    valid: value.valid !== false,
    issues: Array.isArray(value.issues) ? value.issues.filter((item): item is string => typeof item === 'string') : [],
    missingRequiredBlockKeys: Array.isArray(value.missingRequiredBlockKeys)
      ? value.missingRequiredBlockKeys.filter((item): item is string => typeof item === 'string')
      : [],
  };
};

const normalizeRuleSnapshot = (value: unknown): NormalizedRuleSnapshot | null => {
  if (!isRecord(value)) return null;
  const ruleId = typeof value.ruleId === 'string' ? value.ruleId.trim() : '';
  if (!ruleId) return null;

  return {
    ruleId,
    version: typeof value.version === 'string' && value.version.trim() ? value.version.trim() : 'unknown',
    blockResults: isRecord(value.blockResults) ? value.blockResults : {},
    derived: isRecord(value.derived) ? value.derived : {},
    validationSummary: normalizeValidationSummary(value.validationSummary),
  };
};

const getSelectOptionLabel = (block: Record<string, unknown>, rawValue: unknown): string => {
  const options = Array.isArray(block.options) ? block.options.filter(isRecord) : [];
  const rawString = typeof rawValue === 'string' ? rawValue.trim() : '';
  const matchedOption = options.find((option) => option.value === rawString);
  if (matchedOption && typeof matchedOption.label === 'string' && matchedOption.label.trim()) {
    return matchedOption.label.trim();
  }
  return rawString || '-';
};

const getMultiSelectLabels = (block: Record<string, unknown>, rawValue: unknown): string[] => {
  const selected = Array.isArray(rawValue)
    ? rawValue.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const groups = Array.isArray(block.groups) ? block.groups.filter(isRecord) : [];
  const labelMap = new Map<string, string>();

  groups.forEach((group) => {
    const items = Array.isArray(group.items) ? group.items.filter(isRecord) : [];
    items.forEach((item) => {
      const itemId = typeof item.id === 'string' ? item.id.trim() : '';
      const itemLabel = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : itemId;
      if (itemId) {
        labelMap.set(itemId, itemLabel);
      }
    });
  });

  return selected.map((item) => labelMap.get(item) ?? item);
};

const buildSelectSection = (
  block: Record<string, unknown>,
  snapshot: NormalizedRuleSnapshot
): CharacterParameterRuleSection | null => {
  const blockId = typeof block.id === 'string' ? block.id.trim() : '';
  const title = typeof block.label === 'string' && block.label.trim() ? block.label.trim() : blockId;
  if (!blockId || !title) return null;

  return {
    key: blockId,
    title,
    entries: [
      {
        key: `${blockId}-value`,
        label: title,
        value: getSelectOptionLabel(block, snapshot.blockResults[blockId]),
      },
    ],
  };
};

const buildNumericSection = (
  block: Record<string, unknown>,
  snapshot: NormalizedRuleSnapshot
): CharacterParameterRuleSection | null => {
  const blockId = typeof block.id === 'string' ? block.id.trim() : '';
  const title = typeof block.label === 'string' && block.label.trim() ? block.label.trim() : blockId;
  if (!blockId || !title) return null;

  const rawGroup = isRecord(snapshot.blockResults[blockId]) ? snapshot.blockResults[blockId] : {};
  const fields = Array.isArray(block.fields) ? block.fields.filter(isRecord) : [];
  if (fields.length === 0) return null;

  return {
    key: blockId,
    title,
    entries: fields.map((field) => {
      const fieldId = typeof field.id === 'string' ? field.id.trim() : '';
      const fieldLabel = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : fieldId;
      return {
        key: `${blockId}-${fieldId}`,
        label: fieldLabel,
        value: formatDisplayValue(fieldId, rawGroup[fieldId]),
      };
    }),
  };
};

const buildMultiSelectSection = (
  block: Record<string, unknown>,
  snapshot: NormalizedRuleSnapshot
): CharacterParameterRuleSection | null => {
  const blockId = typeof block.id === 'string' ? block.id.trim() : '';
  const title = typeof block.label === 'string' && block.label.trim() ? block.label.trim() : blockId;
  if (!blockId || !title) return null;

  const labels = getMultiSelectLabels(block, snapshot.blockResults[blockId]);
  return {
    key: blockId,
    title,
    entries: [
      {
        key: `${blockId}-value`,
        label: title,
        value: labels.length > 0 ? labels.join('、') : '未选择',
      },
    ],
  };
};

const buildDerivedSection = (
  block: Record<string, unknown>,
  snapshot: NormalizedRuleSnapshot
): CharacterParameterRuleSection | null => {
  const blockId = typeof block.id === 'string' ? block.id.trim() : '';
  const title = typeof block.label === 'string' && block.label.trim() ? block.label.trim() : blockId || '派生值';
  const fieldEntries = Array.isArray(block.fields) ? block.fields.filter(isRecord) : [];

  const entries = fieldEntries.length > 0
    ? fieldEntries.map((field) => {
        const fieldId = typeof field.id === 'string' ? field.id.trim() : '';
        const fieldLabel = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : getFriendlyLabel(fieldId);
        return {
          key: `${blockId || 'derived'}-${fieldId}`,
          label: fieldLabel,
          value: formatDisplayValue(fieldId, snapshot.derived[fieldId]),
        };
      })
    : Object.entries(snapshot.derived).map(([derivedKey, derivedValue]) => ({
        key: `${blockId || 'derived'}-${derivedKey}`,
        label: getFriendlyLabel(derivedKey),
        value: formatDisplayValue(derivedKey, derivedValue),
      }));

  const filteredEntries = entries.filter((entry) => entry.value !== '-');
  if (filteredEntries.length === 0) return null;

  return {
    key: blockId || 'derived',
    title,
    entries: filteredEntries,
  };
};

const buildSectionNote = (block: Record<string, unknown>): CharacterParameterRuleSection | null => {
  const blockId = typeof block.id === 'string' ? block.id.trim() : 'section';
  const title = typeof block.label === 'string' && block.label.trim() ? block.label.trim() : '说明';
  const description = typeof block.description === 'string' ? block.description.trim() : '';
  if (!description) return null;

  return {
    key: blockId,
    title,
    entries: [],
    note: description,
  };
};

const buildUnknownBlockSection = (
  block: Record<string, unknown>,
  snapshot: NormalizedRuleSnapshot
): CharacterParameterRuleSection | null => {
  const blockId = typeof block.id === 'string' ? block.id.trim() : '';
  const title = typeof block.label === 'string' && block.label.trim() ? block.label.trim() : blockId;
  if (!blockId || !title) return null;
  const rawValue = snapshot.blockResults[blockId];
  if (typeof rawValue === 'undefined') return null;

  return {
    key: blockId,
    title,
    entries: [
      {
        key: `${blockId}-value`,
        label: title,
        value: formatDisplayValue(blockId, rawValue),
      },
    ],
  };
};

const buildRuleSections = (snapshot: NormalizedRuleSnapshot): CharacterParameterRuleSection[] => {
  const preset = tryLoadBuildRulePresetById(snapshot.ruleId);
  if (!preset) {
    const genericEntries = Object.entries(snapshot.blockResults).map(([key, value]) => ({
      key,
      label: getFriendlyLabel(key),
      value: formatDisplayValue(key, value),
    }));
    const derivedEntries = Object.entries(snapshot.derived).map(([key, value]) => ({
      key,
      label: getFriendlyLabel(key),
      value: formatDisplayValue(key, value),
    }));

    const sections: CharacterParameterRuleSection[] = [];
    if (genericEntries.length > 0) {
      sections.push({ key: 'blockResults', title: '输入', entries: genericEntries });
    }
    if (derivedEntries.length > 0) {
      sections.push({ key: 'derived', title: '派生值', entries: derivedEntries });
    }
    return sections;
  }

  const blocks = Array.isArray(preset.blocks) ? preset.blocks.filter(isRecord) : [];
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'select':
          return buildSelectSection(block, snapshot);
        case 'point-buy':
        case 'stat-array':
        case 'number-group':
          return buildNumericSection(block, snapshot);
        case 'multi-select':
          return buildMultiSelectSection(block, snapshot);
        case 'derived':
          return buildDerivedSection(block, snapshot);
        case 'section':
          return buildSectionNote(block);
        default:
          return buildUnknownBlockSection(block, snapshot);
      }
    })
    .filter((section): section is CharacterParameterRuleSection => section !== null);
};

const buildRuleView = (snapshot: NormalizedRuleSnapshot): CharacterParameterRuleView | null => {
  const preset = tryLoadBuildRulePresetById(snapshot.ruleId);
  const sections = buildRuleSections(snapshot);
  if (sections.length === 0) return null;

  const issues = snapshot.validationSummary.issues.filter((issue) => issue.trim().length > 0);
  return {
    ruleId: snapshot.ruleId,
    title: preset?.title?.trim() || snapshot.ruleId,
    version: snapshot.version,
    sections,
    valid: snapshot.validationSummary.valid !== false && issues.length === 0,
    statusLabel:
      snapshot.validationSummary.valid !== false && issues.length === 0
        ? '规则校验通过'
        : `存在 ${issues.length} 条规则问题`,
    issues,
  };
};

const getSourceRules = (container: unknown, key: 'buildRules' | 'rules'): CharacterParameterRuleView[] => {
  if (!isRecord(container) || !Array.isArray(container[key])) return [];

  return container[key]
    .map(normalizeRuleSnapshot)
    .filter((snapshot): snapshot is NormalizedRuleSnapshot => snapshot !== null)
    .map(buildRuleView)
    .filter((rule): rule is CharacterParameterRuleView => rule !== null);
};

export function buildCharacterParameterView(input: CharacterParameterViewInput): CharacterParameterView | null {
  const initialRules = getSourceRules(input.creationInputs, 'buildRules');
  const currentRules = getSourceRules(input.buildState, 'rules');

  const sources: CharacterParameterSourceView[] = [];
  if (initialRules.length > 0) {
    sources.push({ key: 'initial', label: '初始', rules: initialRules });
  }
  if (currentRules.length > 0) {
    sources.push({ key: 'current', label: '当前', rules: currentRules });
  }

  if (sources.length === 0) return null;

  return {
    activeSource: sources.some((source) => source.key === 'current') ? 'current' : 'initial',
    sources,
  };
}
