import { inferTemplate } from '@/lib/data-card-converter';
import { getBundledPresetData } from '@/lib/pvp/preset-bundled';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';

import type { EnemySnapshotV1 } from '@/lib/challenge/types';

export type ChallengeEnemyDisplayTemplate = 'magical-girl' | 'canshou' | 'general';

export type ChallengeEnemyDisplayState = {
  status: 'idle' | 'loading' | 'resolved' | 'fallback' | 'error';
  template: ChallengeEnemyDisplayTemplate | null;
  card: Record<string, unknown> | null;
  message: string;
  sourceMeta: {
    sourceType: EnemySnapshotV1['sourceType'];
    sourceId: string;
    isFallback: boolean;
  };
};

type ResolveChallengeEnemyDisplayInput = {
  enemySnapshot: EnemySnapshotV1 | null;
  fetchPublicCardById: (id: string) => Promise<unknown | null>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toDisplayStateBase = (
  enemySnapshot: EnemySnapshotV1,
  isFallback: boolean
): ChallengeEnemyDisplayState['sourceMeta'] => ({
  sourceType: enemySnapshot.sourceType,
  sourceId: enemySnapshot.sourceId,
  isFallback,
});

const parseCardPayload = (input: unknown): Record<string, unknown> | null => {
  if (!isRecord(input)) return null;

  const rawData = input.data;
  if (typeof rawData === 'string') {
    try {
      const parsed = JSON.parse(rawData);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  if (isRecord(rawData)) {
    return rawData;
  }

  return input;
};

const pickCharacterTemplate = (card: Record<string, unknown> | null): ChallengeEnemyDisplayTemplate | null => {
  if (!card) return null;
  const template = inferTemplate(card);
  if (template === 'magical-girl' || template === 'canshou' || template === 'general') {
    return template;
  }
  return null;
};

const isRenderableMagicalGirlCardPayload = (card: Record<string, unknown>): boolean =>
  safeString(card.codename).length > 0
  && isRecord(card.appearance)
  && isRecord(card.magicConstruct)
  && isRecord(card.wonderlandRule)
  && isRecord(card.blooming)
  && isRecord(card.analysis);

const isRenderableChallengeTemplateCard = (
  template: ChallengeEnemyDisplayTemplate,
  card: Record<string, unknown>
): boolean => {
  if (template === 'magical-girl') {
    return isRenderableMagicalGirlCardPayload(card);
  }

  return true;
};

const buildCombatProfileSummary = (combatProfile: Record<string, unknown>): string => {
  try {
    const json = JSON.stringify(combatProfile, null, 2);
    if (!json) return '无';
    return json.length > 800 ? `${json.slice(0, 800)}\n...` : json;
  } catch {
    return '无';
  }
};

const getSeasonEntityLookupIds = (sourceId: string): string[] => {
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) return [];

  const ids = [normalizedSourceId];
  const namespacedMatch = /^season:[^:]+:(.+)$/.exec(normalizedSourceId);
  const publicCardId = namespacedMatch?.[1]?.trim();
  if (publicCardId && !ids.includes(publicCardId)) {
    ids.push(publicCardId);
  }

  return ids;
};

export const buildChallengeEnemyFallbackCard = (enemySnapshot: EnemySnapshotV1): Record<string, unknown> => {
  const tags = enemySnapshot.tags.length > 0 ? enemySnapshot.tags.join('、') : '无';
  const combatProfile = isRecord(enemySnapshot.combatProfile) ? enemySnapshot.combatProfile : {};
  const combatProfileSummary = buildCombatProfileSummary(combatProfile);

  return {
    templateId: GENERAL_CHARACTER_TEMPLATE_ID,
    name: enemySnapshot.displayName || '未命名对手',
    content: [
      `# ${enemySnapshot.displayName || '未命名对手'}`,
      '',
      '> 该卡为挑战快照，不代表完整原始数据卡。',
      '',
      '## 对手摘要',
      enemySnapshot.promptSummary || '暂无额外摘要。',
      '',
      '## 快照信息',
      `- 强度档：${enemySnapshot.strengthTier}`,
      `- 标签：${tags}`,
      '',
      '## 战斗参数快照',
      '```json',
      combatProfileSummary,
      '```',
    ].join('\n'),
  };
};

const loadEnemySourceCard = async (
  enemySnapshot: EnemySnapshotV1,
  fetchPublicCardById: ResolveChallengeEnemyDisplayInput['fetchPublicCardById']
): Promise<Record<string, unknown> | null> => {
  if (enemySnapshot.sourceType === 'preset') {
    return parseCardPayload(getBundledPresetData(enemySnapshot.sourceId));
  }

  if (enemySnapshot.sourceType === 'public-card') {
    return parseCardPayload(await fetchPublicCardById(enemySnapshot.sourceId));
  }

  if (enemySnapshot.sourceType === 'season-entity') {
    for (const lookupId of getSeasonEntityLookupIds(enemySnapshot.sourceId)) {
      const payload = parseCardPayload(await fetchPublicCardById(lookupId));
      if (payload) return payload;
    }
  }

  return null;
};

export async function resolveChallengeEnemyDisplay(
  input: ResolveChallengeEnemyDisplayInput
): Promise<ChallengeEnemyDisplayState> {
  const enemySnapshot = input.enemySnapshot;
  if (!enemySnapshot) {
    return {
      status: 'error',
      template: null,
      card: null,
      message: '当前节点没有可展示的敌方快照。',
      sourceMeta: {
        sourceType: 'preset',
        sourceId: '',
        isFallback: false,
      },
    };
  }

  const sourceCard = await loadEnemySourceCard(enemySnapshot, input.fetchPublicCardById);
  const template = pickCharacterTemplate(sourceCard);
  if (sourceCard && template && isRenderableChallengeTemplateCard(template, sourceCard)) {
    return {
      status: 'resolved',
      template,
      card: sourceCard,
      message: `已加载${safeString((sourceCard as Record<string, unknown>).name) || enemySnapshot.displayName}的原始角色卡。`,
      sourceMeta: toDisplayStateBase(enemySnapshot, false),
    };
  }

  return {
    status: 'fallback',
    template: 'general',
    card: buildChallengeEnemyFallbackCard(enemySnapshot),
    message: '未找到可直接展示的完整原卡，已回退为挑战快照。',
    sourceMeta: toDisplayStateBase(enemySnapshot, true),
  };
}
