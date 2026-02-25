import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type DataCardType = 'character' | 'scenario' | 'history' | 'questionnaire';
export type DataCardReviewStatus = 'pending' | 'approved' | 'rejected';
export type ArenaRatingEntityType = 'data_card' | 'preset';
export type ArenaRatingQueue = 'strict' | 'free';

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
  reviewStatus: text('review_status').$type<DataCardReviewStatus | null>(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
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
