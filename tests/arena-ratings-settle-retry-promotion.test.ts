import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

type Queue = 'strict' | 'free';
type EntityType = 'data_card' | 'preset';
type EventStatus = 'pending' | 'applied' | 'skipped' | 'failed';

type Entity = {
  entityType: EntityType;
  entityId: string;
};

type RatingSnapshot = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

type EventRow = {
  id: string;
  status: EventStatus;
  skip_reason: string | null;
  details_json: string | null;
  a_before_rating: number | null;
  a_after_rating: number | null;
  a_delta: number | null;
  a_before_games: number | null;
  a_after_games: number | null;
  b_before_rating: number | null;
  b_after_rating: number | null;
  b_delta: number | null;
  b_before_games: number | null;
  b_after_games: number | null;
};

type CombatantRow = {
  generation_id: string;
  sort_index: number;
  name: string;
  type: string | null;
  template_id: string | null;
  is_native: number | null;
  is_preset: number | null;
  team_id: number | null;
  character_guidance: string | null;
  data_card_id: string | null;
  data_card_updated_at: string | null;
  size_chars: number | null;
  size_bytes: number | null;
  created_at: string;
};

type QueueEntityKey = `${Queue}:${EntityType}:${string}`;

const queueEntityKey = (queue: Queue, entity: Entity): QueueEntityKey => `${queue}:${entity.entityType}:${entity.entityId}`;

const cloneEvent = (event: EventRow): EventRow => ({ ...event });

const state = {
  generationId: 'gen_retry_promotion',
  eventId: '',
  applyCalls: 0,
  updateComputedCalls: 0,
  firstApplyShouldThrow: true,
  promotionRecoveredByAlreadyApplied: false,
  events: new Map<string, EventRow>(),
  ratings: new Map<QueueEntityKey, RatingSnapshot>(),
};

const buildSnapshot = () => ({
  status: 'completed',
  mode: 'classic',
  userId: 9527,
  ipAnonymized: '203.0.113.7',
  language: 'zh-CN',
  selectedLevel: null,
  hasScenario: 0,
  hasUserGuidance: 0,
  userGuidancePreview: null,
  hasAdjudicationEvents: 0,
  readArenaHistory: 0,
  readCurrentState: 0,
  combatantCount: 2,
  winner: '甲',
  extraJson: JSON.stringify({
    readNarrativeHistory: false,
    narrativeHistoryReadCount: 0,
    rankedMatchOk: true,
    arenaFreeRankingEnabled: false,
  }),
});

const buildCombatants = (): CombatantRow[] => [
  {
    generation_id: state.generationId,
    sort_index: 0,
    name: '甲',
    type: 'character',
    template_id: null,
    is_native: 1,
    is_preset: 0,
    team_id: null,
    character_guidance: null,
    data_card_id: 'card_a',
    data_card_updated_at: null,
    size_chars: null,
    size_bytes: null,
    created_at: '2026-03-25T00:00:00.000Z',
  },
  {
    generation_id: state.generationId,
    sort_index: 1,
    name: '乙',
    type: 'character',
    template_id: null,
    is_native: 1,
    is_preset: 0,
    team_id: null,
    character_guidance: null,
    data_card_id: 'card_b',
    data_card_updated_at: null,
    size_chars: null,
    size_bytes: null,
    created_at: '2026-03-25T00:00:00.000Z',
  },
];

const ensureRating = (queue: Queue, entity: Entity): RatingSnapshot => {
  const key = queueEntityKey(queue, entity);
  const existing = state.ratings.get(key);
  if (existing) return existing;
  const created: RatingSnapshot = { rating: 1000, games: 0, wins: 0, losses: 0, draws: 0 };
  state.ratings.set(key, created);
  return created;
};

