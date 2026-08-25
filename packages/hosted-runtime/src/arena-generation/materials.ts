export const MAX_ARENA_MATERIALS = 10;

export type NodeArenaMaterial = {
  id: string;
  name: string;
  content: unknown;
  fileName: string | null;
  sourceDataCardId?: string;
  sourceDataCardUpdatedAt?: string;
  sourceKind: 'wantu-card' | 'mahoshojo-data-card' | 'raw-json';
  sourceType: string;
  isNative: boolean;
};

const TRANSPORT_META_KEYS = new Set([
  '_cardId', '_cardName', '_cardDescription', '_cardType', '_isPublic', '_updatedAt',
  '_createdAt', '_author', '_authorName', '_likeCount', '_favoriteCount', '_usageCount',
]);

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const clone = (value: unknown): unknown => {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
};

const stripTransportMeta = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripTransportMeta);
  const record = recordOf(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).flatMap(([key, child]) => (
    TRANSPORT_META_KEYS.has(key) ? [] : [[key, stripTransportMeta(child)]]
  )));
};

const inferSourceType = (source: Record<string, unknown>): string => (
  text(source._cardType)
  || text(source.type)
  || text(source.templateId)
  || text(source.template_id)
  || text(source.template)
  || (Array.isArray(source.questions) && text(source.kind) ? 'questionnaire' : '')
  || (text(source.title) && (source.elements || source.scenario_type || source.content)
    ? 'scenario'
    : '')
  || (text(source.codename) || text(source.name) ? 'character' : '')
  || 'raw-json'
);

const wantuDataCardContent = (source: Record<string, unknown>): Record<string, unknown> | null => {
  if (source.format !== 'wantu-data-card') return null;
  const card = recordOf(source.card);
  const domains = recordOf(card?.domains);
  if (!card || !domains || !text(card.name)) return null;
  const content = Object.fromEntries(Object.entries(domains).flatMap(([key, raw]) => {
    const domain = recordOf(raw);
    if (!domain) return [];
    if (domain.kind === 'stream-markdown' && typeof domain.value === 'string') {
      return [[key, domain.value]];
    }
    if (domain.kind === 'structured-json') return [[key, clone(domain.value)]];
    if (domain.kind === 'image') {
      const image = recordOf(domain.value);
      return image ? [[key, { assetId: image.assetId, fileName: image.fileName }]] : [];
    }
    return [];
  }));
  if (Array.isArray(source.assets)) content._assetCount = source.assets.length;
  return content;
};

const normalizeOne = (value: unknown, index: number): NodeArenaMaterial | null => {
  const source = recordOf(value);
  if (!source) {
    return {
      id: `material-${index + 1}`,
      name: '未命名素材',
      content: clone(value),
      fileName: null,
      sourceKind: 'raw-json',
      sourceType: 'raw-json',
      isNative: false,
    };
  }
  const materialLike = Object.prototype.hasOwnProperty.call(source, 'content')
    && text(source.name)
    && text(source.sourceKind);
  if (materialLike) {
    const sourceKind = ['wantu-card', 'mahoshojo-data-card', 'raw-json'].includes(text(source.sourceKind))
      ? text(source.sourceKind) as NodeArenaMaterial['sourceKind']
      : 'raw-json';
    return {
      id: text(source.id) || `material-${index + 1}`,
      name: text(source.name),
      content: clone(stripTransportMeta(source.content)),
      fileName: text(source.fileName) || null,
      ...(text(source.sourceDataCardId) ? { sourceDataCardId: text(source.sourceDataCardId) } : {}),
      ...(text(source.sourceDataCardUpdatedAt)
        ? { sourceDataCardUpdatedAt: text(source.sourceDataCardUpdatedAt) }
        : {}),
      sourceKind,
      sourceType: text(source.sourceType) || sourceKind,
      isNative: source.isNative === true,
    };
  }

  const wantuContent = wantuDataCardContent(source);
  if (wantuContent) {
    const card = recordOf(source.card)!;
    return {
      id: text(source._cardId) || text(source.id) || `material-${index + 1}`,
      name: text(source._cardName) || text(card.name),
      content: wantuContent,
      fileName: null,
      ...(text(source._cardId) ? { sourceDataCardId: text(source._cardId) } : {}),
      ...(text(source._updatedAt) ? { sourceDataCardUpdatedAt: text(source._updatedAt) } : {}),
      sourceKind: 'mahoshojo-data-card',
      sourceType: 'wantu-data-card',
      isNative: false,
    };
  }

  if (text(source.cardKind) && text(source.name) && typeof source.content === 'string') {
    return {
      id: text(source._cardId) || text(source.id) || `material-${index + 1}`,
      name: text(source._cardName) || text(source.name),
      content: clone(source),
      fileName: null,
      ...(text(source._cardId) ? { sourceDataCardId: text(source._cardId) } : {}),
      ...(text(source._updatedAt) ? { sourceDataCardUpdatedAt: text(source._updatedAt) } : {}),
      sourceKind: 'wantu-card',
      sourceType: text(source.cardKind),
      isNative: false,
    };
  }

  const sourceType = inferSourceType(source);
  const sourceDataCardId = text(source._cardId) || text(source.sourceDataCardId);
  const sourceDataCardUpdatedAt = text(source._updatedAt) || text(source.sourceDataCardUpdatedAt);
  return {
    id: text(source.id) || sourceDataCardId || `material-${index + 1}`,
    name: text(source._cardName) || text(source.name) || text(source.title)
      || text(source.codename) || '未命名素材',
    content: clone(stripTransportMeta(source)),
    fileName: null,
    ...(sourceDataCardId ? { sourceDataCardId } : {}),
    ...(sourceDataCardUpdatedAt ? { sourceDataCardUpdatedAt } : {}),
    sourceKind: sourceDataCardId || sourceType !== 'raw-json'
      ? 'mahoshojo-data-card'
      : 'raw-json',
    sourceType,
    isNative: false,
  };
};

export const normalizeNodeArenaMaterials = (raw: unknown): NodeArenaMaterial[] => (
  Array.isArray(raw)
    ? raw.flatMap((value, index) => normalizeOne(value, index) ?? [])
    : []
);
