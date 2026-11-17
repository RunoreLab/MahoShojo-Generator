import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createNodeArenaGenerationExecutor, createNodeArenaGenerationFinalizationPorts,
  bindArenaRatingEntities, digestArenaRatingJson } from '@mahoshojo/hosted-runtime/arena-generation';
import type { BattleReportGenerationCombatantRow } from '@/lib/database/battle-report-generation-combatants';
import {
  setArenaRatingsRepoBundleForTests, settleArenaRatingsForGeneration,
  type ArenaRatingSnapshot, type ArenaEligibilitySnapshot, type ArenaEntity,
} from '@/lib/database/arena-ratings';

type Repository = NonNullable<Parameters<typeof setArenaRatingsRepoBundleForTests>[0]>;
type Event = NonNullable<Awaited<ReturnType<Repository['getArenaRatingEventById']>>>;
const version = '2026-01-01T00:00:00.000Z';
const before: ArenaRatingSnapshot = { rating: 1000, games: 0, wins: 0, losses: 0, draws: 0 };
const afterA: ArenaRatingSnapshot = { rating: 1020, games: 1, wins: 1, losses: 0, draws: 0 };
const afterB: ArenaRatingSnapshot = { rating: 980, games: 1, wins: 0, losses: 1, draws: 0 };
const blankEvent = (id: string, status: Event['status'], reason: string | null = null): Event => ({
  id, status, skip_reason: reason, details_json: null,
  a_before_rating: null, a_after_rating: null, a_delta: null, a_before_games: null, a_after_games: null,
  b_before_rating: null, b_after_rating: null, b_delta: null, b_before_games: null, b_after_games: null,
});

const fixture = async () => {
  const rows = ['a', 'b'].map((id) => ({ id: `card-${id}`, type: 'character',
    data: JSON.stringify({ templateId: '通用角色', name: id.toUpperCase(), content: `${id}设定` }),
    updatedAt: version, userId: 42, isPublic: 1, reviewStatus: 'approved', deletedAt: null }));
  const binding = { version: 1, status: 'bound', entities: await Promise.all(rows.map(async (row) => ({
    entityType: 'data_card', entityId: row.id, updatedAt: row.updatedAt,
    contentDigest: await digestArenaRatingJson(JSON.parse(row.data)), authorizedUserId: 42,
  }))) };
  const extra: Record<string, unknown> = { arenaStrictPolicy: '1+3:v2', readNarrativeHistory: false,
    arenaFreeRankingEnabled: true, ratingEntityBinding: binding };
  const snapshot: ArenaEligibilitySnapshot = { status: 'completed', mode: 'classic', userId: 42,
    ipAnonymized: '192.0.2.0', language: 'zh-CN', selectedLevel: null, hasScenario: 0,
    hasUserGuidance: 0, userGuidancePreview: null, hasAdjudicationEvents: 0,
    readArenaHistory: 0, readCurrentState: 0, combatantCount: 2, winner: 'A', extraJson: null };
  const combatants: BattleReportGenerationCombatantRow[] = rows.map((row, index) => ({ generation_id: 'binding-test', sort_index: index,
    name: index === 0 ? 'A' : 'B', type: 'general-character', template_id: null,
    is_native: 0, is_preset: 0, team_id: null, character_guidance: null,
    data_card_id: row.id, data_card_updated_at: version, size_chars: null, size_bytes: null, created_at: version }));
  const events = new Map<string, Event>();
  const ratings = new Map<string, ArenaRatingSnapshot>();
  const key = (queue: string, id: string) => `${queue}:${id}`;
  const ensure = (queue: string, id: string) => {
    const result = ratings.get(key(queue, id)) ?? { ...before };
    ratings.set(key(queue, id), result);
    return result;
  };
  const repo: Repository = {
    db: {}, resetStrictArenaRatingForDataCard: async () => {}, removeStrictArenaRatingForDataCard: async () => {},
    countStrictAppliedEventsSince: async () => 0,
    getStrictUserPairAppliedStatsSince: async () => ({ pairUsedToday: 0, latestAppliedAt: null }),
    getStrictQueueDataCardsByIds: vi.fn(async () => rows),
    getArenaEligibilitySnapshotByGenerationId: async () => ({ ...snapshot, extraJson: JSON.stringify(extra) }),
    listGenerationCombatantsByGenerationId: async () => combatants,
    ensureArenaRatingsExist: vi.fn(async (_db, queue, entities: [ArenaEntity, ArenaEntity]) => { entities.forEach((entity) => ensure(queue, entity.entityId)); }),
    getArenaRatingsByEntitiesForQueue: async (_db, queue, entities) => entities.map((entity) => ({ ...entity, ...ensure(queue, entity.entityId) })),
    hasRecentAppliedEventForPair: async () => false,
    insertArenaRatingEvent: async (_db, payload) => {
      if (events.has(payload.id)) return false;
      events.set(payload.id, blankEvent(payload.id, payload.status, payload.skipReason));
      return true;
    },
    getArenaRatingEventById: async (_db, id) => events.has(id) ? { ...events.get(id)! } : null,
    updateArenaRatingEventComputedFields: async (_db, id, computed) => {
      const event = events.get(id)!;
      for (const [slot, previous, next, delta] of [
        ['a', computed.aBefore, computed.aAfter, computed.deltaA],
        ['b', computed.bBefore, computed.bAfter, computed.deltaB],
      ] as const) {
        Object.assign(event, { [`${slot}_before_rating`]: previous.rating, [`${slot}_after_rating`]: next.rating,
          [`${slot}_before_games`]: previous.games, [`${slot}_after_games`]: next.games, [`${slot}_delta`]: delta });
      }
      return true;
    },
    markArenaRatingEventApplied: async (_db, id) => { events.get(id)!.status = 'applied'; },
    markArenaRatingEventStatus: async (_db, id, status, options) => {
      Object.assign(events.get(id)!, { status, skip_reason: options?.skipReason ?? null });
    },
    applyArenaRatingsUpdateIfBothMatch: vi.fn(async (_db, queue, entities, computed, _at, guards) => {
      const a = ensure(queue, entities[0].entityId); const b = ensure(queue, entities[1].entityId);
      if (a.rating === computed.aAfter.rating && b.rating === computed.bAfter.rating
        && a.games === computed.aAfter.games && b.games === computed.bAfter.games) return 'already-applied';
      if (guards === null) return 'identity-conflict';
      Object.assign(a, computed.aAfter); Object.assign(b, computed.bAfter);
      return 'applied';
    }),
  };
  setArenaRatingsRepoBundleForTests(repo);
  return { rows, binding, extra, snapshot, combatants, events, ratings, repo, ensure };
};

