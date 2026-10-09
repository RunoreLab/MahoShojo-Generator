import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
const mocks = vi.hoisted(() => ({ db: null as AppDrizzleDb | null, auth: vi.fn(), quickCheck: vi.fn(), reset: vi.fn(), review: vi.fn(), reviewUpdate: vi.fn(), legacy: vi.fn(), slots: vi.fn(), capacity: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireAuthUser: mocks.auth }));
vi.mock('@/lib/db/drizzle', () => ({ getDrizzleDbFromRuntime: () => mocks.db }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: mocks.quickCheck }));
vi.mock('@/lib/config', () => ({ config: { DEFAULT_DATA_CARD_CAPACITY: 20, DATA_CARD_AUTO_REVIEW: { enabled: true } } }));
vi.mock('@/lib/database/data-cards', () => ({ createDataCardWithAuthor: mocks.legacy, getUserDataCards: mocks.legacy, updateDataCard: mocks.legacy, deleteDataCard: mocks.legacy, pruneUserRecycleBin: mocks.legacy, upsertDataCardUpdate: mocks.legacy, getDataCardById: mocks.legacy, getUserUsedSlots: mocks.slots, updateDataCardContentByIdAndUser: mocks.legacy }));
vi.mock('@/lib/database/users', () => ({ getUserDataCardCapacity: mocks.capacity }));
vi.mock('@/lib/database/arena-ratings', () => ({ resetStrictArenaRatingForDataCard: mocks.reset }));
vi.mock('@/lib/database/data-card-metrics', () => ({ upsertDataCardMetrics: vi.fn() }));
vi.mock('@/lib/review/auto-data-card-review', () => ({ autoReviewLatestPendingPublicDataCardsForUser: mocks.review, autoReviewLatestPendingPublicDataCardUpdatesForUser: mocks.reviewUpdate }));
vi.mock('@/lib/review/auto-review-engine', () => ({ getAutoReviewPolicy: () => ({ exemptUserPolicy: 'bypass' }) }));
import { appRouteHandler as handler } from '@/app/api/data-cards/replace-owned/handler';
import { OwnedDataCardReplacementTargetResponseSchema, OwnedDataCardReplaceAcknowledgementSchema } from '@mahoshojo/contracts/data-cards';
let sqlite: Database;
const owner = { id: 7, username: 'owner', is_admin: 0, is_review_exempt: 0 };
const get = (id = 'c', userId = '7') => handler(new Request(`https://test/api/data-cards/replace-owned?id=${id}&expectedUserId=${userId}`));
const put = (payload: unknown) => handler(new Request('https://test/api/data-cards/replace-owned', { method: 'PUT', body: JSON.stringify(payload) }));
const prepare = async () => {
  const body = await (await get()).json();
  return { id: 'c', type: 'character', expectedUserId: 7, expectedVersion: body.target.version, data: { new: true } };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { ...owner } });
  mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: false });
  mocks.slots.mockResolvedValue(0); mocks.capacity.mockResolvedValue(20);
  mocks.reset.mockResolvedValue(undefined); mocks.review.mockResolvedValue(undefined); mocks.reviewUpdate.mockResolvedValue(undefined);
  sqlite = new Database(':memory:'); mocks.db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;
  sqlite.exec(`CREATE TABLE data_cards (id TEXT PRIMARY KEY,user_id INTEGER,type TEXT,name TEXT,description TEXT,data TEXT,is_public INTEGER,review_status TEXT,updated_at TEXT,deleted_at TEXT,favorite_count INTEGER,usage_count INTEGER);
  CREATE TABLE data_card_updates (id TEXT PRIMARY KEY,data_card_id TEXT UNIQUE,user_id INTEGER,name TEXT,description TEXT,data TEXT,created_at TEXT,updated_at TEXT);
  INSERT INTO data_cards VALUES ('c',7,'character','目标卡',NULL,'{}',0,'pending','same-second',NULL,0,0);`);
});
afterEach(() => sqlite.close());
describe('replace-owned real route + SQLite', () => {
  test('read target once-authenticated, private/no-store, no body or side effects', async () => {
    const response = await get(); expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json(); expect(OwnedDataCardReplacementTargetResponseSchema.safeParse(body).success).toBe(true);
    expect(body.target.data).toBeUndefined(); expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.quickCheck).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  test.each([null, '7', 0, 7.5, 9007199254740992])('reject malformed expected owner %j before reads', async (expectedUserId) => {
    expect((await put({ expectedUserId })).status).toBe(400); expect(mocks.quickCheck).not.toHaveBeenCalled();
  });
  test('actual server owner wins, not expectedUserId claim', async () => {
    mocks.auth.mockResolvedValue({ user: { ...owner, id: 8 } });
    expect(await (await get()).json()).toEqual({ error: 'ACCOUNT_MISMATCH' });
    expect((await put({ expectedUserId: 7 })).status).toBe(409);
    expect(mocks.quickCheck).not.toHaveBeenCalled();
  });
  test('target ownership and deleted targets are checked server side', async () => {
    sqlite.exec('UPDATE data_cards SET user_id=8'); expect((await get()).status).toBe(404);
    sqlite.exec("UPDATE data_cards SET user_id=7,deleted_at='deleted'"); expect((await get()).status).toBe(404);
  });
  test.each([-1, 0, 1])('direct replacement preserves visibility %s and current meta', async (visibility) => {
    sqlite.prepare('UPDATE data_cards SET is_public=?').run(visibility);
    const request = await prepare(); mocks.auth.mockClear();
    const response = await put(request); expect(response.status).toBe(200);
    expect(OwnedDataCardReplaceAcknowledgementSchema.parse(await response.json())).toMatchObject({ ownerUserId: 7, id: 'c', pendingReview: false });
    expect(mocks.auth).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT name,description,is_public,data FROM data_cards').get()).toEqual({ name: '目标卡', description: null, is_public: visibility, data: '{"new":true}' });
  });
  test('approved ordinary target updates pending using main metadata', async () => {
    sqlite.exec(`UPDATE data_cards SET review_status='approved',is_public=1;
      INSERT INTO data_card_updates VALUES ('p','c',7,'旧待审名','旧待审描述','{}',NULL,'same-second')`);
    const response = await put(await prepare()); expect(await response.json()).toMatchObject({ success: true, pendingReview: true });
    expect(sqlite.prepare('SELECT name,description,data FROM data_card_updates').get()).toEqual({ name: '目标卡', description: null, data: '{"new":true}' });
    expect(sqlite.prepare('SELECT data FROM data_cards').get()).toEqual({ data: '{}' });
    expect(mocks.reviewUpdate).toHaveBeenCalledOnce(); expect(mocks.reset).not.toHaveBeenCalled();
  });
  test.each(['data', 'pending', 'review', 'deleted'])('change during shared validation rejects atomically: %s', async (change) => {
    const request = await prepare();
    mocks.quickCheck.mockImplementationOnce(async () => {
      sqlite.exec(change === 'data' ? `UPDATE data_cards SET data='{"other":1}'` : change === 'pending' ? `INSERT INTO data_card_updates VALUES ('p','c',7,NULL,NULL,'{}',NULL,NULL)` : change === 'review' ? `UPDATE data_cards SET review_status='approved'` : `UPDATE data_cards SET deleted_at='deleted'`);
      return { hasSensitiveWords: false };
    });
    const response = await put(request); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'TARGET_CHANGED' });
    expect(mocks.reset).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.reviewUpdate).not.toHaveBeenCalled();
  });
  test('stale version or changed type rejected before content checks', async () => {
    const request = await prepare();
    expect((await put({ ...request, expectedVersion: '0'.repeat(64) })).status).toBe(409);
    expect((await put({ ...request, type: 'scenario' })).status).toBe(409);
    expect((await put({ ...request, name: 'unauthorized meta' })).status).toBe(400);
    expect(mocks.quickCheck).not.toHaveBeenCalled();
  });
  test('quota and sensitive word refusals preserve original data', async () => {
    const request = await prepare(); mocks.capacity.mockResolvedValueOnce(0);
    expect((await put(request)).status).toBe(429);
    mocks.quickCheck.mockResolvedValueOnce({ hasSensitiveWords: true }); expect((await put(request)).status).toBe(403);
    expect(sqlite.prepare('SELECT data FROM data_cards').get()).toEqual({ data: '{}' });
  });
  test('questionnaire nativeAllowed remains server-authoritative', async () => {
    sqlite.exec(`UPDATE data_cards SET type='questionnaire',data='{"nativeAllowed":false}'`);
    const request = await prepare();
    expect((await put({ ...request, type: 'questionnaire', data: { nativeAllowed: true, custom: 1 } })).status).toBe(200);
    expect(JSON.parse((sqlite.prepare('SELECT data FROM data_cards').get() as { data: string }).data)).toEqual({ nativeAllowed: false, custom: 1 });
  });
});
