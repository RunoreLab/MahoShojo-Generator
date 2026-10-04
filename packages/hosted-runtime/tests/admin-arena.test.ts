import { afterEach, describe, expect, it } from 'vitest';
import { adminManagementFixture } from './admin-management-fixture';
import { readAdminArenaRisk } from '../src/admin/arena-management';
import { ADMIN_ARENA_ACTIONS } from '../src/admin/actions/arena';
import { adminActionVersion } from '../src/admin/actions/core';

const close: (() => void)[] = [];
afterEach(() => close.splice(0).forEach((fn) => fn()));
async function setup() {
 const fixture = await adminManagementFixture(['ratings.write']);
 close.push(() => fixture.sqlite.close());
 return fixture;
}
const action = (name: string) => { const found = ADMIN_ARENA_ACTIONS.find((item) => item.name === name); if (!found) throw new Error(name); return found; };

describe('Admin Arena rating management', () => {
 it('keeps risk observations and removes retired PVP interventions', async () => {
  const { db } = await setup();
  expect((await readAdminArenaRisk(db)).summary).toBeDefined();
  expect(ADMIN_ARENA_ACTIONS.some(item => item.name.startsWith('pvp-'))).toBe(false);
 });
  it('resets a rating with full revision CAS while retaining rating event history and season extrema', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("INSERT INTO arena_ratings(entity_type,entity_id,queue,rating,games,wins,losses,draws,season_peak_rating,created_at,updated_at) VALUES('data_card','card','strict',1400,8,6,2,0,1500,'2020','2020')");
    const row = sqlite.prepare("SELECT * FROM arena_ratings WHERE entity_id='card'").get()!;
    const expectedVersion = await adminActionVersion('ratings', row);
    const result = await action('ratings.reset').execute(db, { id: '["data_card","card","strict"]', expectedVersion, reason: '重置错误积分', idempotencyKey: 'rating' }, context);
    expect(result).toHaveProperty('status', 'succeeded');
    expect(sqlite.prepare("SELECT rating,games,season_peak_rating FROM arena_ratings WHERE entity_id='card'").get()).toMatchObject({ rating: 1000, games: 0, season_peak_rating: 1500 });
  });
});
