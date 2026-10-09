import type { InferableDataCardTemplate } from '../data-cards';
import { validateTavernRaw } from './document';
import { recommendTavernExportFields, type TavernExportMeta } from './recommend';
import type { TavernScenarioFragment } from './scenario';
import type { TavernCardV3 } from './types';
import { createTavernV3Card } from './v3';
import { buildArenaDefaultScenario, buildArenaWorldbook } from './worldbook';

/** Optional diagnostic snapshot only; this is never a bound on roleplay text. */
export const TAVERN_SOURCE_SNAPSHOT_MAX_CHARS = 24_000;
const WORLDBOOK_ENTRY_MAX_CHARS = 6_000;

/** A host-selected identity, without coupling the pure exporter to an auth runtime. */
export interface TavernExporter {
  id?: number;
  username?: string;
}

export type ExportMetaRating = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
  lastDelta: number | null;
  lastAppliedAt: string | null;
  publicRank: number | null;
  publicTotal: number | null;
  winRate: number | null;
};

export type ExportMeta = TavernExportMeta & {
  dataCardId?: string;
  dataCardName?: string;
  dataCardDescription?: string;
  author?: string;
  isPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
  likeCount?: number;
  favoriteCount?: number;
  usageCount?: number;
  techScore?: number | null;
  ratings?: { strict: ExportMetaRating | null; free: ExportMetaRating | null };
};


export interface ExportFields {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  tags: string;
  creator: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  talkativeness: number;
  fav: boolean;
}


export const DEFAULT_CREATOR_NOTES = '来源：MahoShojo-Generator / 魔法少女竞技场 A.R.E.N.A.';
export const DEFAULT_TAVERN_CREATOR = 'github.com/RunoreLab/MahoShojo-Generator';

export const initialFields: ExportFields = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  firstMes: '',
  mesExample: '',
  tags: '',
  creator: DEFAULT_TAVERN_CREATOR,
  creatorNotes: DEFAULT_CREATOR_NOTES,
  systemPrompt: '',
  postHistoryInstructions: '',
  talkativeness: 0.5,
  fav: false,
};


const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

const safeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
};

const readCloudSourceCardId = (record: Record<string, unknown>): string => {
  const internalId = safeString(record['_cardId']).trim();
  if (internalId) return internalId;
  return safeString(record['dataCardId']).trim();
};

const uniqueStrings = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const readTavernMeta = (card: unknown): Record<string, unknown> | null => {
  if (!isRecord(card)) return null;
  const tavern = card['_tavern'];
  if (!isRecord(tavern)) return null;
  const meta = tavern['meta'];
  return isRecord(meta) ? meta : null;
};

const DEFAULT_CLOUD_CARD_DESCRIPTIONS = new Set(['角色数据卡', '情景数据卡', '叙事历史数据卡']);

const appendCreatorNotes = (base: string, block: string): string => {
  const left = base.trim();
  const right = block.trim();
  if (!right) return left;
  if (left.includes(right)) return left;
  if (!left) return right;
  return `${left}\n\n${right}`;
};

export const buildCreatorNotesWithCloudDescription = (dataCard: unknown, baseCreatorNotes: string): string => {
  if (!isRecord(dataCard)) return baseCreatorNotes;

  const cloudId = readCloudSourceCardId(dataCard);
  if (!cloudId) return baseCreatorNotes;

  const cloudDescription = safeString(dataCard['_cardDescription']).trim();
  if (!cloudDescription) return baseCreatorNotes;
  if (DEFAULT_CLOUD_CARD_DESCRIPTIONS.has(cloudDescription)) return baseCreatorNotes;

  const capped = cloudDescription.replace(/\r\n/g, '\n').slice(0, 800);
  const block = `【档案馆简介】\n${capped}${cloudDescription.length > 800 ? '\n...[已截断]' : ''}`;
  return appendCreatorNotes(baseCreatorNotes, block);
};

