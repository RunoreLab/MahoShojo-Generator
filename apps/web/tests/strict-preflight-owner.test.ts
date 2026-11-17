import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '@mahoshojo/contracts/fixtures/arena-strict-preflight.json';
import { DesktopStrictPreflightResponseSchema } from '@mahoshojo/contracts/arena-strict-preflight';
const mocks = vi.hoisted(() => ({ user: { id: 42 } as { id: number } | null, daily: vi.fn(), pair: vi.fn(), cards: vi.fn(), db: vi.fn(), season: vi.fn() }));
vi.mock('@/lib/auth/request-auth-user', () => ({ createRequestAuthUserResolver: () => ({ getUser: async () => mocks.user }) }));
vi.mock('@/lib/db/drizzle', () => ({ getDrizzleDbFromRuntime: mocks.db }));
vi.mock('@/lib/db/repositories/data-card-meta', () => ({ getDataCardMetaCardsByIds: mocks.cards }));
vi.mock('@/lib/db/repositories/arena-strict-preflight', () => ({ getStrictArenaRatingsByEntities: async () => [] }));
vi.mock('@/lib/seasons-config', () => ({ fetchCurrentSeasonFromOrigin: mocks.season }));
vi.mock('@/lib/database/arena-ratings', () => ({
  buildPairKey: () => 'synthetic-pair', getStrictDailyUsage: mocks.daily, getStrictPairUsage: mocks.pair,
  getStrictRangeCheckResult: () => null, INITIAL_RATING: 1000, STRICT_DEDUP_WINDOW_MS: 600000, STRICT_DAILY_LIMIT: 10, STRICT_SAME_PAIR_DAILY_LIMIT: 3,
}));
import handler from '../app/api/arena/strict-preflight/handler';
const request = (body: unknown) => handler(new Request('https://fixture.invalid/api/arena/strict-preflight', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);
beforeEach(() => {
  vi.clearAllMocks(); mocks.user = { id: 42 }; mocks.db.mockReturnValue({}); mocks.season.mockResolvedValue(null);
  mocks.cards.mockResolvedValue(['card-a', 'card-b'].map(id => ({ id, userId: 42, type: 'character', isPublic: true, reviewStatus: 'approved' })));
  mocks.daily.mockResolvedValue({ used: 0, exceeded: false, sinceIso: null });
  mocks.pair.mockResolvedValue({ usedToday: 0, limit: 3, exceeded: false, recentDeduped: false, recentAppliedAtIso: null, nextEligibleAtIso: null });
});

describe('Strict preflight bounded Desktop owner/version handshake', () => {
  it('adds actual authenticated owner and protocol version to the existing advisory response', async () => {
    const response = await request({ ...fixture.request.body, expectedUserId: fixture.request.expectedUserId });
    expect(response.status).toBe(200);
    const body = DesktopStrictPreflightResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ success: true, viewerUserId: 42, preflightVersion: 'desktop-strict-preflight-v1', willCount: true });
    expect(mocks.daily).toHaveBeenCalledWith(42); expect(mocks.pair).toHaveBeenCalledWith(42, 'synthetic-pair');
  });
  it('keeps legacy Web requests and response shape compatible', async () => {
    const response = await request(fixture.request.body), body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ success: true, willCount: true });
    expect(body).not.toHaveProperty('preflightVersion'); expect(body).not.toHaveProperty('viewerUserId');
  });
  it('does not read private daily/pair state for a stale asserted viewer or missing login', async () => {
    for (const actual of [{ id: 43 }, null]) {
      mocks.user = actual;
      const response = await request({ ...fixture.request.body, expectedUserId: 42 });
      expect(response.status).toBe(actual ? 409 : 401); expect(await response.json()).toMatchObject({ success: false });
    }
    expect(mocks.daily).not.toHaveBeenCalled(); expect(mocks.pair).not.toHaveBeenCalled(); expect(mocks.cards).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.season).not.toHaveBeenCalled();
  });
  it('rejects malformed owner and extra nested credentials for guarded callers without changing legacy Web input handling', async () => {
    for (const expectedUserId of [null, 0, -1, 42.5, '42', Number.MAX_SAFE_INTEGER + 1]) {
      expect((await request({ ...fixture.request.body, expectedUserId })).status).toBe(400);
    }
    expect((await request({ ...fixture.request.body, expectedUserId: 42, customProvider: { providerId: 'system', modelId: 'default', apiKey: 'rejected-canary' } })).status).toBe(400);
    expect(mocks.daily).not.toHaveBeenCalled(); expect(mocks.pair).not.toHaveBeenCalled();
  });
});

