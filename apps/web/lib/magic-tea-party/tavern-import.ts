import { createBlankDataCard } from '@/lib/data-card-converter';
import { getUtf8ByteLength } from '@/lib/data-card-size';
import type { GeneralCharacterData } from '@/lib/schemas';
import { isLikelyTavernCard, normalizeTavernCard } from '@/lib/tavern-card/normalize';
import type { TavernCardCandidate, TavernCardNormalized } from '@/lib/tavern-card/types';

const TRUNCATE_SUFFIX = '\n...[已截断]';

// 参考 docs/temp 的数据卡体量，并为魔法茶会保留上下文空间。
export const MAGIC_TEA_PARTY_TAVERN_ROLE_MAX_BYTES = 80 * 1024;

type TavernSection = {
  key: string;
  title: string;
  content: string;
  priority: number;
};

const DROP_ORDER: string[] = [
  'worldbook',
  'tags',
  'group_only_greetings',
  'alternate_greetings',
  'scenario',
  'creator_notes',
  'post_history_instructions',
  'system_prompt',
  'first_mes',
  'mes_example',
  'personality',
  'description',
];

const dropPriorityOf = (key: string): number => {
  const index = DROP_ORDER.indexOf(key);
  return index >= 0 ? index : DROP_ORDER.length;
};

const safeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const safeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const buildListBlock = (items: string[], prefix: string = '- '): string => {
  if (items.length === 0) return '';
  return items.map((item) => `${prefix}${item}`).join('\n');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const buildWorldbookText = (value: unknown): string => {
  if (!isRecord(value)) return '';
  const name = safeString(value.name);
  const entries = Array.isArray(value.entries) ? value.entries : [];
  if (!name && entries.length === 0) return '';
  const lines: string[] = [];
  lines.push(`【世界书】${name || '未命名世界书'}`.trim());
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const content = safeString(entry.content);
    if (!content) continue;
    const comment = safeString(entry.comment) || '条目';
    lines.push(`- ${comment}`);
    lines.push(content);
  }
  return lines.join('\n');
};

const buildSections = (normalized: TavernCardNormalized): TavernSection[] => {
  const sections: TavernSection[] = [];

  const description = safeString(normalized.description);
  if (description) {
    sections.push({ key: 'description', title: '描述', content: description, priority: dropPriorityOf('description') });
  }

  const personality = safeString(normalized.personality);
  if (personality) {
    sections.push({ key: 'personality', title: '性格', content: personality, priority: dropPriorityOf('personality') });
  }

  const mesExample = safeString(normalized.mesExample);
  if (mesExample) {
    sections.push({ key: 'mes_example', title: '对话样例', content: mesExample, priority: dropPriorityOf('mes_example') });
  }

  const firstMes = safeString(normalized.firstMes);
  if (firstMes) {
    sections.push({ key: 'first_mes', title: '开场白', content: firstMes, priority: dropPriorityOf('first_mes') });
  }

  const systemPrompt = safeString(normalized.systemPrompt);
  if (systemPrompt) {
    sections.push({ key: 'system_prompt', title: '系统提示', content: systemPrompt, priority: dropPriorityOf('system_prompt') });
  }

  const postHistory = safeString(normalized.postHistoryInstructions);
  if (postHistory) {
    sections.push({
      key: 'post_history_instructions',
      title: '历史后指令',
      content: postHistory,
      priority: dropPriorityOf('post_history_instructions'),
    });
  }

  const creatorNotes = safeString(normalized.creatorNotes);
  if (creatorNotes) {
    sections.push({ key: 'creator_notes', title: '创作备注', content: creatorNotes, priority: dropPriorityOf('creator_notes') });
  }

  const alternateGreetings = safeStringArray(normalized.alternateGreetings);
  if (alternateGreetings.length > 0) {
    sections.push({
      key: 'alternate_greetings',
      title: '候选开场白',
      content: buildListBlock(alternateGreetings),
      priority: dropPriorityOf('alternate_greetings'),
    });
  }

  const groupOnlyGreetings = safeStringArray(normalized.groupOnlyGreetings);
  if (groupOnlyGreetings.length > 0) {
    sections.push({
      key: 'group_only_greetings',
      title: '群聊开场白',
      content: buildListBlock(groupOnlyGreetings),
      priority: dropPriorityOf('group_only_greetings'),
    });
  }

  const scenario = safeString(normalized.scenario);
  if (scenario) {
    sections.push({ key: 'scenario', title: '情景', content: scenario, priority: dropPriorityOf('scenario') });
  }

  const tags = safeStringArray(normalized.tags);
  if (tags.length > 0) {
    sections.push({ key: 'tags', title: '标签', content: tags.join('、'), priority: dropPriorityOf('tags') });
  }

  const worldbook = buildWorldbookText(normalized.characterBook);
  if (worldbook) {
    sections.push({ key: 'worldbook', title: '世界书', content: worldbook, priority: dropPriorityOf('worldbook') });
  }

  return sections;
};

