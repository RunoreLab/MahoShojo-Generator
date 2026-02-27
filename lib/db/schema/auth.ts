import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from '@/lib/db/schema/business';

const unixEpochNow = sql`(unixepoch())`;

/**
 * Better Auth 用户域（并行子域）
 * - 表名前缀 ba_，避免与既有 users 冲突
 * - 通过 user_auth_links 与业务 users 关联
 */
export const baUsers = sqliteTable(
  'ba_user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: integer('created_at').notNull().default(unixEpochNow),
    updatedAt: integer('updated_at').notNull().default(unixEpochNow),
  },
  (table) => ({
    emailUnique: uniqueIndex('ba_user_email_unique').on(table.email),
  }),
);

export const baSessions = sqliteTable(
  'ba_session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at').notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => baUsers.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(unixEpochNow),
    updatedAt: integer('updated_at').notNull().default(unixEpochNow),
  },
  (table) => ({
    tokenUnique: uniqueIndex('ba_session_token_unique').on(table.token),
  }),
);

export const baAccounts = sqliteTable('ba_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => baUsers.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at'),
  refreshTokenExpiresAt: integer('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at').notNull().default(unixEpochNow),
  updatedAt: integer('updated_at').notNull().default(unixEpochNow),
});

export const baVerifications = sqliteTable('ba_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull().default(unixEpochNow),
  updatedAt: integer('updated_at').notNull().default(unixEpochNow),
});

export const userAuthLinks = sqliteTable(
  'user_auth_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    authUserId: text('auth_user_id')
      .notNull()
      .references(() => baUsers.id, { onDelete: 'cascade' }),
    businessUserId: integer('business_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(unixEpochNow),
    updatedAt: integer('updated_at').notNull().default(unixEpochNow),
  },
  (table) => ({
    authUserIdUnique: uniqueIndex('user_auth_links_auth_user_id_unique').on(table.authUserId),
    businessUserIdUnique: uniqueIndex('user_auth_links_business_user_id_unique').on(table.businessUserId),
  }),
);

export const authPasswordResetTokens = sqliteTable(
  'auth_password_reset_tokens',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
    requestedIp: text('requested_ip'),
    requestedUserAgent: text('requested_user_agent'),
    createdAt: integer('created_at').notNull().default(unixEpochNow),
    updatedAt: integer('updated_at').notNull().default(unixEpochNow),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('auth_password_reset_tokens_token_hash_unique').on(table.tokenHash),
    userIdExpiresAtIndex: index('auth_password_reset_tokens_user_id_expires_at_idx').on(table.userId, table.expiresAt),
    expiresAtIndex: index('auth_password_reset_tokens_expires_at_idx').on(table.expiresAt),
  }),
);

export const authAuditLogs = sqliteTable(
  'auth_audit_logs',
  {
    id: text('id').primaryKey(),
    businessUserId: integer('business_user_id').references(() => users.id, { onDelete: 'set null' }),
    authUserId: text('auth_user_id').references(() => baUsers.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    authSource: text('auth_source').notNull(),
    identifierType: text('identifier_type'),
    ip: text('ip'),
    ipAnonymized: text('ip_anonymized'),
    userAgent: text('user_agent'),
    resultCode: text('result_code').notNull(),
    resultMessage: text('result_message'),
    metadataJson: text('metadata_json'),
    createdAt: integer('created_at').notNull().default(unixEpochNow),
  },
  (table) => ({
    createdAtIndex: index('idx_auth_audit_logs_created_at').on(table.createdAt),
    eventTypeCreatedAtIndex: index('idx_auth_audit_logs_event_type_created_at').on(table.eventType, table.createdAt),
    businessUserCreatedAtIndex: index('idx_auth_audit_logs_business_user_id_created_at').on(
      table.businessUserId,
      table.createdAt,
    ),
    authUserCreatedAtIndex: index('idx_auth_audit_logs_auth_user_id_created_at').on(table.authUserId, table.createdAt),
    ipAnonymizedCreatedAtIndex: index('idx_auth_audit_logs_ip_anonymized_created_at').on(
      table.ipAnonymized,
      table.createdAt,
    ),
  }),
);
