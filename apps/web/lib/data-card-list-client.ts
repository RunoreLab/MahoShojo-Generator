import { DataCardSummaryPageSchema, type DataCardSummaryQueryInput } from '@mahoshojo/contracts/data-cards';
import { fetchDataCardJson } from '@/lib/auth';
import { normalizeQuestionnaireDataCard } from '@/lib/questionnaire-data-card';

export async function getDataCardSummaryPage(source: 'my' | 'favorites', query: DataCardSummaryQueryInput, signal?: AbortSignal) {
  const params = new URLSearchParams({ view: 'summary' });
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && (!Array.isArray(value) || value.length)) {
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }
  return DataCardSummaryPageSchema.parse(await fetchDataCardJson(
    `${source === 'my' ? '/api/data-cards' : '/api/favorites'}?${params}`, signal,
  ));
}

export async function loadFullDataCard(card: any, source: 'my' | 'public' | 'favorites', signal?: AbortSignal): Promise<any> {
  if (typeof card.data === 'string') return card;
  const path = source === 'my' ? '/api/data-cards' : '/api/public-data-cards';
  const result = await fetchDataCardJson(`${path}?id=${encodeURIComponent(card.id)}`, signal);
  if (!result.success || !result.card || typeof result.card.data !== 'string') {
    throw new Error(result.error || '数据卡不存在或无权访问');
  }
  const full = { ...card, ...result.card };
  if (card.isLegacyQuestionnaire) {
    const normalized = normalizeQuestionnaireDataCard(full);
    if (!normalized) throw new Error('该旧卡内容不是有效的问卷，请在角色管理中检查原卡');
    return normalized;
  }
  return full;
}
