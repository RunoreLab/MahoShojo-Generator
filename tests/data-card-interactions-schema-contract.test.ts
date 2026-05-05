import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { dataCardInteractions } from '@/lib/db/schema';

describe('data-card interactions schema contract', () => {
  test('drizzle schema 使用 snake_case 字段名', () => {
    const columns = dataCardInteractions as Record<string, { name: string } | undefined>;

    expect(columns.id?.name).toBe('id');
    expect(columns.dataCardId?.name).toBe('data_card_id');
    expect(columns.eventType?.name).toBe('event_type');
    expect(columns.actorScope?.name).toBe('actor_scope');
    expect(columns.actorKeyHash?.name).toBe('actor_key_hash');
    expect(columns.createdAt?.name).toBe('created_at');
  });

  test('migration 创建 interaction 表和幂等唯一约束', () => {
    const migrationPath = join(process.cwd(), 'drizzle/0012_data_card_interactions.sql');
    const content = readFileSync(migrationPath, 'utf8');

    expect(content).toContain('CREATE TABLE IF NOT EXISTS data_card_interactions');
    expect(content).toContain('event_type TEXT NOT NULL CHECK(event_type IN');
    expect(content).toContain('actor_scope TEXT NOT NULL CHECK(actor_scope IN');
    expect(content).toContain('UNIQUE(data_card_id, event_type, actor_scope, actor_key_hash)');
    expect(content).toContain('idx_data_card_interactions_card_event');
  });
});
