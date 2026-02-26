import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type DataCardType = 'character' | 'scenario' | 'history' | 'questionnaire';
export type DataCardReviewStatus = 'pending' | 'approved' | 'rejected';
export type ArenaRatingEntityType = 'data_card' | 'preset';
export type ArenaRatingQueue = 'strict' | 'free';
export type ArenaRatingEventStatus = 'pending' | 'applied' | 'skipped' | 'failed';

/**
 * 业务主用户表（映射现有 users）
 * 注意：阶段 A 仅声明迁移所需核心字段，避免一次性覆盖所有历史列。
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  email: text('email').notNull(),
  authKey: text('auth_key'),
  prefix: text('prefix'),
  isBanned: text('is_banned'),
  isAdmin: integer('is_admin', { mode: 'boolean' }),
  isReviewExempt: integer('is_review_exempt', { mode: 'boolean' }),
});

export const dataCards = sqliteTable('data_cards', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  type: text('type').$type<DataCardType>().notNull(),
  name: text('name').notNull(),
  description: text('description'),
  data: text('data').notNull(),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull(),
  publicSince: text('public_since'),
  usageCount: integer('usage_count'),
  likeCount: integer('like_count'),
  favoriteCount: integer('favorite_count'),
  reviewStatus: text('review_status').$type<DataCardReviewStatus | null>(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
});

export const dataCardUpdates = sqliteTable('data_card_updates', {
  id: text('id').primaryKey(),
  dataCardId: text('data_card_id').notNull(),
  userId: integer('user_id').notNull(),
  name: text('name'),
  description: text('description'),
  data: text('data'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

export const dataCardMetrics = sqliteTable('data_card_metrics', {
  dataCardId: text('data_card_id').primaryKey(),
  techScore: integer('tech_score').notNull(),
  techLevel: text('tech_level').notNull(),
  isNative: integer('is_native', { mode: 'boolean' }),
  dataCardUpdatedAt: text('data_card_updated_at').notNull(),
  detailsJson: text('details_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const dataCardTags = sqliteTable('data_card_tags', {
  dataCardId: text('data_card_id').notNull(),
  tagId: text('tag_id').notNull(),
  createdByUserId: integer('created_by_user_id'),
  createdAt: text('created_at').notNull(),
});

export const arenaRatings = sqliteTable('arena_ratings', {
  entityType: text('entity_type').$type<ArenaRatingEntityType>().notNull(),
  entityId: text('entity_id').notNull(),
  queue: text('queue').$type<ArenaRatingQueue>().notNull(),
  rating: integer('rating').notNull(),
  games: integer('games').notNull(),
  wins: integer('wins').notNull(),
  losses: integer('losses').notNull(),
  draws: integer('draws').notNull(),
  lastDelta: integer('last_delta'),
  lastAppliedAt: text('last_applied_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const arenaRatingEvents = sqliteTable('arena_rating_events', {
  id: text('id').primaryKey(),
  generationId: text('generation_id').notNull(),
  queue: text('queue').$type<ArenaRatingQueue>().notNull(),
  status: text('status').$type<ArenaRatingEventStatus>().notNull(),
  skipReason: text('skip_reason'),
  userId: integer('user_id'),
  ipAnonymized: text('ip_anonymized'),
  pairKey: text('pair_key').notNull(),
  aEntityType: text('a_entity_type').$type<ArenaRatingEntityType>().notNull(),
  aEntityId: text('a_entity_id').notNull(),
  bEntityType: text('b_entity_type').$type<ArenaRatingEntityType>().notNull(),
  bEntityId: text('b_entity_id').notNull(),
  winnerSlot: integer('winner_slot').notNull(),
  aBeforeRating: integer('a_before_rating'),
  aAfterRating: integer('a_after_rating'),
  aDelta: integer('a_delta'),
  aBeforeGames: integer('a_before_games'),
  aAfterGames: integer('a_after_games'),
  bBeforeRating: integer('b_before_rating'),
  bAfterRating: integer('b_after_rating'),
  bDelta: integer('b_delta'),
  bBeforeGames: integer('b_before_games'),
  bAfterGames: integer('b_after_games'),
  detailsJson: text('details_json'),
  createdAt: text('created_at').notNull(),
  appliedAt: text('applied_at'),
});

export const characters = sqliteTable('characters', {
  name: text('name').primaryKey(),
  isPreset: integer('is_preset', { mode: 'boolean' }).notNull(),
  wins: integer('wins').notNull(),
  losses: integer('losses').notNull(),
  participations: integer('participations').notNull(),
});

export const battles = sqliteTable('battles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  winnerName: text('winner_name').notNull(),
  participantsJson: text('participants_json').notNull(),
  createdAt: text('created_at').notNull(),
});
