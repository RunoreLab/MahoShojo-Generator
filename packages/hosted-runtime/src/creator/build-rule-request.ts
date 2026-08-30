import { evaluateBuildRuleState } from './build-rule-runtime';
import { tryLoadBuildRulePresetById } from './build-rules';

import type { BuildRuleRequestInput, BuildRuleRuntimeResult } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseBuildRuleRequestInput = (raw: unknown): BuildRuleRequestInput => {
  if (!isRecord(raw)) {
    throw new Error('BUILD_RULE_PAYLOAD_INVALID');
  }

  const ruleId = typeof raw.ruleId === 'string' ? raw.ruleId.trim() : '';
  if (!ruleId) {
    throw new Error('BUILD_RULE_RULE_ID_REQUIRED');
  }

  const preset = tryLoadBuildRulePresetById(ruleId);
  if (!preset) {
    throw new Error(`BUILD_RULE_PRESET_NOT_FOUND:${ruleId}`);
  }

  const version = typeof raw.version === 'string' && raw.version.trim() ? raw.version.trim() : preset.version;
  if (version !== preset.version) {
    throw new Error('BUILD_RULE_VERSION_MISMATCH');
  }

  if (!('inputs' in raw)) {
    throw new Error('BUILD_RULE_INPUTS_REQUIRED');
  }

  if (!isRecord(raw.inputs)) {
    throw new Error('BUILD_RULE_INPUTS_INVALID');
  }

  return {
    ruleId,
    version,
    inputs: raw.inputs,
  };
};

export function normalizeBuildRuleRequestInputs(raw: unknown): BuildRuleRequestInput[] {
  if (typeof raw === 'undefined' || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('BUILD_RULE_LIST_INVALID');
  }
  return raw.map((item) => parseBuildRuleRequestInput(item));
}

export function resolveBuildRuleRuntimeResultsFromRequest(raw: unknown): BuildRuleRuntimeResult[] {
  const normalizedInputs = normalizeBuildRuleRequestInputs(raw);
  return normalizedInputs.map(({ ruleId, inputs }) =>
    evaluateBuildRuleState({
      ruleId,
      inputs,
    })
  );
}
