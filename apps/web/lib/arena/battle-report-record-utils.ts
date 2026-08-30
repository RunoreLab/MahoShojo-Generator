import type { BattleReportGenerationCombatantInsert } from '@/lib/database/battle-report-generation-combatants';
import { getLargeObjectByOwnerRef } from '@/lib/database/large-objects';
import { getObjectText } from '@/lib/r2';

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export function extractBattleReportGenerationErrorMessage(extraJson: string | null | undefined): string | null {
  if (typeof extraJson !== 'string' || !extraJson.trim()) return null;

  try {
    const parsed = JSON.parse(extraJson) as Record<string, unknown>;
    const errorMessage = normalizeOptionalString(parsed?.errorMessage);
    if (!errorMessage) return null;
    return errorMessage.length <= 300 ? errorMessage : `${errorMessage.slice(0, 300)}…`;
  } catch {
    return null;
  }
}

export function buildBattleReportGenerationCombatantInserts(
  generationId: string,
  combatants: unknown,
): BattleReportGenerationCombatantInsert[] {
  if (!Array.isArray(combatants)) return [];
  const safeGenerationId = generationId.trim();
  if (!safeGenerationId) return [];

  const toBytes = (value: string) => new TextEncoder().encode(value).length;

  return combatants.map((combatant: any, index: number) => {
    const name = combatant?.data?.codename || combatant?.data?.name || `未知角色#${index + 1}`;
    const payload = typeof combatant?.data === 'object' ? JSON.stringify(combatant.data) : '';
    const characterGuidance =
      typeof combatant?.characterGuidance === 'string' ? combatant.characterGuidance.trim().slice(0, 100) : '';
    const isPreset = typeof combatant?.isPreset === 'boolean' ? combatant.isPreset : false;
    const presetFilename = isPreset && typeof combatant?.filename === 'string' ? combatant.filename.trim() : '';

    return {
      generationId: safeGenerationId,
      sortIndex: index,
      name,
      type: typeof combatant?.type === 'string' ? combatant.type : null,
      templateId: presetFilename || (typeof combatant?.data?.templateId === 'string' ? combatant.data.templateId : null),
      isNative: typeof combatant?.isNative === 'boolean' ? combatant.isNative : null,
      isPreset: isPreset ? true : null,
      teamId: typeof combatant?.teamId === 'number' ? combatant.teamId : null,
      characterGuidance: characterGuidance || null,
      dataCardId: typeof combatant?.sourceDataCardId === 'string' ? combatant.sourceDataCardId : null,
      dataCardUpdatedAt: typeof combatant?.sourceDataCardUpdatedAt === 'string' ? combatant.sourceDataCardUpdatedAt : null,
      sizeChars: payload ? payload.length : null,
      sizeBytes: payload ? toBytes(payload) : null,
    } satisfies BattleReportGenerationCombatantInsert;
  });
}

export async function loadBattleReportGenerationOutputText(input: {
  generationId: string;
  outputPreview: string | null | undefined;
}): Promise<{
  outputText: string;
  source: 'd1' | 'r2' | 'none';
  hasStoredOutput: boolean;
  readError: string | null;
}> {
  const preview = typeof input.outputPreview === 'string' ? input.outputPreview : '';
  if (preview.trim()) {
    return {
      outputText: preview,
      source: 'd1',
      hasStoredOutput: true,
      readError: null,
    };
  }

  const largeObject = await getLargeObjectByOwnerRef('battle_report_generation_output', input.generationId);
  const r2Key = normalizeOptionalString(largeObject?.r2_key);
  if (!r2Key) {
    return {
      outputText: '',
      source: 'none',
      hasStoredOutput: false,
      readError: null,
    };
  }

  const r2 = await getObjectText(r2Key);
  if (r2.success && typeof r2.data?.text === 'string') {
    return {
      outputText: r2.data.text,
      source: 'r2',
      hasStoredOutput: true,
      readError: null,
    };
  }

  return {
    outputText: '',
    source: 'r2',
    hasStoredOutput: true,
    readError: r2.error || 'R2 读取失败',
  };
}
