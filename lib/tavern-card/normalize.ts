import type { TavernCardCandidate, TavernCardNormalized } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const safeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const safeNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
};

const safeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value !== 'boolean') return undefined;
  return value;
};

const safeStringArray = (value: unknown, limit = 200): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    items.push(trimmed);
    if (items.length >= limit) break;
  }
  return items.length > 0 ? items : undefined;
};

const pickRecord = (obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const value = obj[key];
  return isRecord(value) ? value : undefined;
};

export function normalizeTavernCard(candidate: TavernCardCandidate): { normalized: TavernCardNormalized; warnings: string[] } {
  const warnings: string[] = [];
  const root = isRecord(candidate.parsed) ? candidate.parsed : {};
  const data = pickRecord(root, 'data');

  const readString = (key: string): string | undefined => {
    const fromData = data ? safeString(data[key]) : undefined;
    if (fromData !== undefined) return fromData;
    return safeString(root[key]);
  };

  const readTags = (): string[] | undefined => {
    const tags = data ? safeStringArray(data['tags']) : undefined;
    if (tags) return tags;
    return safeStringArray(root['tags']);
  };

  const spec = safeString(root['spec']);
  const specVersion = safeString(root['spec_version']) ?? safeString(root['specVersion']);

  const name = readString('name') ?? '未命名角色';
  if (!readString('name')) warnings.push('未能读取到 name，已使用占位名称。');

  const creatorNotes = safeString(data?.['creator_notes']) ?? safeString(root['creatorcomment']) ?? safeString(root['creatorComment']);

  const extensions = (data && isRecord(data['extensions'])) ? (data['extensions'] as Record<string, unknown>) : undefined;
  const talkativeness = safeNumber(extensions?.['talkativeness']) ?? safeNumber(root['talkativeness']);
  const fav = safeBoolean(extensions?.['fav']) ?? safeBoolean(root['fav']);

  const normalized: TavernCardNormalized = {
    spec,
    specVersion,
    sourceChunk: candidate.keyword,
    name,
    description: readString('description'),
    personality: readString('personality'),
    scenario: readString('scenario'),
    firstMes: readString('first_mes') ?? readString('firstMes'),
    mesExample: readString('mes_example') ?? readString('mesExample'),
    tags: readTags(),
    avatar: readString('avatar'),
    creator: safeString(data?.['creator']) ?? safeString(root['creator']),
    characterVersion: safeString(data?.['character_version']) ?? safeString(root['character_version']) ?? safeString(root['characterVersion']),
    createDate: safeString(data?.['create_date']) ?? safeString(root['create_date']) ?? safeString(root['createDate']),
    talkativeness,
    fav,
    creatorComment: safeString(root['creatorcomment']) ?? safeString(root['creatorComment']),
    creatorNotes,
    systemPrompt: safeString(data?.['system_prompt']) ?? safeString(root['system_prompt']) ?? safeString(root['systemPrompt']),
    postHistoryInstructions:
      safeString(data?.['post_history_instructions']) ??
      safeString(root['post_history_instructions']) ??
      safeString(root['postHistoryInstructions']),
    alternateGreetings: safeStringArray(data?.['alternate_greetings']) ?? safeStringArray(root['alternate_greetings']),
    groupOnlyGreetings: safeStringArray(data?.['group_only_greetings']) ?? safeStringArray(root['group_only_greetings']),
    extensions,
    characterBook: data?.['character_book'] ?? root['character_book'],
  };

  if (candidate.keyword === 'chara' && spec) {
    warnings.push('检测到 keyword=chara 的角色卡块，建议优先使用 ccv3（如存在）。');
  }

  return { normalized, warnings };
}

export function isLikelyTavernCard(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const root = value;
  const data = pickRecord(root, 'data');
  const name = safeString(data?.['name']) ?? safeString(root['name']);
  if (!name) return false;
  if (safeString(root['spec']) && (safeString(root['spec_version']) || safeString(root['specVersion']))) return true;
  if (safeString(root['description']) || safeString(root['personality']) || safeString(root['scenario'])) return true;
  if (data && (safeString(data['description']) || safeString(data['personality']) || safeString(data['scenario']))) return true;
  return false;
}

