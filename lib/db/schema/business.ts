import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
