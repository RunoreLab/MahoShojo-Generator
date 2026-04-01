import type { BuildRulePreset } from './types';

import { normalizeBuildRuleBlockKey, loadBuildRulePresetById } from './build-rules';

const CORE_ATTRIBUTE_KEYS = ['STR', 'CON', 'AGI', 'MAG', 'WILL', 'PER', 'CHM'] as const;
type CoreAttributeKey = (typeof CORE_ATTRIBUTE_KEYS)[number];

const POWER_LEVEL_ATTRIBUTE_BUDGET: Record<string, number> = {
  seed: 90,
  bloom: 105,
  nova: 120,
};

const POWER_LEVEL_SPECIALTY_LIMITS: Record<string, { maxSelections: number; budget: number }> = {
  seed: { maxSelections: 2, budget: 2 },
  bloom: { maxSelections: 3, budget: 3 },
  nova: { maxSelections: 4, budget: 4 },
};

const SPECIALTY_COST: Record<string, number> = {
  'magic-burst': 1,
};

type ValidationIssueCode =
  | 'required-missing'
  | 'budget-exceeded'
  | 'selection-count'
  | 'invalid-value';

export interface BuildRuleValidationIssue {
  code: ValidationIssueCode;
  blockKey: string;
  message: string;
}

export interface BuildRuleValidationSummary {
  valid: boolean;
  issues: BuildRuleValidationIssue[];
  missingRequiredBlockKeys: string[];
}

export interface EvaluateBuildRuleStateParams {
  presetId: string;
  input: Record<string, unknown>;
}

export interface BuildRuleRuntimeResult {
  presetId: string;
  normalizedInput: Record<string, unknown>;
  derived: Record<string, number>;
  validationSummary: BuildRuleValidationSummary;
}

const coerceString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getRawInputValue = (
  input: Record<string, unknown>,
  preset: BuildRulePreset,
  logicalKey: string
): unknown => {
  if (Object.prototype.hasOwnProperty.call(input, logicalKey)) {
    return input[logicalKey];
  }

  const matchedBlock = preset.blocks.find(
    (block) => normalizeBuildRuleBlockKey(block.id) === logicalKey
  );
  if (matchedBlock && Object.prototype.hasOwnProperty.call(input, matchedBlock.id)) {
    return input[matchedBlock.id];
  }

  const normalizedMatch = Object.keys(input).find(
    (key) => normalizeBuildRuleBlockKey(key) === logicalKey
  );
  if (normalizedMatch) {
    return input[normalizedMatch];
  }

  return undefined;
};

const parseCoreAttributes = (
  value: unknown
): { attributes: Record<CoreAttributeKey, number> | null; invalid: boolean } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { attributes: null, invalid: value !== undefined };
  }

  const raw = value as Record<string, unknown>;
  const parsed = {} as Record<CoreAttributeKey, number>;

  for (const key of CORE_ATTRIBUTE_KEYS) {
    const maybeNumber = raw[key];
    if (typeof maybeNumber !== 'number' || Number.isNaN(maybeNumber)) {
      return { attributes: null, invalid: true };
    }
    parsed[key] = maybeNumber;
  }

  return { attributes: parsed, invalid: false };
};

const sumCoreAttributes = (attributes: Record<CoreAttributeKey, number>): number =>
  CORE_ATTRIBUTE_KEYS.reduce((sum, key) => sum + attributes[key], 0);

const parseSpecialties = (
  value: unknown
): { specialties: string[] | null; invalid: boolean } => {
  if (value === undefined) {
    return { specialties: [], invalid: false };
  }
  if (!Array.isArray(value)) {
    return { specialties: null, invalid: true };
  }
  const specialties = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (specialties.length !== value.length) {
    return { specialties: null, invalid: true };
  }
  return { specialties, invalid: false };
};

const getSpecialtyCost = (specialty: string): number => SPECIALTY_COST[specialty] ?? 1;