const mockRepo = {
  resetStrictArenaRatingForDataCard: async () => {},
  countStrictAppliedEventsSince: async () => 0,
  getStrictUserPairAppliedStatsSince: async () => ({ pairUsedToday: 0, latestAppliedAt: null }),
  getStrictQueueDataCardsByIds: async () => [],
  getArenaEligibilitySnapshotByGenerationId: async () => buildSnapshot(),
  listGenerationCombatantsByGenerationId: async () => buildCombatants(),
  ensureArenaRatingsExist: async (
    _db: unknown,
    queue: Queue,
    entities: [Entity, Entity],
  ) => {
    ensureRating(queue, entities[0]);
    ensureRating(queue, entities[1]);
  },
  getArenaRatingsByEntitiesForQueue: async (
    _db: unknown,
    queue: Queue,
    entities: [Entity, Entity],
  ) => {
    const a = ensureRating(queue, entities[0]);
    const b = ensureRating(queue, entities[1]);
    return [
      { ...entities[0], ...a },
      { ...entities[1], ...b },
    ];
  },
  hasRecentAppliedEventForPair: async () => false,
  insertArenaRatingEvent: async (
    _db: unknown,
    payload: {
      id: string;
      status: EventStatus;
      detailsJson?: Record<string, unknown> | null;
    },
  ) => {
    if (state.events.has(payload.id)) return false;
    state.events.set(payload.id, {
      id: payload.id,
      status: payload.status,
      skip_reason: null,
      details_json: payload.detailsJson ? JSON.stringify(payload.detailsJson) : null,
      a_before_rating: null,
      a_after_rating: null,
      a_delta: null,
      a_before_games: null,
      a_after_games: null,
      b_before_rating: null,
      b_after_rating: null,
      b_delta: null,
      b_before_games: null,
      b_after_games: null,
    });
    return true;
  },
  getArenaRatingEventById: async (_db: unknown, eventId: string) => {
    const event = state.events.get(eventId);
    return event ? cloneEvent(event) : null;
  },
  updateArenaRatingEventComputedFields: async (
    _db: unknown,
    eventId: string,
    computed: {
      aBefore: RatingSnapshot;
      aAfter: RatingSnapshot;
      deltaA: number;
      bBefore: RatingSnapshot;
      bAfter: RatingSnapshot;
      deltaB: number;
      detailsJson: Record<string, unknown>;
    },
  ) => {
    const event = state.events.get(eventId);
    if (!event || event.status !== 'pending') return false;
    state.updateComputedCalls += 1;
    event.a_before_rating = computed.aBefore.rating;
    event.a_after_rating = computed.aAfter.rating;
    event.a_delta = computed.deltaA;
    event.a_before_games = computed.aBefore.games;
    event.a_after_games = computed.aAfter.games;
    event.b_before_rating = computed.bBefore.rating;
    event.b_after_rating = computed.bAfter.rating;
    event.b_delta = computed.deltaB;
    event.b_before_games = computed.bBefore.games;
    event.b_after_games = computed.bAfter.games;
    event.details_json = JSON.stringify(computed.detailsJson);
    return true;
  },
  markArenaRatingEventApplied: async (_db: unknown, eventId: string) => {
    const event = state.events.get(eventId);
    if (!event) return;
    event.status = 'applied';
  },
  markArenaRatingEventStatus: async (
    _db: unknown,
    eventId: string,
    status: EventStatus,
    options?: { skipReason?: string | null },
  ) => {
    const event = state.events.get(eventId);
    if (!event) return;
    event.status = status;
    if (options && Object.prototype.hasOwnProperty.call(options, 'skipReason')) {
      event.skip_reason = options.skipReason ?? null;
    }
  },
  applyArenaRatingsUpdateIfBothMatch: async (
    _db: unknown,
    queue: Queue,
    entities: [Entity, Entity],
    computed: {
      aBefore: RatingSnapshot;
      bBefore: RatingSnapshot;
      aAfter: RatingSnapshot;
      bAfter: RatingSnapshot;
    },
  ) => {
    state.applyCalls += 1;
    const a = ensureRating(queue, entities[0]);
    const b = ensureRating(queue, entities[1]);

    if (state.firstApplyShouldThrow) {
      a.rating = computed.aAfter.rating;
      a.games = computed.aAfter.games;
      a.wins = computed.aAfter.wins;
      a.losses = computed.aAfter.losses;
      a.draws = computed.aAfter.draws;
      b.rating = computed.bAfter.rating;
      b.games = computed.bAfter.games;
      b.wins = computed.bAfter.wins;
      b.losses = computed.bAfter.losses;
      b.draws = computed.bAfter.draws;
      state.firstApplyShouldThrow = false;
      throw new Error('promotion failed once');
    }

    const alreadyApplied =
      a.rating === computed.aAfter.rating &&
      a.games === computed.aAfter.games &&
      b.rating === computed.bAfter.rating &&
      b.games === computed.bAfter.games;
    if (alreadyApplied) {
      state.promotionRecoveredByAlreadyApplied = true;
      return 'already-applied' as const;
    }

    const matchesBefore =
      a.rating === computed.aBefore.rating &&
      a.games === computed.aBefore.games &&
      b.rating === computed.bBefore.rating &&
      b.games === computed.bBefore.games;
    if (!matchesBefore) return 'conflict' as const;

    a.rating = computed.aAfter.rating;
    a.games = computed.aAfter.games;
    a.wins = computed.aAfter.wins;
    a.losses = computed.aAfter.losses;
    a.draws = computed.aAfter.draws;
    b.rating = computed.bAfter.rating;
    b.games = computed.bAfter.games;
    b.wins = computed.bAfter.wins;
    b.losses = computed.bAfter.losses;
    b.draws = computed.bAfter.draws;
    return 'applied' as const;
  },
};

