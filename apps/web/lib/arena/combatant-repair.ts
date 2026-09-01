import {
  applyUnsignedPostBattleRepair,
  MAX_ARENA_CHARACTER_REPAIR_TEXT_CODE_POINTS,
} from '@mahoshojo/domain/arena-character-repair';
import type {
  ApplyUnsignedPostBattleRepairResult,
  ArenaCharacterRepairHistoryEntryInput,
  ArenaCharacterRepairPatch,
  ArenaRepairCombatant,
} from '@mahoshojo/domain/arena-character-repair';
import { z } from 'zod/v3';

import { repairNormalizeValidate } from '@/lib/repair-pipeline';
import { extractStreamUpdateMeta, STREAM_UPDATE_META_MARKERS } from './stream-meta';

const rawRepairItemSchema = z.object({
  combatantIndex: z.number().int().nonnegative().optional(),
  characterName: z.string().optional(),
  character_name: z.string().optional(),
  name: z.string().optional(),
  character: z.string().optional(),
  impact: z.string().optional(),
  currentStateSummary: z.string().optional(),
  current_state_summary: z.string().optional(),
}).passthrough();

const rawRepairDraftSchema = z.union([
  z.array(rawRepairItemSchema),
  z.object({ impacts: z.array(rawRepairItemSchema) }).passthrough(),
]);

type RepairDraftCombatant = Readonly<{ data?: unknown }>;
type RawRepairItem = z.infer<typeof rawRepairItemSchema>;

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const displayNameOf = (combatant: RepairDraftCombatant): string => {
  const data = recordOf(combatant.data);
  const codename = typeof data?.codename === 'string' ? data.codename.trim() : '';
  if (codename) return codename;
  return typeof data?.name === 'string' ? data.name.trim() : '';
};