export function evaluateBuildRuleState(params: EvaluateBuildRuleStateParams): BuildRuleRuntimeResult {
  const preset = loadBuildRulePresetById(params.presetId);
  const input = params.input ?? {};
  const issues: BuildRuleValidationIssue[] = [];

  const powerLevelRaw = getRawInputValue(input, preset, 'powerLevel');
  const powerLevel = coerceString(powerLevelRaw);
  if (!powerLevel) {
    issues.push({
      code: 'required-missing',
      blockKey: 'powerLevel',
      message: 'powerLevel is required.',
    });
  } else if (!POWER_LEVEL_ATTRIBUTE_BUDGET[powerLevel]) {
    issues.push({
      code: 'invalid-value',
      blockKey: 'powerLevel',
      message: `Unsupported powerLevel: ${powerLevel}.`,
    });
  }

  const coreAttributesRaw = getRawInputValue(input, preset, 'coreAttributes');
  const parsedCoreAttributes = parseCoreAttributes(coreAttributesRaw);
  if (coreAttributesRaw === undefined) {
    issues.push({
      code: 'required-missing',
      blockKey: 'coreAttributes',
      message: 'coreAttributes is required.',
    });
  } else if (parsedCoreAttributes.invalid) {
    issues.push({
      code: 'invalid-value',
      blockKey: 'coreAttributes',
      message: 'coreAttributes must contain numeric STR/CON/AGI/MAG/WILL/PER/CHM.',
    });
  }

  if (powerLevel && parsedCoreAttributes.attributes && POWER_LEVEL_ATTRIBUTE_BUDGET[powerLevel]) {
    const totalAttributes = sumCoreAttributes(parsedCoreAttributes.attributes);
    const maxBudget = POWER_LEVEL_ATTRIBUTE_BUDGET[powerLevel];
    if (totalAttributes > maxBudget) {
      issues.push({
        code: 'budget-exceeded',
        blockKey: 'coreAttributes',
        message: `coreAttributes point-buy exceeds budget: ${totalAttributes}/${maxBudget}.`,
      });
    }
  }

  const specialtiesRaw = getRawInputValue(input, preset, 'specialties');
  const parsedSpecialties = parseSpecialties(specialtiesRaw);
  if (parsedSpecialties.invalid) {
    issues.push({
      code: 'invalid-value',
      blockKey: 'specialties',
      message: 'specialties must be a string array.',
    });
  } else if (powerLevel && parsedSpecialties.specialties) {
    const limits = POWER_LEVEL_SPECIALTY_LIMITS[powerLevel] ?? POWER_LEVEL_SPECIALTY_LIMITS.seed;
    if (parsedSpecialties.specialties.length > limits.maxSelections) {
      issues.push({
        code: 'selection-count',
        blockKey: 'specialties',
        message: `specialties exceeds max selections: ${parsedSpecialties.specialties.length}/${limits.maxSelections}.`,
      });
    }
    const usedBudget = parsedSpecialties.specialties.reduce(
      (sum, specialty) => sum + getSpecialtyCost(specialty),
      0
    );
    if (usedBudget > limits.budget) {
      issues.push({
        code: 'budget-exceeded',
        blockKey: 'specialties',
        message: `specialties budget exceeds limit: ${usedBudget}/${limits.budget}.`,
      });
    }
  }

  const attributes = parsedCoreAttributes.attributes;
  const derived =
    attributes === null
      ? { HP: 0, MP: 0, Radiance: 0 }
      : {
          HP: Math.ceil((attributes.CON + attributes.STR) / 10),
          MP: Math.ceil(attributes.MAG / 4),
          Radiance: Math.ceil(attributes.WILL / 5),
        };

  const validationSummary: BuildRuleValidationSummary = {
    valid: issues.length === 0,
    issues,
    missingRequiredBlockKeys: issues
      .filter((issue) => issue.code === 'required-missing')
      .map((issue) => issue.blockKey),
  };

  const normalizedInput: Record<string, unknown> = {
    powerLevel,
    coreAttributes: attributes,
    specialties: parsedSpecialties.specialties ?? null,
  };

  return {
    presetId: params.presetId,
    normalizedInput,
    derived,
    validationSummary,
  };
}
