import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from '@mahoshojo/contracts/arena-capabilities';
import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import { GeneralScenarioSchema, ScenarioSchema } from '@mahoshojo/domain/data-card-schemas';
import { PRESET_LIST } from '@mahoshojo/domain/presets';
import { normalizeScenarioPresetFilename } from '@mahoshojo/domain/scenario-presets';
import type { ArenaDraft } from './session';

export const arenaItemName = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '未命名';
  const data = value as Record<string, unknown>;
  return String(data.codename || data.name || data.title || '未命名');
};
export const parseArenaJson = (text: string): unknown => {
  // File/paste admission follows the complete original Arena business budget, not the library write envelope.
  if (new TextEncoder().encode(text).byteLength > ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes) throw new Error('输入超过 Arena 12 MiB 原始内容上限。');
  const value: unknown = JSON.parse(text); return SafeJsonValueSchema.parse(value);
};
export const readArenaFile = async (file: File, signal: AbortSignal): Promise<string> => {
  if (file.size > ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes) throw new Error('文件超过 Arena 12 MiB 输入上限。');
  signal.throwIfAborted(); const text = await file.text(); signal.throwIfAborted(); return text;
};
export const fetchArenaPreset = async (kind: 'character' | 'scenario', filename: string, signal: AbortSignal): Promise<string> => {
  if (kind === 'character' && !PRESET_LIST.some((preset) => preset.filename === filename)) throw new Error('未知角色预设。');
  if (kind === 'scenario') filename = normalizeScenarioPresetFilename(filename);
  const response = await fetch(`/${kind === 'character' ? 'presets' : 'scenario-presets'}/${filename}`, { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('预设读取失败，可重试或上传 JSON。');
  const text = await response.text(); parseArenaJson(text); return text;
};
export const parseArenaScenario = (text: string): Record<string, unknown> => {
  const value = parseArenaJson(text);
  const scenario = ScenarioSchema.safeParse(value); if (scenario.success) return scenario.data;
  const general = GeneralScenarioSchema.safeParse(value); if (general.success) return general.data;
  throw new Error('情景 JSON 格式不受支持。');
};
export const addArenaCombatants = (draft: ArenaDraft, combatants: ArenaDraft['combatants']): ArenaDraft => {
  if (draft.combatants.length + combatants.length > ARENA_CANONICAL_CAPABILITIES.maxCombatants) throw new Error('角色总数超过 32 位，未导入任何新角色。');
  return { ...draft, combatants: [...draft.combatants, ...combatants] };
};
export const moveArenaItem = <T,>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items]; if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1); next.splice(to, 0, item!); return next;
};