const normalizedText = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} 必须是文本。`);
  const text = value.trim();
  if (!text) throw new Error(`${field} 不能为空。`);
  if (Array.from(text).length > MAX_ARENA_CHARACTER_REPAIR_TEXT_CODE_POINTS) {
    throw new Error(`${field} 最多 ${MAX_ARENA_CHARACTER_REPAIR_TEXT_CODE_POINTS} 个字符。`);
  }
  return text;
};

const rawItemsFromDraft = async (draft: string): Promise<RawRepairItem[]> => {
  const trimmed = draft.trim();
  if (!trimmed) throw new Error('修复草稿不能为空。');

  const containsStreamMarker = STREAM_UPDATE_META_MARKERS.some((marker) => (
    trimmed.toUpperCase().includes(marker)
  ));
  if (containsStreamMarker) {
    const extracted = await extractStreamUpdateMeta(trimmed);
    if (!extracted?.meta.impacts?.length) {
      throw new Error('未能从 MAHOSHOJO_ARENA_META 中读取 impacts。');
    }
    return extracted.meta.impacts.map((impact) => ({
      characterName: impact.characterName,
      ...(impact.impact !== undefined ? { impact: impact.impact } : {}),
      ...(impact.currentStateSummary !== undefined
        ? { currentStateSummary: impact.currentStateSummary }
        : {}),
    }));
  }

  const parsed = await repairNormalizeValidate({
    input: trimmed,
    schema: rawRepairDraftSchema,
    autoPromoteBySchemaKeys: false,
    as: 'object',
  });
  if (typeof parsed === 'string') throw new Error('修复草稿格式无效。');
  return Array.isArray(parsed) ? parsed : parsed.impacts;
};

/**
 * 将用户输入或 AI 草稿归一化为 domain patch。缺少 index 时只允许通过唯一的
 * exact display name 补全；存在重名时必须由用户明确给出 roster index。
 */
export const normalizeArenaRepairDraft = async (input: Readonly<{
  draft: string;
  combatants: readonly RepairDraftCombatant[];
}>): Promise<ArenaCharacterRepairPatch[]> => {
  const names = input.combatants.map(displayNameOf);
  if (names.some((name) => !name)) throw new Error('参战 roster 中存在缺少名称的角色。');

  const rawItems = await rawItemsFromDraft(input.draft);
  if (rawItems.length === 0) throw new Error('修复草稿至少需要一个角色 patch。');

  const patches: ArenaCharacterRepairPatch[] = [];
  const seenIndexes = new Set<number>();
  rawItems.forEach((item, draftIndex) => {
    const suppliedName = (
      item.characterName
      ?? item.character_name
      ?? item.name
      ?? item.character
      ?? ''
    ).trim();

    let combatantIndex = item.combatantIndex;
    if (combatantIndex === undefined) {
      if (!suppliedName) throw new Error(`第 ${draftIndex + 1} 项缺少 characterName。`);
      const matches = names.reduce<number[]>((indices, name, index) => {
        if (name === suppliedName) indices.push(index);
        return indices;
      }, []);
      if (matches.length === 0) throw new Error(`角色「${suppliedName}」不在当前 roster 中。`);
      if (matches.length > 1) {
        throw new Error(`角色「${suppliedName}」存在重名，必须显式提供 combatantIndex。`);
      }
      combatantIndex = matches[0]!;
    }

    if (!Number.isSafeInteger(combatantIndex) || combatantIndex < 0 || combatantIndex >= names.length) {
      throw new Error(`第 ${draftIndex + 1} 项的 combatantIndex 超出 roster 范围。`);
    }
    const characterName = names[combatantIndex]!;
    if (suppliedName && suppliedName !== characterName) {
      throw new Error(`第 ${draftIndex + 1} 项的 characterName 与 combatantIndex 指向角色不一致。`);
    }
    if (seenIndexes.has(combatantIndex)) {
      throw new Error(`combatantIndex ${combatantIndex} 在修复草稿中重复。`);
    }
    seenIndexes.add(combatantIndex);

    const impact = normalizedText(item.impact, 'impact');
    const currentStateSummary = normalizedText(
      item.currentStateSummary ?? item.current_state_summary,
      'currentStateSummary',
    );
    if (impact === undefined && currentStateSummary === undefined) {
      throw new Error(`角色「${characterName}」至少需要一个可修复字段。`);
    }
    patches.push({
      combatantIndex,
      characterName,
      ...(impact !== undefined ? { impact } : {}),
      ...(currentStateSummary !== undefined ? { currentStateSummary } : {}),
    });
  });

  return patches;
};

const hasCanonicalTrustHint = (combatant: ArenaRepairCombatant): boolean => {
  const wrapper = combatant as Record<string, unknown>;
  const data = recordOf(combatant.data);
  const metadata = recordOf(data?.metadata);
  return Boolean(
    wrapper.isValid
    || wrapper.isPreset
    || wrapper.isNative
    || wrapper.sourceDataCardId
    || wrapper.sourceDataCardUpdatedAt
    || wrapper.arenaRoomKey
    || wrapper.adjudicationSourceKey
    || data?.signature
    || metadata?.signature
  );
};

type RepairCancelledResult = Readonly<{
  ok: false;
  reason: 'trust-downgrade-cancelled' | 'missing-effect-cancelled';
}>;

export type PreparedArenaCombatantRepairResult<TCombatant extends ArenaRepairCombatant> =
  | ApplyUnsignedPostBattleRepairResult<TCombatant>
  | RepairCancelledResult;

const uniquePatchIndices = (patches: readonly ArenaCharacterRepairPatch[]): number[] => (
  Array.from(new Set(patches.map((patch) => patch.combatantIndex)))
);

export const prepareAndApplyArenaCombatantRepair = async <
  TCombatant extends ArenaRepairCombatant,
>(input: Readonly<{
  combatants: readonly TCombatant[];
  generationId: string;
  patches: readonly ArenaCharacterRepairPatch[];
  nowISO: string;
  createHistoryEntry: ArenaCharacterRepairHistoryEntryInput;
  verifyNative: (characterData: unknown) => Promise<boolean>;
  confirmTrustDowngrade: (characterNames: readonly string[]) => Promise<boolean> | boolean;
  confirmCreateMissingEffects: () => Promise<boolean> | boolean;
}>): Promise<PreparedArenaCombatantRepairResult<TCombatant>> => {
  const initial = applyUnsignedPostBattleRepair({
    combatants: input.combatants,
    generationId: input.generationId,
    patches: input.patches,
    nowISO: input.nowISO,
    createHistoryEntry: input.createHistoryEntry,
  });

  if (initial.ok && initial.status === 'no-op') return initial;
  if (!initial.ok && initial.reason !== 'generation-effect-not-found') return initial;

  const candidateIndices = initial.ok
    ? initial.changedCombatantIndices
    : uniquePatchIndices(input.patches);
  const trustChecks = await Promise.all(candidateIndices.map(async (index) => {
    const combatant = input.combatants[index]!;
    return hasCanonicalTrustHint(combatant) || input.verifyNative(combatant.data);
  }));
  if (trustChecks.some(Boolean)) {
    const affectedNames = Array.from(new Set(candidateIndices.map((index) => (
      displayNameOf(input.combatants[index]!)
    ))));
    if (!(await input.confirmTrustDowngrade(affectedNames))) {
      return { ok: false, reason: 'trust-downgrade-cancelled' };
    }
  }

  if (initial.ok) return initial;
  if (!(await input.confirmCreateMissingEffects())) {
    return { ok: false, reason: 'missing-effect-cancelled' };
  }

  return applyUnsignedPostBattleRepair({
    combatants: input.combatants,
    generationId: input.generationId,
    patches: input.patches,
    nowISO: input.nowISO,
    allowCreateMissingEffects: true,
    createHistoryEntry: input.createHistoryEntry,
  });
};
