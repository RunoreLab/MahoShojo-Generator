import { describe, expect, test } from 'vitest';

import type {
  ChallengeNodeRecord,
  ChallengeNodeType,
  EncounterSnapshotV1,
  PlayerSnapshotV1,
  RunStateV1,
} from '@/lib/challenge/types';

const encodeSse = (event: string, payload: unknown) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

const createPlayerSnapshot = (): PlayerSnapshotV1 => ({
  version: 1,
  sourceType: 'local-card',
  sourceId: 'player-1',
  displayName: '雾灯',
  snapshotSeed: 'snapshot-a',
  strengthTier: 'common',
  baseTrackSnapshot: {
    hp: { current: 100, max: 100 },
    radiance: { current: 80, max: 100 },
    currency: { current: 20, max: null },
  },
  combatProfile: {},
  tags: ['谨慎'],
  promptSummary: '雾灯擅长观察窗口与节奏控制。',
});

const createRunState = (nodeType: ChallengeNodeType, overrides: Partial<RunStateV1> = {}): RunStateV1 => ({
  version: 1,
  runId: 'run-stream-1',
  worldPresetId: 'arena',
  runSeed: 'run-seed-stream',
  status: 'in_progress',
  playerSnapshot: createPlayerSnapshot(),
  worldState: {
    version: 1,
    schemaId: 'arena-v1',
    tracks: {
      hp: { current: 60, max: 100 },
      radiance: { current: 48, max: 100 },
      currency: { current: 18, max: null },
    },
    temporaryStatuses: ['exposed'],
    runFlags: [],
    persistentItemIds: [],
    consumableIds: [],
  },
  mapState: {
    version: 1,
    rootNodeId: 'ROOT',
    totalLayers: 2,
    bossNodeId: 'L2-N1',
    nodes: [
      {
        version: 1,
        nodeId: 'L1-N1',
        layer: 1,
        nodeType,
        visibility: 'focused',
        riskHint: 'mid',
        rewardHint: 'mid',
        encounterRef: `arena:${nodeType}:L1-N1`,
      },
    ],
    edges: [],
  },
  pendingRewardChoice: null,
  currentNodeId: 'L1-N1',
  visitedNodeCount: 0,
  checkpointSeq: 1,
  usedBootstrapReroll: false,
  startedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const createEncounter = (
  nodeType: Extract<ChallengeNodeType, 'battle' | 'elite' | 'boss'>,
): EncounterSnapshotV1 => ({
  version: 1,
  nodeId: 'L1-N1',
  templateId: `arena-${nodeType}-L1-N1`,
  kind: nodeType,
  inputMode: 'recommended-action-plus-free-intent',
  enemySnapshot: {
    version: 1,
    sourceType: 'preset',
    sourceId: 'enemy-1',
    displayName: '雪绒',
    strengthTier: nodeType === 'boss' ? 'boss' : nodeType === 'elite' ? 'elite' : 'common',
    combatProfile: {},
    tags: [nodeType],
    promptSummary: '对手擅长压迫与节奏争夺。',
  },
  rewardOptions: [],
  eventOptions: [],
  shopOffers: [],
});

const createEnteredNodeRecord = (encounter: EncounterSnapshotV1): ChallengeNodeRecord => ({
  id: 'node-entered-1',
  runId: 'run-stream-1',
  nodeId: encounter.nodeId,
  visitIndex: 1,
  nodeType: encounter.kind,
  status: 'entered',
  encounterSnapshot: encounter,
  playerInput: {
    recommendedActionId: 'bait-counter',
    optionId: '',
    note: '先观察，再抓反击窗口。',
  },
  resolverEnvelope: null,
  adjudicationResultDigest: null,
  storyText: null,
  createdAt: 10,
  resolvedAt: null,
});

describe('challenge stream resolution', () => {
  test('battle 节点会边显示 Markdown，结束后提取 adjudication meta 并写入 node record', async () => {
    const { runChallengeStreamResolution } = await import('@/components/challenge/hooks/useChallengeStreamResolution');

    const response = new Response(
      [
        encodeSse('markdown', { chunk: '雾灯先稳住脚步，观察雪绒的起手。\n\n' }),
        encodeSse('markdown', {
          chunk:
            '雾灯抓住了她换气时露出的空档，顺着窗口完成反制。\n<!-- MAHOSHOJO_ARENA_META {"version":1,"adjudication":{"outcome":"victory","trackDeltas":{"hp":-12,"radiance":-8},"addStatuses":[],"removeStatuses":["exposed"],"rewardOptionId":null,"summary":"雾灯稳稳拿下战局。"}} -->',
        }),
        encodeSse('done', { ok: true }),
      ].join(''),
      {
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      }
    );

    const streamedTexts: string[] = [];
    const encounter = createEncounter('battle');

    const result = await runChallengeStreamResolution({
      response,
      runState: createRunState('battle'),
      encounter,
      playerInput: {
        recommendedActionId: 'bait-counter',
        note: '先观察，再抓反击窗口。',
      },
      baseNodeRecord: createEnteredNodeRecord(encounter),
      onText: (text) => streamedTexts.push(text),
    });

    expect(streamedTexts.length).toBeGreaterThan(0);
    expect(streamedTexts.at(-1)).toContain('雾灯抓住了她换气时露出的空档');
    expect(streamedTexts.at(-1)?.includes('MAHOSHOJO_ARENA_META')).toBe(false);
    expect(result.storyMarkdown).toContain('雾灯抓住了她换气时露出的空档');
    expect(result.storyMarkdown.includes('MAHOSHOJO_ARENA_META')).toBe(false);
    expect(result.adjudication.outcome).toBe('victory');
    expect(result.nodeRecord.storyText).not.toContain('MAHOSHOJO_ARENA_META');
    expect(result.nodeRecord.resolverEnvelope).toBeTruthy();
  });

  test('runChallengeStreamResolution 会把 signal 透传给 fetcher', async () => {
    const { runChallengeStreamResolution } = await import('@/components/challenge/hooks/useChallengeStreamResolution');

    const controller = new AbortController();
    const encounter = createEncounter('battle');
    let receivedSignal: AbortSignal | null = null;

    await runChallengeStreamResolution({
      runState: createRunState('battle'),
      encounter,
      playerInput: {
        recommendedActionId: 'bait-counter',
        note: '先观察，再抓反击窗口。',
      },
      baseNodeRecord: createEnteredNodeRecord(encounter),
      signal: controller.signal,
      fetcher: async (_input, init) => {
        receivedSignal = init?.signal ?? null;
        return new Response(
          [
            encodeSse('markdown', {
              chunk:
                '雾灯顺着雪绒的呼吸差切入。\n<!-- MAHOSHOJO_ARENA_META {"version":1,"adjudication":{"outcome":"victory","trackDeltas":{"hp":-10,"radiance":-6},"addStatuses":[],"removeStatuses":["exposed"],"rewardOptionId":null,"summary":"雾灯稳稳收下胜势。"}} -->',
            }),
            encodeSse('done', { ok: true }),
          ].join(''),
          {
            headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          }
        );
      },
    });

    expect(receivedSignal).toBe(controller.signal);
  });

  test('runChallengeStreamResolution 会把 customProvider 透传给挑战裁定接口', async () => {
    const { runChallengeStreamResolution } = await import('@/components/challenge/hooks/useChallengeStreamResolution');

    const encounter = createEncounter('battle');
    let receivedBody: Record<string, unknown> | null = null;

    await runChallengeStreamResolution({
      runState: createRunState('battle'),
      encounter,
      playerInput: {
        recommendedActionId: 'advance-pressure',
        note: '主动前压，试探对方换招节奏。',
      },
      baseNodeRecord: createEnteredNodeRecord(encounter),
      customProvider: {
        providerId: 'system',
        modelId: 'gemini-2.5-flash',
        apiKey: '',
      },
      fetcher: async (_input, init) => {
        receivedBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          [
            encodeSse('markdown', {
              chunk:
                '雾灯抓住先手持续施压。\n<!-- MAHOSHOJO_ARENA_META {"version":1,"adjudication":{"outcome":"victory","trackDeltas":{"hp":-8,"radiance":-5},"addStatuses":[],"removeStatuses":["exposed"],"rewardOptionId":null,"summary":"雾灯抢下了节奏。"}} -->',
            }),
            encodeSse('done', { ok: true }),
          ].join(''),
          {
            headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          }
        );
      },
    });

    expect(receivedBody?.customProvider).toEqual({
      providerId: 'system',
      modelId: 'gemini-2.5-flash',
      apiKey: '',
    });
  });

  test('resolveChallengeNodeWithStreamingFallback 会在流式请求失败时回退到本地系统结算', async () => {
    const { resolveChallengeNodeWithStreamingFallback } = await import(
      '@/components/challenge/hooks/useChallengeStreamResolution'
    );

    const encounter = createEncounter('battle');
    const streamErrors: string[] = [];

    const result = await resolveChallengeNodeWithStreamingFallback({
      runState: createRunState('battle'),
      encounter,
      playerInput: {
        recommendedActionId: 'bait-counter',
        note: '先观察，再抓反击窗口。',
      },
      baseNodeRecord: createEnteredNodeRecord(encounter),
      fetcher: async () => {
        throw new Error('network unavailable');
      },
      onStreamError: (error) => {
        streamErrors.push(error.message);
      },
    });

    expect(result.finalSource).toBe('system-fallback');
    expect(result.fallbackReason).toBe('network unavailable');
    expect(result.storyMarkdown).toContain('雾灯');
    expect(result.storyMarkdown.includes('MAHOSHOJO_ARENA_META')).toBe(false);
    expect(result.nodeRecord.storyText).toBe(result.storyMarkdown);
    expect(streamErrors).toEqual(['network unavailable']);
  });

  test('choice-only 事件继续走本地 effect patch，choice-plus-note / free-intent 才走流式裁定', async () => {
    const { resolveNodeExecutionMode } = await import('@/components/challenge/hooks/useChallengeStreamResolution');

    const choiceOnlyEvent: EncounterSnapshotV1 = {
      version: 1,
      nodeId: 'event-choice-only',
      templateId: 'arena-event-choice-only',
      kind: 'event',
      inputMode: 'choice-only',
      enemySnapshot: null,
      rewardOptions: [],
      eventOptions: [],
      shopOffers: [],
    };
    const choicePlusNoteEvent: EncounterSnapshotV1 = {
      ...choiceOnlyEvent,
      nodeId: 'event-choice-plus-note',
      templateId: 'arena-event-choice-plus-note',
      inputMode: 'choice-plus-note',
    };
    const freeIntentEvent: EncounterSnapshotV1 = {
      ...choiceOnlyEvent,
      nodeId: 'event-free-intent',
      templateId: 'arena-event-free-intent',
      inputMode: 'free-intent',
    };

    expect(resolveNodeExecutionMode(choiceOnlyEvent)).toBe('system');
    expect(resolveNodeExecutionMode(choicePlusNoteEvent)).toBe('ai');
    expect(resolveNodeExecutionMode(freeIntentEvent)).toBe('ai');
    expect(resolveNodeExecutionMode(createEncounter('battle'))).toBe('ai');
  });
});