describe('settleArenaRatingsForGeneration retry promotion recovery', () => {
  const originalConsoleError = console.error;

  beforeEach(async () => {
    const { setArenaRatingsRepoBundleForTests } = await import('@/lib/database/arena-ratings');
    console.error = () => {};
    state.eventId = `${state.generationId}:strict`;
    state.applyCalls = 0;
    state.updateComputedCalls = 0;
    state.firstApplyShouldThrow = true;
    state.promotionRecoveredByAlreadyApplied = false;
    state.events.clear();
    state.ratings.clear();
    setArenaRatingsRepoBundleForTests({
      db: { __mockDb: true },
      ...mockRepo,
    });
  });

  test('pending 事件重试时即使当前已在 after，也必须走 already-applied 仓储更新以补 promotion', async () => {
    const { settleArenaRatingsForGeneration } = await import('@/lib/database/arena-ratings');

    await settleArenaRatingsForGeneration(state.generationId);

    const firstEvent = state.events.get(state.eventId);
    expect(firstEvent).toBeTruthy();
    expect(firstEvent?.status).toBe('pending');
    expect(state.applyCalls).toBe(1);
    expect(state.updateComputedCalls).toBe(1);
    expect(firstEvent?.a_before_rating).toBe(1000);
    expect(firstEvent?.a_after_rating).toBe(1020);
    expect(firstEvent?.a_before_games).toBe(0);
    expect(firstEvent?.a_after_games).toBe(1);

    const auditSnapshotAfterFirst = cloneEvent(firstEvent!);

    await settleArenaRatingsForGeneration(state.generationId);

    const secondEvent = state.events.get(state.eventId);
    expect(secondEvent?.status).toBe('applied');
    expect(state.applyCalls).toBe(2);
    expect(state.promotionRecoveredByAlreadyApplied).toBeTrue();
    expect(state.updateComputedCalls).toBe(1);
    expect(secondEvent?.a_before_rating).toBe(auditSnapshotAfterFirst.a_before_rating);
    expect(secondEvent?.a_after_rating).toBe(auditSnapshotAfterFirst.a_after_rating);
    expect(secondEvent?.b_before_rating).toBe(auditSnapshotAfterFirst.b_before_rating);
    expect(secondEvent?.b_after_rating).toBe(auditSnapshotAfterFirst.b_after_rating);
  });

  afterAll(async () => {
    console.error = originalConsoleError;
    const { setArenaRatingsRepoBundleForTests } = await import('@/lib/database/arena-ratings');
    setArenaRatingsRepoBundleForTests(null);
  });
});
