import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DataCardSummaryQuerySchema } from '@mahoshojo/contracts/data-cards';
import { listDataCardSummaries } from '@/lib/db/repositories/data-card-summaries';
import { readDataCardSummaryQuery } from '@/lib/data-card-summary-query';
import * as schema from '@/lib/db/schema';
import type { AppDrizzleDb } from '@/lib/db/drizzle';

const runtime = vi.hoisted(() => ({ db: null as unknown, userId: 1 as number | null }));
vi.mock('@/lib/db/drizzle', () => ({ getDrizzleDbFromRuntime: () => runtime.db }));
vi.mock('@/lib/auth/server', () => ({ requireAuthUser: async () => runtime.userId === null
  ? { response: Response.json({ error: '未授权' }, { status: 401 }) }
  : { user: { id: runtime.userId, username: 'alice' } } }));
import cardsHandler from '@/app/api/data-cards/handler';
import favoritesHandler from '@/app/api/favorites/handler';
import publicHandler from '@/app/api/public-data-cards/handler';
let sqlite: Database;
let db: AppDrizzleDb;
beforeEach(() => {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;
  runtime.db = db; runtime.userId = 1;
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT);
    INSERT INTO users VALUES (1, 'alice', 'a@test'), (2, 'bob', 'b@test');
    CREATE TABLE data_cards (id TEXT PRIMARY KEY, user_id INTEGER, type TEXT, name TEXT, description TEXT,
      data TEXT, is_public INTEGER DEFAULT 0, public_since TEXT, usage_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0, favorite_count INTEGER DEFAULT 0, review_status TEXT DEFAULT 'approved',
      is_recommended INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE data_card_updates (data_card_id TEXT PRIMARY KEY, data TEXT, name TEXT, description TEXT, updated_at TEXT);
    CREATE TABLE data_card_tags (data_card_id TEXT, tag_id TEXT, PRIMARY KEY (data_card_id, tag_id));
    CREATE TABLE data_card_metrics (data_card_id TEXT PRIMARY KEY, is_native INTEGER);
    CREATE TABLE favorites (user_id INTEGER, data_card_id TEXT, created_at TEXT, PRIMARY KEY(user_id, data_card_id));
  `);
  const insert = sqlite.prepare(`INSERT INTO data_cards (id,user_id,type,name,description,data,is_public,like_count,created_at)
    VALUES (?,1,'character',?,'简介',?,1,?,'2026-09-23')`);
  for (let i = 0; i < 200; i++) insert.run(`card-${String(i).padStart(3, '0')}`, `角色${i}`,
    JSON.stringify({ templateId: '通用角色', content: '正文'.repeat(100), _author: 'alice' }), i);
  sqlite.exec(`INSERT INTO data_card_updates VALUES ('card-199','{"secret":"pending"}',NULL,NULL,NULL);
    INSERT INTO data_card_tags VALUES ('card-100','tag-a'),('card-100','tag-b');
    INSERT INTO data_card_metrics VALUES ('card-100',1);
    INSERT INTO favorites SELECT 2,id,'2026-09-23' FROM data_cards;
    INSERT INTO data_cards (id,user_id,type,name,data) VALUES ('other',2,'character','其他用户','{}');`);
});
afterEach(async () => {
  sqlite.close();
  // withEdgeCache 的内存回写是 fire-and-forget 的 Response.clone().text()，flush 一次
  // macrotask 让该 promise 在 worker 拆卸前 settle，避免 better-sqlite3 销毁期断言。
  await new Promise((resolve) => setImmediate(resolve));
});

test('200 张卡首屏仅 12 条摘要，不含正文；翻页稳定、总数正确', async () => {
  const first = await listDataCardSummaries(db, 1, 'my', DataCardSummaryQuerySchema.parse({}));
  const next = await listDataCardSummaries(db, 1, 'my', DataCardSummaryQuerySchema.parse({ offset: 12 }));
  expect(first.total).toBe(200); expect(first.cards).toHaveLength(12); expect(first.nextOffset).toBe(12);
  expect(new Set([...first.cards, ...next.cards].map((card) => card.id)).size).toBe(24);
  expect(first.cards[0]).toMatchObject({ id: 'card-199', roleType: 'general', has_pending_update: true });
  for (const card of first.cards) { expect(card).not.toHaveProperty('data'); expect(card).not.toHaveProperty('pending_data'); }
});

test('集合筛选先于分页，覆盖类型/角色/可见性/数值/标签/原生/搜索/作者', async () => {
  const result = await listDataCardSummaries(db, 1, 'my', DataCardSummaryQuerySchema.parse({
    limit: 1, search: 'card-100', author: 'alice', types: ['character'], roleType: 'general', visibility: 'public',
    minLikes: 100, maxLikes: 100, minUsage: 0, maxFavorites: 0, tagIds: ['tag-a', 'tag-b'], tagMatch: 'all', nativeOnly: true,
  }));
  expect(result.total).toBe(1); expect(result.cards[0].id).toBe('card-100');
  const empty = await listDataCardSummaries(db, 1, 'my', DataCardSummaryQuerySchema.parse({ types: ['scenario'] }));
  expect(empty.total).toBe(0);
});

test('收藏只返回自己的可见且通过审核的收藏，失效卡不会出现在分页计数中', async () => {
  sqlite.exec(`UPDATE data_cards SET is_public=0 WHERE id='card-199';
    UPDATE data_cards SET review_status='pending' WHERE id='card-198';
    UPDATE data_cards SET deleted_at='today' WHERE id='card-197';`);
  const result = await listDataCardSummaries(db, 2, 'favorites', DataCardSummaryQuerySchema.parse({ sortBy: 'likes' }));
  expect(result.total).toBe(197); expect(result.cards[0].id).toBe('card-196');
  expect((await listDataCardSummaries(db, 1, 'favorites', DataCardSummaryQuerySchema.parse({}))).total).toBe(0);
});

test('历史空互动计数按零筛选，与摘要展示一致', async () => {
  sqlite.exec(`UPDATE data_cards SET like_count=NULL, usage_count=NULL, favorite_count=NULL WHERE id='card-199'`);
  const result = await listDataCardSummaries(db, 1, 'my', DataCardSummaryQuerySchema.parse({
    search: 'card-199', minLikes: 0, maxLikes: 0, minUsage: 0, maxFavorites: 0,
  }));
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]).toMatchObject({ like_count: 0, usage_count: 0, favorite_count: 0 });
});

test('摘要接口兼容旧接口，单卡正文由所有权隔离，私有响应不缓存', async () => {
  const summary = await cardsHandler(new Request('https://test/api/data-cards?view=summary&limit=12'));
  expect(summary.status).toBe(200); expect(summary.headers.get('cache-control')).toBe('private, no-store');
  const body = await summary.json(); expect(body.cards).toHaveLength(12); expect(body.total).toBe(200);
  const own = await cardsHandler(new Request('https://test/api/data-cards?id=card-199'));
  expect((await own.json()).card).toMatchObject({ data: expect.any(String), pending_data: '{"secret":"pending"}' });
  expect((await cardsHandler(new Request('https://test/api/data-cards?id=other'))).status).toBe(404);
  runtime.userId = 2;
  expect((await cardsHandler(new Request('https://test/api/data-cards?id=card-199'))).status).toBe(404);
  const favorites = await favoritesHandler(new Request('https://test/api/favorites?view=summary&limit=12'));
  expect((await favorites.json()).cards).toHaveLength(12);
  runtime.userId = null;
  expect((await cardsHandler(new Request('https://test/api/data-cards?id=card-199'))).status).toBe(401);
});

test('损坏 JSON 不影响摘要；问卷库保留旧误标问卷发现与原生许可', async () => {
  sqlite.prepare(`UPDATE data_cards SET data=? WHERE id='card-199'`).run('bad-json');
  sqlite.prepare(`UPDATE data_cards SET data=? WHERE id='card-198'`).run(JSON.stringify({
    kind: 'magical-girl', title: '旧问卷', questions: [{ id: 'q1', question: '名字？' }], nativeAllowed: true,
  }));
  const result = await listDataCardSummaries(db, 1, 'my', DataCardSummaryQuerySchema.parse({
    types: ['questionnaire'], includeLegacyQuestionnaires: true, nativeAllowedOnly: true,
  }));
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]).toMatchObject({ id: 'card-198', type: 'questionnaire', isLegacyQuestionnaire: true, nativeAllowed: true });
  expect((await listDataCardSummaries(db, 1, 'my', DataCardSummaryQuerySchema.parse({}))).cards).toHaveLength(12);
});

test.each(['limit=25','offset=-1','roleType=no','types=bad','nativeOnly=bad','minLikes=-1'])('拒绝无效摘要查询 %s', async (query) => {
  expect(readDataCardSummaryQuery(new URLSearchParams(query))).toBeNull();
  expect((await cardsHandler(new Request(`https://test/api/data-cards?view=summary&${query}`))).status).toBe(400);
});