describe('strict preflight requires an owned participant', () => {
  const ownedRule = async (combatants: unknown[], owners: number[], guarded = false) => {
    mocks.cards.mockResolvedValue(combatants.flatMap((combatant, index) => {
      const card = combatant as { isPreset: boolean; sourceDataCardId: string | null };
      return card.isPreset ? [] : [{ id: card.sourceDataCardId!, userId: owners[index], type: 'character', isPublic: true, reviewStatus: 'approved' }];
    }));
    const body = { ...fixture.request.body, combatants };
    const response = await request(guarded ? { ...body, expectedUserId: 42 } : body);
    return response.json();
  };
  const card = (id: string, isPreset = false) => ({ isPreset, filename: isPreset ? id : null,
    sourceDataCardId: isPreset ? null : id, characterGuidance: null });

  it.each([
    ['owned A', [card('a'), card('b')], [42, 99], true],
    ['owned B', [card('a'), card('b')], [99, 42], true],
    ['both owned', [card('a'), card('b')], [42, 42], true],
    ['two other owners', [card('a'), card('b')], [99, 77], false],
    ['other owner and preset', [card('a'), card('official', true)], [99, 0], false],
    ['two presets', [card('official-a', true), card('official-b', true)], [0, 0], false],
  ])('applies ownership rule for %s in legacy and guarded requests', async (_label, combatants, owners, expected) => {
    for (const guarded of [false, true]) {
      const result = await ownedRule(combatants, owners, guarded);
      expect(result.willCount).toBe(expected);
      if (expected) expect(result.reasons).not.toContain('strict-no-owned-combatant');
      else expect(result.reasons).toContain('strict-no-owned-combatant');
    }
  });

  it('ignores an unrelated owned card and client ownership claims', async () => {
    mocks.cards.mockResolvedValue(['a', 'b', 'unrelated'].map(id => ({
      id, userId: id === 'unrelated' ? 42 : 99, type: 'character', isPublic: true, reviewStatus: 'approved',
    })));
    const body = { ...fixture.request.body, combatants: [card('a'), card('b')] };
    for (const input of [
      { ...body, expectedUserId: 42 },
      { ...body, combatants: body.combatants.map(c => ({ ...c, isMine: true, userId: 42, author: '42' })) },
    ]) {
      expect(await (await request(input)).json()).toMatchObject({ willCount: false, reasons: ['strict-no-owned-combatant'] });
    }
  });

  it('rejects private, unapproved, or unverifiable cards', async () => {
    mocks.cards.mockResolvedValue([
      { id: 'card-a', userId: 42, type: 'character', isPublic: false, reviewStatus: 'approved' },
      { id: 'card-b', userId: 99, type: 'character', isPublic: true, reviewStatus: 'approved' },
    ]);
    expect(await (await request(fixture.request.body)).json()).toMatchObject({ reasons: expect.arrayContaining(['strict-not-public']) });
    mocks.cards.mockResolvedValue([
      { id: 'card-a', userId: 42, type: 'character', isPublic: true, reviewStatus: 'pending' },
      { id: 'card-b', userId: 99, type: 'character', isPublic: true, reviewStatus: 'approved' },
    ]);
    expect(await (await request(fixture.request.body)).json()).toMatchObject({ reasons: expect.arrayContaining(['strict-not-approved']) });
    mocks.cards.mockRejectedValue(new Error('database unavailable'));
    expect(await (await request(fixture.request.body)).json()).toMatchObject({ reasons: expect.arrayContaining(['strict-card-missing']) });
  });
});


it('enforces the exact guarded UTF-8 wire budget while retaining legacy request handling', async () => {
  const body = { ...fixture.request.body, expectedUserId: 42, combatants: Array.from({ length: 32 }, () => ({ isPreset: false, filename: null, sourceDataCardId: null, characterGuidance: '' })) };
  let remaining = 65536 - new TextEncoder().encode(JSON.stringify(body)).byteLength;
  for (const card of body.combatants) { const n = Math.min(2000, remaining); card.characterGuidance = 'x'.repeat(n); remaining -= n; }
  expect(remaining).toBe(0); expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBe(65536);
  expect((await request(body)).status).toBe(200);
  const available = body.combatants.find(card => card.characterGuidance.length < 2000)!; available.characterGuidance += 'x';
  expect((await request(body)).status).toBe(413);
  const { expectedUserId: _owner, ...legacy } = body;
  expect((await request(legacy)).status).toBe(200);
});
