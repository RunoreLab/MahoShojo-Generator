import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import {
  advanceSiteMessageCursor,
  createSiteMessage,
  createUserMessage,
  listSiteMessages,
  listUserMessages,
} from '@/lib/db/repositories/messages';

let sqlite: Database;
let db: AppDrizzleDb;

const now = '2026-04-07T10:00:00.000Z';

const exec = (sqlText: string) => sqlite.exec(sqlText);

describe('messages repository', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, email TEXT NOT NULL);
      CREATE TABLE site_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_type TEXT NOT NULL,
        template_key TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        title_text TEXT,
        body_text TEXT,
        action_url TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        expires_at TEXT,
        created_by_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE user_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_user_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        channel TEXT NOT NULL DEFAULT 'system',
        message_type TEXT NOT NULL,
        template_key TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        title_text TEXT,
        body_text TEXT,
        action_url TEXT,
        source_entity_type TEXT,
        source_entity_id TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        read_at TEXT,
        archived_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE user_message_state (
        user_id INTEGER PRIMARY KEY,
        last_read_site_message_id INTEGER NOT NULL DEFAULT 0,
        last_summary_read_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, username, email) VALUES (7, 'hana', 'hana@example.test');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('listSiteMessages excludes expired rows and respects canonical cursor', async () => {
    await createSiteMessage(db, {
      messageType: 'issue',
      templateKey: 'site.issue.update',
      payloadJson: '{}',
      titleText: null,
      bodyText: null,
      actionUrl: null,
      priority: 'normal',
      expiresAt: null,
      createdByUserId: null,
      now: '2026-04-07T09:30:00.000Z',
    });
    await createSiteMessage(db, {
      messageType: 'issue',
      templateKey: 'site.issue.update',
      payloadJson: '{}',
      titleText: null,
      bodyText: null,
      actionUrl: null,
      priority: 'normal',
      expiresAt: '2026-04-07T09:00:00.000Z',
      createdByUserId: null,
      now: '2026-04-07T09:20:00.000Z',
    });

    const rows = await listSiteMessages(db, {
      now,
      limit: 10,
      cursor: { createdAt: '2026-04-07T09:30:00.000Z', scope: 'user', numericId: 99 },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toBe('2026-04-07T09:30:00.000Z');
  });

  test('listUserMessages returns canonical camelCase rows from snake_case columns', async () => {
    await createUserMessage(db, {
      recipientUserId: 7,
      actorUserId: null,
      channel: 'admin',
      messageType: 'moderation',
      templateKey: 'user.moderation.data_card_rejected',
      payloadJson: '{"dataCardName":"雪沫"}',
      titleText: null,
      bodyText: null,
      actionUrl: '/character-manager',
      sourceEntityType: 'data_card',
      sourceEntityId: 'card_1',
      priority: 'high',
      expiresAt: null,
      now,
    });

    const rows = await listUserMessages(db, { userId: 7, now, limit: 10, cursor: null });

    expect(rows[0]).toMatchObject({
      recipientUserId: 7,
      sourceEntityType: 'data_card',
      sourceEntityId: 'card_1',
      priority: 'high',
    });
  });

  test('advanceSiteMessageCursor only moves forward', async () => {
    expect(await advanceSiteMessageCursor(db, { userId: 7, lastReadSiteMessageId: 8, now })).toBe(8);
    expect(await advanceSiteMessageCursor(db, { userId: 7, lastReadSiteMessageId: 3, now })).toBe(8);
  });
});