const buildContent = (name: string, sections: TavernSection[]): string => {
  const lines: string[] = [];
  lines.push(`# 角色：${name}`.trim());
  for (const section of sections) {
    lines.push('');
    lines.push(`## ${section.title}`);
    lines.push(section.content);
  }
  return lines.join('\n');
};

const truncateToBytes = (value: string, maxBytes: number): string => {
  if (maxBytes <= 0) return '';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) return value;
  const sliced = bytes.slice(0, maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(sliced);
};

const truncateSectionToFit = (params: {
  name: string;
  sections: TavernSection[];
  targetKey: string;
  maxBytes: number;
}): { content?: string; removed: boolean } => {
  const target = params.sections.find((section) => section.key === params.targetKey);
  if (!target) return { removed: false };

  const original = target.content;
  if (!original) return { removed: true };

  const buildWith = (content: string): string =>
    buildContent(
      params.name,
      params.sections.map((section) => (section.key === params.targetKey ? { ...section, content } : section))
    );

  let low = 0;
  let high = original.length;
  let best = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = mid >= original.length ? original : `${original.slice(0, mid)}${TRUNCATE_SUFFIX}`;
    const candidateBytes = getUtf8ByteLength(buildWith(candidate));
    if (candidateBytes <= params.maxBytes) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (best <= 0) return { removed: true };
  const content = best >= original.length ? original : `${original.slice(0, best)}${TRUNCATE_SUFFIX}`;
  return { content, removed: false };
};

const applySizeLimit = (name: string, sections: TavernSection[], maxBytes: number) => {
  let active = sections.filter((section) => section.content.trim());
  const droppedFields: string[] = [];
  const truncatedFields: string[] = [];

  let content = buildContent(name, active);
  let contentBytes = getUtf8ByteLength(content);

  if (contentBytes <= maxBytes) {
    return { content, droppedFields, truncatedFields };
  }

  const dropTargets = [...active].sort((a, b) => a.priority - b.priority);
  for (const section of dropTargets) {
    if (contentBytes <= maxBytes) break;
    active = active.filter((item) => item.key !== section.key);
    droppedFields.push(section.key);
    content = buildContent(name, active);
    contentBytes = getUtf8ByteLength(content);
  }

  if (contentBytes <= maxBytes) {
    return { content, droppedFields, truncatedFields };
  }

  const truncateTargets = [...active].sort((a, b) => a.priority - b.priority);
  for (const section of truncateTargets) {
    if (contentBytes <= maxBytes) break;
    const result = truncateSectionToFit({ name, sections: active, targetKey: section.key, maxBytes });
    if (result.removed) {
      active = active.filter((item) => item.key !== section.key);
      if (!droppedFields.includes(section.key)) droppedFields.push(section.key);
    } else if (typeof result.content === 'string') {
      active = active.map((item) => (item.key === section.key ? { ...item, content: result.content as string } : item));
      if (!truncatedFields.includes(section.key)) truncatedFields.push(section.key);
    }
    content = buildContent(name, active);
    contentBytes = getUtf8ByteLength(content);
  }

  if (contentBytes > maxBytes) {
    const suffixBytes = getUtf8ByteLength(TRUNCATE_SUFFIX);
    const budget = Math.max(0, maxBytes - suffixBytes);
    content = `${truncateToBytes(content, budget)}${TRUNCATE_SUFFIX}`;
    truncatedFields.push('content');
  }

  return { content, droppedFields, truncatedFields };
};

export const isTavernCardPayload = (payload: unknown): payload is Record<string, unknown> => isLikelyTavernCard(payload);

export const normalizeTavernCardPayload = (payload: Record<string, unknown>): TavernCardNormalized => {
  const candidate: TavernCardCandidate = {
    keyword: 'json',
    chunkType: 'tEXt',
    parseMethod: 'json',
    parsed: payload,
  };
  return normalizeTavernCard(candidate).normalized;
};

export const buildMagicTeaPartyRoleCardFromTavern = (
  normalized: TavernCardNormalized,
  options?: { maxBytes?: number }
): { card: GeneralCharacterData; droppedFields: string[]; truncatedFields: string[] } => {
  const base = createBlankDataCard('general') as GeneralCharacterData;
  const name = safeString(normalized.name) || base.name || '角色';
  const maxBytes = options?.maxBytes ?? MAGIC_TEA_PARTY_TAVERN_ROLE_MAX_BYTES;
  const sections = buildSections(normalized);
  const result = applySizeLimit(name, sections, maxBytes);
  return {
    card: {
      ...base,
      name,
      content: result.content,
    },
    droppedFields: result.droppedFields,
    truncatedFields: result.truncatedFields,
  };
};
