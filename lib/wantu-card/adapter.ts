import {
  CanshouSchema,
  GENERAL_CHARACTER_TEMPLATE_ID,
  GeneralCharacterSchema,
  MagicalGirlSchema,
  inferCharacterKind,
  type CanshouData,
  type GeneralCharacterData,
  type MagicalGirlData,
} from '@/lib/schemas';
import { renderCanshouCardMarkdown, renderMagicalGirlCardMarkdown } from './markdown';
import { WantuCardSchema } from './schema';
import type {
  ArenaMaterialCandidateOptions,
  ArenaMaterialCandidateResult,
  FromWantuCharacterCardOptions,
  FromWantuCharacterResult,
  ImportedWantuCharacterData,
  MahoshojoOriginalTemplate,
  MahoshojoRoundTripExtension,
  ToWantuCharacterCardOptions,
  WantuCard,
  WantuParseResult,
} from './types';

const GENERAL_RUNTIME_KEYS = new Set([
  'templateId',
  'name',
  'content',
  'buildState',
  'creationInputs',
  'current_state',
  'arena_history',
  'adjudicationEvents',
  'signature',
  'wantuCard',
]);

const MAGICAL_INTEROP_EXCLUDED_KEYS = new Set([
  'userAnswers',
  'buildState',
  'creationInputs',
  'current_state',
  'arena_history',
  'adjudicationEvents',
  'signature',
]);

const CANSHOU_INTEROP_EXCLUDED_KEYS = new Set([
  'userAnswers',
  'buildState',
  'creationInputs',
  'current_state',
  'arena_history',
  'adjudicationEvents',
  'signature',
]);

export function parseWantuCard(input: unknown): WantuParseResult {
  const parsed = WantuCardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: formatZodError(parsed.error),
      issues: parsed.error.errors.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }

  return { success: true, data: parsed.data as WantuCard };
}

export function toWantuCharacterCard(
  sourceCard: unknown,
  options: ToWantuCharacterCardOptions = {}
): WantuCard {
  if (!isRecord(sourceCard)) {
    throw new Error('无法导出万途角色卡：源数据不是对象。');
  }

  const sourceKind = inferOriginalTemplate(sourceCard);
  const baseFromWantu = readOriginalWantuCard(sourceCard);
  const baseCard = baseFromWantu ? cloneDeep(baseFromWantu) : createEmptyWantuCharacterCard();
  const fields = isRecord(baseCard.fields) ? cloneDeep(baseCard.fields) : {};

  if (sourceKind === 'general') {
    assignGeneralCharacterProjection(baseCard, fields, sourceCard);
  } else if (sourceKind === 'magical-girl') {
    assignMagicalGirlProjection(baseCard, fields, sourceCard);
  } else if (sourceKind === 'canshou') {
    assignCanshouProjection(baseCard, fields, sourceCard);
  } else {
    throw new Error('无法导出万途角色卡：仅支持通用角色、魔法少女与残兽。');
  }

  if (Object.keys(fields).length > 0) {
    baseCard.fields = fields;
  } else {
    delete baseCard.fields;
  }

  if (options.mode === 'roundTrip') {
    const extension: MahoshojoRoundTripExtension = {
      version: 1,
      originalTemplate: sourceKind,
      originalData: cloneDeep(sourceCard),
      ...(options.source ? { source: cloneDeep(options.source) } : {}),
    };
    baseCard._mahoshojo = extension;
  }

  return WantuCardSchema.parse(baseCard) as WantuCard;
}

export function fromWantuCharacterCard(
  input: unknown,
  options: FromWantuCharacterCardOptions = {}
): FromWantuCharacterResult {
  const parsed = parseWantuCard(input);
  if (!parsed.success) return parsed;

  if (parsed.data.cardKind !== 'character') {
    return {
      success: false,
      error: `cardKind 必须是 character，当前为 ${parsed.data.cardKind}。`,
      issues: ['cardKind: expected character'],
    };
  }

  const originalData = readMahoshojoOriginalData(parsed.data);
  if (options.restoreOriginal && originalData !== undefined) {
    return {
      success: true,
      data: cloneDeep(originalData) as Record<string, unknown>,
      restored: true,
      warnings: [],
    };
  }

  const generalData = GeneralCharacterSchema.parse({
    templateId: GENERAL_CHARACTER_TEMPLATE_ID,
    name: parsed.data.name,
    content: parsed.data.content,
    wantuCard: cloneDeep(parsed.data),
  }) as ImportedWantuCharacterData;

  return {
    success: true,
    data: generalData,
    restored: false,
    warnings: originalData === undefined ? [] : ['检测到 _mahoshojo.originalData；未设置 restoreOriginal，已按通用角色导入。'],
  };
}

