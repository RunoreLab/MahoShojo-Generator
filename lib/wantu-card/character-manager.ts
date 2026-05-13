import { buildSafeFileName } from '@/lib/client/fileName';
import { inferTemplate, type InferableTemplate } from '@/lib/data-card-converter';
import { validateDataCard, type ValidationResult } from '@/lib/schemas';
import {
  fromWantuCharacterCard,
  parseWantuCard,
  toWantuCharacterCard,
} from './adapter';
import type {
  FromWantuCharacterCardOptions,
  MahoshojoRoundTripSource,
  WantuCard,
  WantuCharacterExportMode,
} from './types';

export type WantuCharacterImportResolution =
  | { kind: 'not-wantu' }
  | {
      kind: 'success';
      data: Record<string, unknown>;
      restored: boolean;
      warnings: string[];
      selectedTemplate: InferableTemplate;
      validationResult: ValidationResult;
      message: string;
    }
  | { kind: 'error'; error: string; issues: string[] };

export interface WantuCharacterExportPayloadOptions {
  mode?: WantuCharacterExportMode;
  source?: MahoshojoRoundTripSource;
}

export type WantuCharacterExportPayloadResult =
  | {
      success: true;
      card: WantuCard;
      json: string;
      fileName: string;
      message: string;
    }
  | { success: false; error: string };

export function resolveWantuCharacterImport(
  input: unknown,
  options: FromWantuCharacterCardOptions = {},
): WantuCharacterImportResolution {
  if (!hasWantuCardMarker(input)) {
    return { kind: 'not-wantu' };
  }

  const parsed = parseWantuCard(input);
  if (!parsed.success) {
    return {
      kind: 'error',
      error: `万途 Card 格式无效：${parsed.error}`,
      issues: parsed.issues,
    };
  }

  if (parsed.data.cardKind !== 'character') {
    return {
      kind: 'error',
      error: `角色管理中心首批仅支持导入万途 character 卡；当前 cardKind 为 ${parsed.data.cardKind}。`,
      issues: ['cardKind: expected character'],
    };
  }

  const imported = fromWantuCharacterCard(parsed.data, options);
  if (!imported.success) {
    return {
      kind: 'error',
      error: imported.error,
      issues: imported.issues,
    };
  }

  const data = cloneRecord(imported.data);
  const selectedTemplate = inferTemplate(data);
  const validationResult = validateDataCard(data);
  const baseMessage = imported.restored
    ? `成功导入万途往返角色卡并恢复原始模板：${readDisplayName(data, parsed.data.name)}`
    : `成功导入万途角色卡为通用角色：${readDisplayName(data, parsed.data.name)}`;
  const warningText = imported.warnings.length ? ` ${imported.warnings.join(' ')}` : '';

  return {
    kind: 'success',
    data,
    restored: imported.restored,
    warnings: imported.warnings,
    selectedTemplate,
    validationResult,
    message: `${baseMessage}${warningText}`,
  };
}

export function buildWantuCharacterExportPayload(
  data: unknown,
  options: WantuCharacterExportPayloadOptions = {},
): WantuCharacterExportPayloadResult {
  try {
    const mode = options.mode ?? 'interop';
    const card = toWantuCharacterCard(data, {
      mode,
      ...(options.source ? { source: options.source } : {}),
    });
    const suffix = mode === 'roundTrip' ? '_往返' : '';
    const fileName = buildSafeFileName(`万途角色卡_${card.name}${suffix}`, 'json', '万途角色卡');
    const json = JSON.stringify(card, null, 2);
    const modeLabel = mode === 'roundTrip' ? '往返' : '互通';

    return {
      success: true,
      card,
      json,
      fileName,
      message: `已导出万途${modeLabel}角色卡：${card.name}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '无法导出万途角色卡。',
    };
  }
}

function hasWantuCardMarker(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  return typeof (input as Record<string, unknown>).cardKind === 'string';
}

function cloneRecord(input: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

function readDisplayName(data: Record<string, unknown>, fallback: string): string {
  const candidates = [data.codename, data.name, data.title, fallback];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '未命名角色';
}