afterEach(() => setArenaRatingsRepoBundleForTests(null));

describe('Strict and Free share server entity binding', () => {
  it.each(['conditional-skip', 'insert-skip'] as const)('keeps an inconclusive concurrent %s pending for finalization retry', async (race) => {
    const f = await fixture(); delete f.extra.ratingEntityBinding; f.extra.arenaFreeRankingEnabled = false;
    const id = 'binding-test:strict';
    if (race === 'conditional-skip') {
      f.events.set(id, blankEvent(id, 'pending'));
      f.repo.markArenaRatingEventStatus = async () => false;
    } else {
      f.repo.insertArenaRatingEvent = async (_db, payload) => {
        f.events.set(payload.id, blankEvent(payload.id, 'pending'));
        return false;
      };
    }
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(settleArenaRatingsForGeneration('binding-test')).rejects.toThrow('ARENA_RATING_IDENTITY_SETTLEMENT_RETRY');
      expect(f.events.get(id)?.status).toBe('pending');
      expect(f.repo.applyArenaRatingsUpdateIfBothMatch).not.toHaveBeenCalled();
    } finally { errorLog.mockRestore(); }
  });

  it.each(['body-mismatch', 'no-owned-combatant'])('enforces %s through real prepare, terminal manifest and fallback settlement', async (cause) => {
    const f = await fixture();
    if (cause === 'no-owned-combatant') f.rows.forEach((row) => { row.userId = 99; });
    const sourceStatement = { bind: (..._params: unknown[]) => sourceStatement,
      all: async () => ({ success: true, meta: {}, results: f.rows.map((row) => ({ ...row, updated_at: row.updatedAt })) }),
      run: async () => ({ success: true, meta: {}, results: [] }) };
    const executor = createNodeArenaGenerationExecutor({ env: {},
      getD1Client: () => ({ prepare: () => sourceStatement }),
      signatureService: { generateSignature: async () => 'valid', verifySignature: async () => true },
      readSeasonContext: async () => ({ authorityAvailable: true, seasonId: null, mode: 'classic',
        storyGuidance: '', scenarioPresetFilename: null, questionnaireLoreAllowed: false, questionnaireLorePresetIds: [] }),
      enforceSafety: async () => null, generateWithStreamAI: vi.fn(),
      finalizer: async () => ({ resultRef: null, ranking: null }),
    });
    const prepared = await executor.prepare!({ request: new Request('https://example.test/api/arena/generate-stream', {
      headers: { 'cf-connecting-ip': '192.0.2.10' },
    }), actorKey: 'user:42', generationRequestId: 'binding-test', payload: {
      mode: 'classic', language: 'zh-CN', readArenaHistory: false, readCurrentState: false, readNarrativeHistory: false,
      arenaFreeRankingEnabled: true, combatants: f.rows.map((row, index) => ({ type: 'general-character',
        isPreset: false, sourceDataCardId: row.id, data: index === 0 && cause === 'body-mismatch'
          ? { templateId: '通用角色', name: 'IMPOSTOR', content: '完全不同角色', signature: 'valid' }
          : { ...JSON.parse(row.data), signature: 'valid' } })),
      __arenaServerContextV1: { ratingEntityBinding: f.binding },
      arenaStrictPolicy: '1+3:v1', // Client downgrade attempts cannot choose the persisted policy.
    } });
    if (prepared instanceof Response || !('executionPayload' in prepared)) throw new Error('Expected generation preparation');
    const writes: unknown[][] = [];
    const statement = { bind: (...params: unknown[]) => { writes.push(params); return statement; },
      run: async () => ({ success: true, meta: { changes: 1 }, results: [] }),
      all: async () => ({ success: true, meta: {}, results: [] }) };
    const ports = createNodeArenaGenerationFinalizationPorts({ getD1Client: () => ({ prepare: () => statement }) });
    await ports.claimTerminal({ generationId: 'binding-test', generationRequestId: 'binding-test', actorKey: 'user:42',
      payloadHash: 'synthetic-hash', payload: prepared.executionPayload, metadata: { streamMeta: { report: { winner: cause === 'body-mismatch' ? 'IMPOSTOR' : 'A' } } },
      markdown: 'synthetic result', telemetry: {}, status: 'completed', errorCode: null, resultRef: null });
    const encoded = writes.flat().find((value) => typeof value === 'string' && value.includes('generationOwnerHash'));
    Object.keys(f.extra).forEach((key) => delete f.extra[key]); Object.assign(f.extra, JSON.parse(encoded as string));
    expect(f.extra.arenaStrictPolicy).toBe('1+3:v2');
    f.snapshot.winner = cause === 'body-mismatch' ? 'IMPOSTOR' : 'A'; f.combatants.splice(0); // Exercise the actual persisted fallback roster.
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.events.get('binding-test:strict')).toMatchObject({ status: 'skipped',
      skip_reason: cause === 'body-mismatch' ? 'entity-body-mismatch' : 'strict-no-owned-combatant' });
    expect(f.events.get('binding-test:free')?.status).toBe(cause === 'body-mismatch' ? 'skipped' : 'applied');
    if (cause === 'body-mismatch') expect(f.repo.applyArenaRatingsUpdateIfBothMatch).not.toHaveBeenCalled();
  });

  it.each([[42, 99], [99, 42], [42, 42], [99, 100]])('checks current database owners %s/%s, preserving Free', async (aOwner, bOwner) => {
    const f = await fixture();
    const owners = [aOwner, bOwner];
    f.rows.forEach((row, index) => { row.userId = owners[index]; });
    await settleArenaRatingsForGeneration('binding-test');
    const owned = owners.includes(42);
    expect(f.events.get('binding-test:strict')).toMatchObject(owned ? { status: 'applied' }
      : { status: 'skipped', skip_reason: 'strict-no-owned-combatant' });
    expect(f.events.get('binding-test:free')?.status).toBe('applied');
    const strictCall = vi.mocked(f.repo.applyArenaRatingsUpdateIfBothMatch).mock.calls.find((call) => call[1] === 'strict');
    expect(strictCall?.[7]).toBe(owned ? 42 : undefined);
    expect(vi.mocked(f.repo.applyArenaRatingsUpdateIfBothMatch).mock.calls.find((call) => call[1] === 'free')?.[7]).toBeUndefined();
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.ensure('free', 'card-a').games).toBe(1);
    expect(f.ensure('strict', 'card-a').games).toBe(owned ? 1 : 0);
  });

  it.each(['owned-and-preset', 'other-and-preset', 'two-presets'])('settles %s using real preset authority', async (combination) => {
    const f = await fixture();
    const presets = await Promise.all(['C01_egg.json', 'C02_pupa.json'].map(async (filename) => ({
      type: 'canshou', isPreset: true, filename,
      data: JSON.parse(await readFile(new URL(`../../../content/presets/${filename}`, import.meta.url), 'utf8')),
    })));
    const binding = await bindArenaRatingEntities({ payload: { combatants: presets }, request: new Request('https://fixture.invalid') });
    if (binding.status !== 'bound') throw new Error('Expected real preset binding');
    for (const index of combination === 'two-presets' ? [0, 1] : [1]) {
      Object.assign(f.combatants[index], { is_preset: 1, template_id: presets[index].filename, data_card_id: null });
      Object.assign(f.binding.entities[index], binding.entities[index]);
    }
    if (combination === 'other-and-preset') f.rows[0].userId = 99;
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.events.get('binding-test:strict')).toMatchObject(combination === 'owned-and-preset' ? { status: 'applied' }
      : { status: 'skipped', skip_reason: 'strict-no-owned-combatant' });
    expect(f.events.get('binding-test:free')?.status).toBe('applied');
  });

  it.each(['1+3:v1', 'ticket'])('preserves persisted %s history without a self-owned combatant', async (policy) => {
    const f = await fixture(); f.rows.forEach((row) => { row.userId = 99; });
    if (policy === 'ticket') { delete f.extra.arenaStrictPolicy; f.extra.rankedMatchOk = true; }
    else f.extra.arenaStrictPolicy = policy;
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.events.get('binding-test:strict')?.status).toBe('applied');
    expect(vi.mocked(f.repo.applyArenaRatingsUpdateIfBothMatch).mock.calls[0]?.[7]).toBeUndefined();
  });

  it.each([false, true])('reconciles pending v2 after ownership loss only if ratings were already applied: %s', async (wasApplied) => {
    const f = await fixture(); f.extra.arenaFreeRankingEnabled = false;
    f.rows.forEach((row) => { row.userId = 99; });
    const id = 'binding-test:strict'; f.events.set(id, blankEvent(id, 'pending'));
    await f.repo.updateArenaRatingEventComputedFields({}, id, { aBefore: before, bBefore: before,
      aAfter: afterA, bAfter: afterB, deltaA: 20, deltaB: -20, detailsJson: {} });
    if (wasApplied) { Object.assign(f.ensure('strict', 'card-a'), afterA); Object.assign(f.ensure('strict', 'card-b'), afterB); }
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.events.get(id)).toMatchObject(wasApplied ? { status: 'applied' }
      : { status: 'skipped', skip_reason: 'strict-no-owned-combatant' });
    expect(f.ensure('strict', 'card-a').games).toBe(wasApplied ? 1 : 0);
    if (wasApplied) expect(vi.mocked(f.repo.applyArenaRatingsUpdateIfBothMatch).mock.calls[0]?.[5]).toBeNull();
    else expect(f.repo.applyArenaRatingsUpdateIfBothMatch).not.toHaveBeenCalled();
  });

  it.each(['entity-body-mismatch', 'entity-reference-unavailable', 'missing'] as const)('does not apply either queue for %s', async (reason) => {
    const f = await fixture();
    f.extra.ratingEntityBinding = reason === 'missing' ? undefined : { version: 1, status: 'unbound', reason };
    await settleArenaRatingsForGeneration('binding-test');
    for (const queue of ['strict', 'free']) expect(f.events.get(`binding-test:${queue}`)).toMatchObject({
      status: 'skipped', skip_reason: reason === 'missing' ? 'entity-binding-missing' : reason,
    });
    expect(f.repo.applyArenaRatingsUpdateIfBothMatch).not.toHaveBeenCalled();
    expect(f.repo.ensureArenaRatingsExist).not.toHaveBeenCalled();
  });

  it('applies both queues with one full-body/version guard per online participant', async () => {
    const f = await fixture();
    await settleArenaRatingsForGeneration('binding-test');
    for (const queue of ['strict', 'free']) expect(f.events.get(`binding-test:${queue}`)?.status).toBe('applied');
    const calls = vi.mocked(f.repo.applyArenaRatingsUpdateIfBothMatch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[5]).toEqual(f.rows.map((row) => ({ id: row.id, data: row.data, updatedAt: version, authorizedUserId: 42 })));
  });

  it.each(['content', 'version', 'order', 'same-entity'] as const)('rejects a changed %s even with a valid old binding', async (change) => {
    const f = await fixture();
    if (change === 'content') f.rows[0].data = JSON.stringify({ name: 'Different body at the same timestamp' });
    if (change === 'version') f.rows[0].updatedAt = 'changed';
    if (change === 'order') f.combatants.reverse();
    if (change === 'same-entity') f.combatants[1].data_card_id = 'card-a';
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.repo.applyArenaRatingsUpdateIfBothMatch).not.toHaveBeenCalled();
    expect([...f.events.values()].every((event) => event.status === 'skipped')).toBe(true);
  });

  it('keeps unsigned private owner cards and reading state/history eligible for Free', async () => {
    const f = await fixture(); f.snapshot.readArenaHistory = 1; f.snapshot.readCurrentState = 1;
    f.rows.forEach((row) => { row.isPublic = 0; });
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.events.get('binding-test:strict')).toBeUndefined();
    expect(f.events.get('binding-test:free')?.status).toBe('applied');
  });

  it('does not expose or score a private source to another authenticated owner', async () => {
    const f = await fixture(); f.rows[0].isPublic = 0; f.rows[0].userId = 99;
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.repo.applyArenaRatingsUpdateIfBothMatch).not.toHaveBeenCalled();
    expect(f.events.get('binding-test:free')?.skip_reason).toBe('entity-reference-unavailable');
  });

  it('reports an atomic source-CAS miss without applying a new rating', async () => {
    const f = await fixture(); vi.mocked(f.repo.applyArenaRatingsUpdateIfBothMatch).mockResolvedValue('identity-conflict');
    await settleArenaRatingsForGeneration('binding-test');
    expect([...f.events.values()].every((event) => event.skip_reason === 'entity-version-changed')).toBe(true);
    expect([...f.ratings.values()].every((rating) => rating.games === 0)).toBe(true);
  });

  it('preserves applied history without reading unavailable source cards again', async () => {
    const f = await fixture(); delete f.extra.ratingEntityBinding;
    for (const queue of ['strict', 'free']) f.events.set(`binding-test:${queue}`, blankEvent(`binding-test:${queue}`, 'applied'));
    vi.mocked(f.repo.getStrictQueueDataCardsByIds).mockRejectedValue(new Error('unavailable'));
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.repo.getStrictQueueDataCardsByIds).not.toHaveBeenCalled();
    expect([...f.events.values()].every((event) => event.status === 'applied')).toBe(true);
  });

  it.each([false, true])('only reconciles an old unbound pending event if its delta was already applied: %s', async (wasApplied) => {
    const f = await fixture(); delete f.extra.ratingEntityBinding; f.extra.arenaFreeRankingEnabled = false;
    const id = 'binding-test:strict'; f.events.set(id, blankEvent(id, 'pending'));
    await f.repo.updateArenaRatingEventComputedFields({}, id, { aBefore: before, bBefore: before,
      aAfter: afterA, bAfter: afterB, deltaA: 20, deltaB: -20, detailsJson: {} });
    if (wasApplied) { Object.assign(f.ensure('strict', 'card-a'), afterA); Object.assign(f.ensure('strict', 'card-b'), afterB); }
    await settleArenaRatingsForGeneration('binding-test');
    expect(f.events.get(id)?.status).toBe(wasApplied ? 'applied' : 'skipped');
    if (wasApplied) expect(vi.mocked(f.repo.applyArenaRatingsUpdateIfBothMatch).mock.calls[0]?.[5]).toBeNull();
    else expect(f.repo.applyArenaRatingsUpdateIfBothMatch).not.toHaveBeenCalled();
  });
});
