import { and, count, desc, eq, exists, gte, inArray, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { DataCardSummarySchema, type DataCardSummaryQuery } from '@mahoshojo/contracts/data-cards';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCards, dataCardUpdates, dataCardMetrics, dataCardTags, favorites, users } from '@/lib/db/schema';

// 仅提取类型提示，正文不离开数据库；损坏的历史 JSON 不应拖垮整个列表。
const payload = sql`CASE WHEN json_valid(${dataCards.data}) THEN ${dataCards.data} ELSE '{}' END`;
const field = (name: string) => sql`json_extract(${payload}, ${`$.${name}`})`;
const fieldType = (name: string) => sql`json_type(${payload}, ${`$.${name}`})`;
const roleType = sql<string | null>`CASE
  WHEN ${dataCards.type} <> 'character' THEN NULL
  WHEN ${field('templateId')} = '通用角色' THEN 'general'
  WHEN ${field('templateId')} IN ('魔法少女/心之花/魔法少女（问卷生成）', '魔法少女/心之花/魔法少女（名字生成）', '魔法少女/心之花/未知') THEN 'magical-girl'
  WHEN ${field('templateId')} = '魔法少女/心之花/残兽（问卷生成）' THEN 'canshou'
  WHEN ${fieldType('content')} = 'text' THEN 'general'
  WHEN ${fieldType('codename')} = 'text' OR ${or(...['magicConstruct', 'wonderlandRule', 'blooming', 'analysis'].map((key) => sql`${fieldType(key)} IS NOT NULL`))} THEN 'magical-girl'
  WHEN ${fieldType('name')} = 'text' AND ${or(...['materialAndSkin', 'featuresAndAppendages', 'coreConcept', 'coreEmotion', 'evolutionStage', 'attackMethod', 'specialAbility', 'origin', 'birthEnvironment', 'researcherNotes', 'appearance'].map((key) => sql`${fieldType(key)} IS NOT NULL`))} THEN 'canshou'
  ELSE 'general' END`;
const nativeAllowed = sql<boolean>`(${fieldType('nativeAllowed')} = 'true' OR (${fieldType('nativeAllowed')} IS NULL AND ${fieldType('native_allowed')} = 'true'))`;
// 旧误标问卷保留发现入口；真正恢复类型仍由现有修复接口执行完整 schema 验证。
const legacyQuestionnaire = sql<boolean>`(${dataCards.type} = 'character'
  AND ${field('kind')} IN ('magical-girl', 'canshou') AND ${fieldType('title')} = 'text'
  AND ${fieldType('questions')} = 'array'
  AND (json_array_length(${payload}, '$.questions') > 0 OR length(trim(${field('loreMarkdown')})) > 0))`;

