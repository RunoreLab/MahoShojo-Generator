import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnvConfig } from '@next/env';
import {
  deactivateTagsByIds,
  listAllTagIds,
  upsertTagAliasSeedRow,
  upsertTagSeedRow,
} from '@/lib/database/tags-seed';

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

const readSeed = (seedPath: string): TagsSeedFile => {
  const text = readFileSync(seedPath, 'utf-8');
  const parsed = JSON.parse(text) as TagsSeedFile;
  if (!parsed || !Array.isArray(parsed.tags)) {
    throw new Error('tags.seed.json 格式不正确：缺少 tags 数组');
  }
  return parsed;
};

const upsertTag = async (tag: TagSeed) => {
  const nowIso = new Date().toISOString();
  const isActive = tag.isActive === false ? 0 : 1;
  await upsertTagSeedRow({
    id: tag.id,
    name: tag.name,
    description: tag.description ?? null,
    category: tag.category ?? null,
    scope: tag.scope,
    isActive: isActive === 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
};

const upsertAlias = async (alias: AliasSeed) => {
  const nowIso = new Date().toISOString();
  await upsertTagAliasSeedRow({
    alias: alias.alias,
    tagId: alias.tagId,
    createdAt: nowIso,
  });
};

const main = async () => {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  const seedPath = resolve(process.cwd(), 'public', 'tags.seed.json');
  const seed = readSeed(seedPath);

  const tagIdsInSeed = new Set(seed.tags.map((t) => t.id));
  const existingIds = await listAllTagIds();

  for (const tag of seed.tags) {
    if (!tag.id || !tag.name || !tag.scope) {
      throw new Error(`tags.seed.json 存在无效条目：${JSON.stringify(tag)}`);
    }
    await upsertTag(tag);
  }

  const aliases = Array.isArray(seed.aliases) ? seed.aliases : [];
  for (const alias of aliases) {
    if (!alias.alias || !alias.tagId) continue;
    await upsertAlias(alias);
  }

  // seed 未出现的标签：不删除，只置 is_active=0（避免破坏历史绑定）
  const toDeactivate = existingIds.filter((id) => !tagIdsInSeed.has(id));
  if (toDeactivate.length > 0) {
    await deactivateTagsByIds({
      tagIds: toDeactivate,
      updatedAt: new Date().toISOString(),
    });
  }

  console.log(`[init-tags] 完成：tags=${seed.tags.length} aliases=${aliases.length} deactivate=${toDeactivate.length}`);
};

main().catch((error) => {
  console.error('[init-tags] 失败:', error);
  process.exitCode = 1;
});
