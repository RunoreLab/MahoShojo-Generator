import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnvConfig } from '@next/env';

type TagSeed = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  scope: 'user' | 'system' | 'admin';
  isActive?: boolean;
};

type AliasSeed = {
  alias: string;
  tagId: string;
};

type TagsSeedFile = {
  tags: TagSeed[];
  aliases?: AliasSeed[];
};

type QueryFromD1 = (sql: string, params?: unknown[]) => Promise<unknown>;

const readSeed = (seedPath: string): TagsSeedFile => {
  const text = readFileSync(seedPath, 'utf-8');
  const parsed = JSON.parse(text) as TagsSeedFile;
  if (!parsed || !Array.isArray(parsed.tags)) {
    throw new Error('tags.seed.json 格式不正确：缺少 tags 数组');
  }
  return parsed;
};

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const upsertTag = async (queryFromD1: QueryFromD1, tag: TagSeed) => {
  const nowIso = new Date().toISOString();
  const isActive = tag.isActive === false ? 0 : 1;
  await queryFromD1(
    `INSERT INTO tags (id, name, description, category, scope, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       category = excluded.category,
       scope = excluded.scope,
       is_active = excluded.is_active,
       updated_at = excluded.updated_at`,
    [
      tag.id,
      tag.name,
      tag.description ?? null,
      tag.category ?? null,
      tag.scope,
      isActive,
      nowIso,
      nowIso,
    ]
  );
};

const upsertAlias = async (queryFromD1: QueryFromD1, alias: AliasSeed) => {
  const nowIso = new Date().toISOString();
  await queryFromD1(
    `INSERT INTO tag_aliases (alias, tag_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(alias) DO UPDATE SET
       tag_id = excluded.tag_id`,
    [alias.alias, alias.tagId, nowIso]
  );
};

const main = async () => {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
  const { queryFromD1 } = await import('../lib/d1');

  const seedPath = resolve(process.cwd(), 'public', 'tags.seed.json');
  const seed = readSeed(seedPath);

  const tagIdsInSeed = new Set(seed.tags.map((t) => t.id));

  const existing = (await queryFromD1('SELECT id FROM tags', [])) as any;
  const existingIds = readRows<{ id: string }>(existing).map((row) => row.id).filter(Boolean);

  for (const tag of seed.tags) {
    if (!tag.id || !tag.name || !tag.scope) {
      throw new Error(`tags.seed.json 存在无效条目：${JSON.stringify(tag)}`);
    }
    await upsertTag(queryFromD1, tag);
  }

  const aliases = Array.isArray(seed.aliases) ? seed.aliases : [];
  for (const alias of aliases) {
    if (!alias.alias || !alias.tagId) continue;
    await upsertAlias(queryFromD1, alias);
  }

  // seed 未出现的标签：不删除，只置 is_active=0（避免破坏历史绑定）
  const toDeactivate = existingIds.filter((id) => !tagIdsInSeed.has(id));
  if (toDeactivate.length > 0) {
    const nowIso = new Date().toISOString();
    const placeholders = toDeactivate.map(() => '?').join(', ');
    await queryFromD1(
      `UPDATE tags SET is_active = 0, updated_at = ?
       WHERE id IN (${placeholders})`,
      [nowIso, ...toDeactivate]
    );
  }

  console.log(`[init-tags] 完成：tags=${seed.tags.length} aliases=${aliases.length} deactivate=${toDeactivate.length}`);
};

main().catch((error) => {
  console.error('[init-tags] 失败:', error);
  process.exitCode = 1;
});