export async function listDataCardSummaries(db: AppDrizzleDb, userId: number, source: 'my' | 'favorites', query: DataCardSummaryQuery) {
  const conditions: SQL[] = [isNull(dataCards.deletedAt)];
  if (source === 'my') conditions.push(eq(dataCards.userId, userId));
  else conditions.push(eq(favorites.userId, userId), eq(dataCards.isPublic, true), eq(dataCards.reviewStatus, 'approved'));
  if (query.types?.length) conditions.push(query.includeLegacyQuestionnaires && query.types.includes('questionnaire')
    ? or(inArray(dataCards.type, query.types), legacyQuestionnaire)! : inArray(dataCards.type, query.types));
  if (query.visibility) conditions.push(sql`CAST(${dataCards.isPublic} AS INTEGER) = ${{ private: 0, public: 1, banned: -1 }[query.visibility]}`);
  if (query.roleType) conditions.push(eq(roleType, query.roleType));
  if (query.search) {
    const keyword = `%${query.search}%`;
    conditions.push(or(like(dataCards.name, keyword), like(dataCards.description, keyword), like(dataCards.id, keyword))!);
  }
  if (query.author) conditions.push(like(users.username, `%${query.author}%`));
  for (const [column, min, max] of [
    [dataCards.likeCount, query.minLikes, query.maxLikes],
    [dataCards.usageCount, query.minUsage, query.maxUsage],
    [dataCards.favoriteCount, query.minFavorites, query.maxFavorites],
  ] as const) {
    if (min !== undefined) conditions.push(gte(column, min));
    if (max !== undefined) conditions.push(lte(column, max));
  }
  if (query.nativeOnly) conditions.push(eq(dataCardMetrics.isNative, true));
  if (query.nativeAllowedOnly) conditions.push(sql`${nativeAllowed}`);
  if (query.recommendedOnly) conditions.push(eq(dataCards.isRecommended, true));
  if (query.tagIds?.length) {
    const hasTags = (ids: string[]) => exists(db.select({ id: dataCardTags.tagId }).from(dataCardTags)
      .where(and(eq(dataCardTags.dataCardId, dataCards.id), inArray(dataCardTags.tagId, ids))));
    conditions.push(query.tagMatch === 'all' ? and(...query.tagIds.map((id) => hasTags([id])))! : hasTags(query.tagIds));
  }
  const updated = sql`COALESCE(${dataCards.updatedAt}, ${dataCards.createdAt})`;
  const sortColumn = {
    updated_at: updated, created_at: sql`COALESCE(${dataCards.createdAt}, ${dataCards.updatedAt})`,
    likes: dataCards.likeCount, usage: dataCards.usageCount, favorites: dataCards.favoriteCount,
    favorited_at: favorites.createdAt,
  }[query.sortBy];
  const from = <T extends ReturnType<AppDrizzleDb['select']>>(select: T) => select.from(dataCards)
    .innerJoin(users, eq(users.id, dataCards.userId))
    .leftJoin(dataCardUpdates, eq(dataCardUpdates.dataCardId, dataCards.id))
    .leftJoin(dataCardMetrics, eq(dataCardMetrics.dataCardId, dataCards.id))
    .leftJoin(favorites, and(eq(favorites.dataCardId, dataCards.id), eq(favorites.userId, userId)))
    .where(and(...conditions));
  const [totals, rows] = await Promise.all([
    from(db.select({ total: count(),
      private: sql<number>`COALESCE(SUM(CASE WHEN CAST(${dataCards.isPublic} AS INTEGER) = 0 THEN 1 ELSE 0 END), 0)`,
      public: sql<number>`COALESCE(SUM(CASE WHEN CAST(${dataCards.isPublic} AS INTEGER) = 1 THEN 1 ELSE 0 END), 0)`,
      pending: sql<number>`COALESCE(SUM(CASE WHEN ${dataCards.reviewStatus} = 'pending' THEN 1 ELSE 0 END), 0)`,
    })),
    from(db.select({
      id: dataCards.id, user_id: dataCards.userId, type: dataCards.type, name: dataCards.name,
      description: dataCards.description, is_public: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      review_status: dataCards.reviewStatus, created_at: dataCards.createdAt, updated_at: dataCards.updatedAt,
      usage_count: dataCards.usageCount, like_count: dataCards.likeCount, favorite_count: dataCards.favoriteCount,
      is_recommended: sql<number>`CAST(${dataCards.isRecommended} AS INTEGER)`, username: users.username,
      roleType, nativeAllowed, has_pending_update: source === 'my' ? sql<boolean>`${dataCardUpdates.data} IS NOT NULL` : sql<boolean>`0`,
      tag_ids: sql<string | null>`(SELECT group_concat(DISTINCT tag_id) FROM data_card_tags WHERE data_card_id = ${dataCards.id})`,
      favorited_at: favorites.createdAt,
      isLegacyQuestionnaire: query.includeLegacyQuestionnaires ? legacyQuestionnaire : sql<boolean>`0`,
    })).orderBy(desc(sortColumn), desc(updated), desc(dataCards.id)).limit(query.limit).offset(query.offset),
  ]);
  const total = Number(totals[0]?.total ?? 0);
  const cards = rows.map((row) => DataCardSummarySchema.parse({
    ...row, nativeAllowed: Boolean(row.nativeAllowed), has_pending_update: Boolean(row.has_pending_update),
    type: row.isLegacyQuestionnaire ? 'questionnaire' : row.type,
    isLegacyQuestionnaire: Boolean(row.isLegacyQuestionnaire),
    is_recommended: Number(row.is_recommended ?? 0),
    usage_count: Number(row.usage_count ?? 0), like_count: Number(row.like_count ?? 0), favorite_count: Number(row.favorite_count ?? 0),
    tag_ids: row.tag_ids ? String(row.tag_ids).split(',') : [],
  }));
  return { success: true as const, cards, total,
    stats: { private: Number(totals[0]?.private ?? 0), public: Number(totals[0]?.public ?? 0), pending: Number(totals[0]?.pending ?? 0) },
    nextOffset: query.offset + cards.length < total ? query.offset + cards.length : null };
}