export const buildDefaultFieldsFromDataCard = (
  template: InferableDataCardTemplate,
  card: unknown,
  exportMeta?: ExportMeta | null,
  creator?: string
): ExportFields => {
  const meta = readTavernMeta(card);
  const metaTags = meta ? safeStringArray(meta['tags']) : [];
  const recommended = recommendTavernExportFields(template, card, metaTags, exportMeta ?? undefined);
  const recommendedTags = recommended.tags.join(', ');

  if (!isRecord(card)) {
    return { ...initialFields };
  }

  const fromMeta = (key: string): string => (meta ? safeString(meta[key]) : '');
  const fromMetaFirstMes = fromMeta('firstMes') || fromMeta('first_mes');
  const fromMetaMesExample = fromMeta('mesExample') || fromMeta('mes_example');
  const baseCreatorNotes = fromMeta('creatorNotes') || fromMeta('creator_notes') || DEFAULT_CREATOR_NOTES;
  const creatorNotes = buildCreatorNotesWithCloudDescription(card, baseCreatorNotes);
  const creatorField = creator?.trim() || safeString(meta?.['creator']) || DEFAULT_TAVERN_CREATOR;

  if (template === 'magical-girl') {
    const codename = safeString(card['codename']) || safeString(card['name']) || '未命名角色';
    const appearance = isRecord(card['appearance']) ? card['appearance'] : null;
    const analysis = isRecord(card['analysis']) ? card['analysis'] : null;
    const magicConstruct = isRecord(card['magicConstruct']) ? card['magicConstruct'] : null;
    const wonderlandRule = isRecord(card['wonderlandRule']) ? card['wonderlandRule'] : null;
    const blooming = isRecord(card['blooming']) ? card['blooming'] : null;

    const descParts: string[] = [];
    const overallLook = appearance ? safeString(appearance['overallLook']) : '';
    const outfit = appearance ? safeString(appearance['outfit']) : '';
    const accessories = appearance ? safeString(appearance['accessories']) : '';
    const colorScheme = appearance ? safeString(appearance['colorScheme']) : '';
    if (overallLook || outfit || accessories || colorScheme) {
      descParts.push(
        ['【外观】', overallLook, outfit && `服装：${outfit}`, accessories && `饰品：${accessories}`, colorScheme && `配色：${colorScheme}`]
          .filter(Boolean)
          .join('\n')
      );
    }
    if (magicConstruct) {
      const mcName = safeString(magicConstruct['name']);
      const mcForm = safeString(magicConstruct['form']);
      const mcDesc = safeString(magicConstruct['description']);
      const mcAbilities = Array.isArray(magicConstruct['basicAbilities']) ? safeStringArray(magicConstruct['basicAbilities']) : [];
      if (mcName || mcForm || mcDesc || mcAbilities.length > 0) {
        descParts.push(
          ['【魔装】', mcName && `名称：${mcName}`, mcForm && `形态：${mcForm}`, mcAbilities.length > 0 ? `能力：${mcAbilities.join('、')}` : '', mcDesc]
            .filter(Boolean)
            .join('\n')
        );
      }
    }
    if (wonderlandRule) {
      const wlName = safeString(wonderlandRule['name']);
      const wlDesc = safeString(wonderlandRule['description']);
      const wlActivation = safeString(wonderlandRule['activation']);
      const wlTendency = safeString(wonderlandRule['tendency']);
      if (wlName || wlDesc || wlActivation || wlTendency) {
        descParts.push(
          ['【奇境规则】', wlName && `名称：${wlName}`, wlTendency && `倾向：${wlTendency}`, wlActivation && `触发：${wlActivation}`, wlDesc]
            .filter(Boolean)
            .join('\n')
        );
      }
    }
    if (blooming) {
      const blName = safeString(blooming['name']);
      const blPower = safeString(blooming['powerLevel']);
      const blForm = safeString(blooming['evolvedForm']);
      const blOutfit = safeString(blooming['evolvedOutfit']);
      const blAbilities = Array.isArray(blooming['evolvedAbilities']) ? safeStringArray(blooming['evolvedAbilities']) : [];
      if (blName || blPower || blForm || blOutfit || blAbilities.length > 0) {
        descParts.push(
          [
            '【繁开】',
            blName && `名称：${blName}`,
            blPower && `强度：${blPower}`,
            blForm && `形态：${blForm}`,
            blOutfit && `装束：${blOutfit}`,
            blAbilities.length > 0 ? `能力：${blAbilities.join('、')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        );
      }
    }

    const personality = safeString(analysis?.['personalityAnalysis']) || fromMeta('personality');

    return {
      ...initialFields,
      name: fromMeta('name') || codename,
      description: fromMeta('description') || descParts.filter(Boolean).join('\n\n'),
      personality,
      scenario: fromMeta('scenario'),
      firstMes: fromMetaFirstMes || recommended.firstMes || '',
      mesExample: fromMetaMesExample || recommended.mesExample || '',
      tags: recommendedTags,
      creator: creatorField,
      creatorNotes,
    };
  }

  if (template === 'canshou') {
    const name = safeString(card['name']) || '未命名残兽';
    const descParts: string[] = [];
    const appearance = safeString(card['appearance']);
    const skin = safeString(card['materialAndSkin']);
    const appendages = safeString(card['featuresAndAppendages']);
    const evolution = safeString(card['evolutionStage']);
    const attack = safeString(card['attackMethod']);
    const ability = safeString(card['specialAbility']);
    if (appearance) descParts.push(`【外观】\n${appearance}`);
    if (skin) descParts.push(`【材质与皮肤】\n${skin}`);
    if (appendages) descParts.push(`【特征与附肢】\n${appendages}`);
    if (evolution) descParts.push(`【进化阶段】\n${evolution}`);
    if (attack) descParts.push(`【攻击方式】\n${attack}`);
    if (ability) descParts.push(`【特殊能力】\n${ability}`);

    const personality = safeString(card['coreEmotion']) || fromMeta('personality');

    return {
      ...initialFields,
      name: fromMeta('name') || name,
      description: fromMeta('description') || descParts.filter(Boolean).join('\n\n'),
      personality,
      scenario: fromMeta('scenario'),
      firstMes: fromMetaFirstMes,
      mesExample: fromMetaMesExample,
      tags: recommendedTags,
      creator: creatorField,
      creatorNotes,
    };
  }

  const name = safeString(card['name']) || safeString(card['codename']) || fromMeta('name') || '未命名角色';
  const content = safeString(card['content']) || safeString(card['description']) || '';
  return {
    ...initialFields,
    name,
    description: fromMeta('description') || content,
    personality: fromMeta('personality'),
    scenario: fromMeta('scenario'),
    firstMes: fromMetaFirstMes,
    mesExample: fromMetaMesExample,
    tags: recommendedTags,
    creator: creatorField,
    creatorNotes,
  };
};


export const buildCreatorField = (exportMeta: ExportMeta | null, user: TavernExporter | null): string => {
  const parts: string[] = [DEFAULT_TAVERN_CREATOR];
  if (user?.username) parts.push(user.username);
  const author = exportMeta?.author?.trim() ?? '';
  if (author && author !== '未知' && author.toLowerCase() !== 'unknown') {
    parts.push(author);
  }
  return uniqueStrings(parts).join(' / ');
};


export const buildSourceDataSnapshot = (dataCard: unknown, maxChars: number): { json: string; truncated: boolean } | null => {
  try {
    const json = JSON.stringify(dataCard);
    if (!json) return null;
    if (json.length <= maxChars) return { json, truncated: false };
    return { json: `${json.slice(0, maxChars)}\n...[已截断]`, truncated: true };
  } catch {
    return null;
  }
};


/** Source metadata is supplied by the host, never inferred from source-card claims. */
export const buildExportExtensions = (
  dataCard: unknown,
  exportMeta: ExportMeta | null,
  user: TavernExporter | null,
  options: { exportedAt: string; includeSourceSnapshot?: boolean }
) => {
  const exportedAt = options.exportedAt;
  const snapshot = options.includeSourceSnapshot === false
    ? null
    : buildSourceDataSnapshot(dataCard, TAVERN_SOURCE_SNAPSHOT_MAX_CHARS);
  const source = exportMeta
    ? {
        kind: exportMeta.source,
        dataCardId: exportMeta.dataCardId,
        name: exportMeta.dataCardName,
        description: exportMeta.dataCardDescription,
        author: exportMeta.author,
        isPublic: exportMeta.isPublic,
        createdAt: exportMeta.createdAt,
        updatedAt: exportMeta.updatedAt,
        stats: {
          likeCount: exportMeta.likeCount,
          favoriteCount: exportMeta.favoriteCount,
          usageCount: exportMeta.usageCount,
        },
        tags: exportMeta.tags ? uniqueStrings(exportMeta.tags) : undefined,
        metrics: {
          techScore: exportMeta.techScore ?? null,
          techLevel: exportMeta.techLevel ?? null,
          isNative: typeof exportMeta.isNative === 'boolean' ? exportMeta.isNative : null,
        },
        ratings: exportMeta.ratings ?? undefined,
        rankTier: exportMeta.rankTier ?? undefined,
      }
    : undefined;

  const exporter = user ? { id: user.id, username: user.username } : undefined;

  return {
    ms_export: {
      version: 1,
      exportedAt,
      exporter,
      source,
      sourceDataJson: snapshot?.json,
      sourceDataTruncated: snapshot?.truncated ? true : undefined,
    },
  };
};

export interface TavernExportOptions {
  autoArenaScenario?: boolean;
  includeArenaWorldbook?: boolean;
  includeScenarioInScenario?: boolean;
  includeScenarioInWorldbook?: boolean;
  /** The bounded sourceDataJson extension is diagnostic, not a lossless archive. */
  includeSourceSnapshot?: boolean;
}

export interface BuildTavernExportCardInput {
  fields: ExportFields;
  dataCard: unknown;
  options?: TavernExportOptions;
  scenarioFragments?: readonly TavernScenarioFragment[];
  /** Only host-established metadata belongs here; raw card claims remain inert. */
  exportMeta?: ExportMeta | null;
  exporter?: TavernExporter | null;
  /** The host captures time once per export; the domain layer does not read a clock. */
  exportedAt: string;
}

export interface TavernExportCardResult {
  card: TavernCardV3;
  warnings: string[];
  sourceSnapshot: {
    /** Whether the caller requested the optional diagnostic snapshot. */
    included: boolean;
    /** Whether a serialized diagnostic snapshot is present in this result. */
    available: boolean;
    truncated: boolean;
    maxChars: number;
  };
}

/** Keep the existing Web tag splitting, order, de-duplication and 50-tag limit. */
export const parseTavernExportTags = (tags: string): string[] =>
  uniqueStrings(tags.split(/[,\n]/g)).slice(0, 50);

/**
 * The shared Web/Desktop field projection. It deliberately does not validate signatures,
 * fetch metadata, call AI, read files, or limit the main description. Hosts retain the
 * original data card for a separate complete source-JSON export.
 */
export function buildTavernExportCard(input: BuildTavernExportCardInput): TavernExportCardResult {
  const { fields, dataCard } = input;
  const options = input.options ?? {};
  const fragments = input.scenarioFragments ?? [];
  const warnings: string[] = [];

  if (dataCard !== null && dataCard !== undefined) {
    warnings.push('酒馆导出按已支持字段生成，未映射字段和原有扩展不会自动成为酒馆标准字段；如需完整保留源数据，请另存源 JSON。');
  }

  const scenarioParts: string[] = [];
  const baseScenario = fields.scenario.trim();
  if (baseScenario) {
    scenarioParts.push(baseScenario);
  } else if (options.autoArenaScenario !== false) {
    scenarioParts.push(buildArenaDefaultScenario());
  }
  if (options.includeScenarioInScenario !== false) {
    for (const fragment of fragments) scenarioParts.push(fragment.content);
  }
  const finalScenario = scenarioParts.filter(Boolean).join('\n\n---\n\n').trim();

  const includeArenaWorldbook = options.includeArenaWorldbook !== false;
  const includeScenarioInWorldbook = options.includeScenarioInWorldbook !== false;
  const shouldWriteBook = includeArenaWorldbook || (includeScenarioInWorldbook && fragments.length > 0);
  const characterBook = shouldWriteBook
    ? buildArenaWorldbook({
        includeCore: includeArenaWorldbook,
        scenarioFragments: includeScenarioInWorldbook ? [...fragments] : [],
        maxEntryChars: WORLDBOOK_ENTRY_MAX_CHARS,
      })
    : undefined;

  if (options.includeScenarioInScenario !== false || includeScenarioInWorldbook) {
    for (const fragment of fragments) {
      warnings.push(...fragment.warnings);
      if (includeScenarioInWorldbook && fragment.content.trim().length > WORLDBOOK_ENTRY_MAX_CHARS) {
        warnings.push(`情景「${fragment.title}」的世界书条目已截断到 ${WORLDBOOK_ENTRY_MAX_CHARS} 字符；场景正文不受此限制。`);
      }
    }
  }

  const exportExtensions = buildExportExtensions(dataCard, input.exportMeta ?? null, input.exporter ?? null, {
    exportedAt: input.exportedAt,
    includeSourceSnapshot: options.includeSourceSnapshot,
  });
  const sourceSnapshot = {
    included: options.includeSourceSnapshot !== false,
    available: typeof exportExtensions.ms_export.sourceDataJson === 'string',
    truncated: exportExtensions.ms_export.sourceDataTruncated === true,
    maxChars: TAVERN_SOURCE_SNAPSHOT_MAX_CHARS,
  };
  if (sourceSnapshot.truncated) {
    warnings.push(`可选来源诊断快照 sourceDataJson 已截断到 ${TAVERN_SOURCE_SNAPSHOT_MAX_CHARS} 字符，不能用于完整恢复源数据；角色描述未因此截断，请另存完整源 JSON。`);
  } else if (sourceSnapshot.included && !sourceSnapshot.available) {
    warnings.push('来源诊断快照无法序列化，导出卡未包含 sourceDataJson。');
  }

  const talkativeness = Number(fields.talkativeness);
  const card = createTavernV3Card({
    name: fields.name.trim() || '未命名角色',
    description: fields.description,
    personality: fields.personality,
    scenario: finalScenario,
    first_mes: fields.firstMes,
    mes_example: fields.mesExample,
    creator_notes: fields.creatorNotes,
    system_prompt: fields.systemPrompt,
    post_history_instructions: fields.postHistoryInstructions,
    tags: parseTavernExportTags(fields.tags),
    creator: fields.creator,
    extensions: {
      // Zero is a valid value; using `Number(value) || 0.5` silently overwrote it.
      talkativeness: Number.isFinite(talkativeness) ? talkativeness : 0.5,
      fav: Boolean(fields.fav),
      ...exportExtensions,
    },
    character_book: characterBook,
  });

  // Validate the actual wire representation: V3 mirrors several fields at the top
  // level, so checking the source or description size alone undercounts the result.
  // Serialization removes optional undefined properties without changing PNG output.
  // Oversized/unsafe output fails explicitly; roleplay text is never cut to make it fit.
  const serializedCard: unknown = JSON.parse(JSON.stringify(card));
  validateTavernRaw(serializedCard);

  return { card: serializedCard as TavernCardV3, warnings: uniqueStrings(warnings), sourceSnapshot };
}