describe('public 摘要源（D5.0e-r1）', () => {
  test('公开摘要只含 public+approved 行的元数据，分页有界且无正文', async () => {
    sqlite.exec(`UPDATE data_cards SET is_public=0 WHERE id='card-199';
      UPDATE data_cards SET review_status='pending' WHERE id='card-198';
      UPDATE data_cards SET deleted_at='today' WHERE id='card-197';`);
    const result = await listDataCardSummaries(db, null, 'public', DataCardSummaryQuerySchema.parse({}));
    expect(result.total).toBe(197);
    expect(result.cards).toHaveLength(12);
    expect(result.nextOffset).toBe(12);
    for (const card of result.cards) {
      expect(card).not.toHaveProperty('data');
      expect(card.is_public).toBe(1);
      expect(card.review_status).toBe('approved');
      expect(card.has_pending_update).toBe(false);
      expect(card.favorited_at).toBeNull();
    }
  });

  test('公开摘要 roleType 在 SQL 侧过滤，total 与过滤后一致', async () => {
    sqlite.prepare(`UPDATE data_cards SET data=? WHERE id='card-100'`).run(JSON.stringify({
      templateId: '魔法少女/心之花/魔法少女（问卷生成）', content: '正文',
    }));
    const magical = await listDataCardSummaries(db, null, 'public', DataCardSummaryQuerySchema.parse({ roleType: 'magical-girl' }));
    expect(magical.total).toBe(1);
    expect(magical.cards[0]).toMatchObject({ id: 'card-100', roleType: 'magical-girl' });
    // 其余 199 张 templateId='通用角色' → general；角色过滤不放大结果集。
    const general = await listDataCardSummaries(db, null, 'public', DataCardSummaryQuerySchema.parse({ roleType: 'general' }));
    expect(general.total).toBe(199);
    const canshou = await listDataCardSummaries(db, null, 'public', DataCardSummaryQuerySchema.parse({ roleType: 'canshou' }));
    expect(canshou.total).toBe(0);
  });

  test('公开摘要的作者筛选是精确匹配（与旧公开列表语义一致）', async () => {
    const exact = await listDataCardSummaries(db, null, 'public', DataCardSummaryQuerySchema.parse({ author: 'alice' }));
    expect(exact.total).toBe(200);
    const partial = await listDataCardSummaries(db, null, 'public', DataCardSummaryQuerySchema.parse({ author: 'ali' }));
    expect(partial.total).toBe(0);
  });

  test('handler view=summary 返回摘要页契约；?id= 仍回完整正文', async () => {
    const summary = await publicHandler(new Request('https://test/api/public-data-cards?view=summary&limit=5&type=character&sortBy=created_at'));
    expect(summary.status).toBe(200);
    const body = await summary.json();
    expect(body).toMatchObject({ success: true, total: 200 });
    expect(body.cards).toHaveLength(5);
    expect(body.nextOffset).toBe(5);
    for (const card of body.cards) expect(card).not.toHaveProperty('data');

    const filtered = await publicHandler(new Request('https://test/api/public-data-cards?view=summary&roleType=canshou'));
    expect(((await filtered.json()).cards)).toHaveLength(0);

    const single = await publicHandler(new Request('https://test/api/public-data-cards?id=card-199'));
    expect((await single.json()).card).toMatchObject({ id: 'card-199', data: expect.any(String) });
  });

  test('handler view=summary 拒绝非法筛选值', async () => {
    expect((await publicHandler(new Request('https://test/api/public-data-cards?view=summary&roleType=nope'))).status).toBe(400);
    expect((await publicHandler(new Request('https://test/api/public-data-cards?view=summary&limit=999'))).status).toBe(400);
  });
});