export function toArenaMaterialCandidate(
  input: unknown,
  options: ArenaMaterialCandidateOptions = {}
): ArenaMaterialCandidateResult {
  const parsed = parseWantuCard(input);
  if (!parsed.success) return parsed;

  if (parsed.data.cardKind === 'character') {
    return {
      success: false,
      error: '角色卡不能作为首版竞技场素材候选；请作为参战角色导入。',
      issues: ['cardKind: character is not a material kind'],
    };
  }

  const sourceDataCardId = options.sourceDataCardId;
  return {
    success: true,
    data: {
      id: sourceDataCardId ?? parsed.data.id ?? `${parsed.data.cardKind}:${parsed.data.name}`,
      kind: parsed.data.cardKind,
      name: parsed.data.name,
      content: cloneDeep(parsed.data),
      fileName: options.fileName ?? null,
      ...(sourceDataCardId ? { sourceDataCardId } : {}),
      ...(options.sourceDataCardUpdatedAt ? { sourceDataCardUpdatedAt: options.sourceDataCardUpdatedAt } : {}),
    },
    warnings: [],
  };
}

function assignGeneralCharacterProjection(
  card: WantuCard,
  fields: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  const parsed = GeneralCharacterSchema.parse(source) as GeneralCharacterData;
  card.cardKind = 'character';
  card.name = parsed.name;
  card.content = parsed.content;

  if (source.buildState !== undefined) {
    fields.mahoshojoBuildState = cloneDeep(source.buildState);
  }
  if (source.current_state !== undefined) {
    fields.mahoshojoCurrentState = cloneDeep(source.current_state);
  }

  const extra = collectExtraFields(source, GENERAL_RUNTIME_KEYS);
  if (Object.keys(extra).length > 0) {
    fields.mahoshojoExtra = extra;
  }
}

function assignMagicalGirlProjection(
  card: WantuCard,
  fields: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  const parsed = MagicalGirlSchema.parse(source) as MagicalGirlData;
  card.cardKind = 'character';
  card.name = parsed.codename;
  card.content = renderMagicalGirlCardMarkdown(parsed);
  fields.mahoshojoMagicalGirl = collectIncludedFields(source, MAGICAL_INTEROP_EXCLUDED_KEYS);

  if (source.userAnswers !== undefined) {
    fields.mahoshojoUserAnswers = cloneDeep(source.userAnswers);
  }
  if (source.buildState !== undefined) {
    fields.mahoshojoBuildState = cloneDeep(source.buildState);
  }
}

function assignCanshouProjection(
  card: WantuCard,
  fields: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  const parsed = CanshouSchema.parse(source) as CanshouData;
  card.cardKind = 'character';
  card.name = parsed.name;
  card.content = renderCanshouCardMarkdown(parsed);
  fields.mahoshojoCanshou = collectIncludedFields(source, CANSHOU_INTEROP_EXCLUDED_KEYS);

  if (source.userAnswers !== undefined) {
    fields.mahoshojoUserAnswers = cloneDeep(source.userAnswers);
  }
  if (source.buildState !== undefined) {
    fields.mahoshojoBuildState = cloneDeep(source.buildState);
  }
}

function createEmptyWantuCharacterCard(): WantuCard {
  return {
    cardKind: 'character',
    name: '',
    content: '',
  };
}

function inferOriginalTemplate(source: Record<string, unknown>): MahoshojoOriginalTemplate {
  const kind = inferCharacterKind(source);
  if (kind === 'magical-girl' || kind === 'canshou' || kind === 'general') return kind;
  return 'unknown';
}

function readOriginalWantuCard(source: Record<string, unknown>): WantuCard | null {
  const embedded = source.wantuCard;
  const parsed = parseWantuCard(embedded);
  return parsed.success ? parsed.data : null;
}

function readMahoshojoOriginalData(card: WantuCard): unknown {
  if (!isRecord(card._mahoshojo)) return undefined;
  return card._mahoshojo.originalData;
}

function collectIncludedFields(
  source: Record<string, unknown>,
  excluded: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (excluded.has(key) || value === undefined) return;
    out[key] = cloneDeep(value);
  });
  return out;
}

function collectExtraFields(
  source: Record<string, unknown>,
  excluded: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (excluded.has(key) || value === undefined) return;
    out[key] = cloneDeep(value);
  });
  return out;
}

function cloneDeep<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatZodError(error: { errors: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.errors
    .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
