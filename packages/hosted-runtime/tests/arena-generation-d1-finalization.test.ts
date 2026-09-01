import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

import {
  createNodeArenaGenerationFinalizationPorts,
  createNodeArenaRejectedTerminalRecorder,
  createNodeArenaGenerationTerminalStore,
  MAX_ARENA_TERMINAL_COMBATANTS,
  MAX_ARENA_TERMINAL_EXTRA_JSON_BYTES,
} from '../src/arena-generation/d1-finalization';
import * as arenaD1Finalization from '../src/arena-generation/d1-finalization';
import type { NodeDataD1Client } from '../src/node-runtime/data-ports';
import type { ArenaGenerationRejectedTerminalRecordInput } from '@mahoshojo/hosted-api/arena-generation/service';

type SQLiteStatement = {
  all(..._parameters: unknown[]): Record<string, unknown>[];
  run(..._parameters: unknown[]): { changes: bigint | number };
};

type SQLiteDatabase = {
  close(): void;
  exec(_sql: string): void;
  prepare(_sql: string): SQLiteStatement;
};

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (_location: string) => SQLiteDatabase;
};

const result = (
  results: Record<string, unknown>[] = [],
  changes = 0,
) => ({ success: true, results, meta: { changes } });

const sequentialD1 = (
  steps: Array<ReturnType<typeof result> | Error>,
): NodeDataD1Client & { boundCalls: unknown[][] } => {
  const boundCalls: unknown[][] = [];
  return {
  boundCalls,
  prepare: vi.fn((sql: string) => {
    let params: unknown[] = [];
    return {
      bind(...next: unknown[]) {
        params = next;
        boundCalls.push(next);
        return this;
      },
      run: vi.fn(async () => {
        expect(params).toHaveLength((sql.match(/\?/gu) ?? []).length);
        const step = steps.shift() ?? result();
        if (step instanceof Error) throw step;
        return step;
      }),
      all: vi.fn(async () => {
        expect(params).toHaveLength((sql.match(/\?/gu) ?? []).length);
        const step = steps.shift() ?? result();
        if (step instanceof Error) throw step;
        return step;
      }),
    };
  }),
  };
};

const sqliteD1 = (database: SQLiteDatabase): NodeDataD1Client => ({
  prepare(sql) {
    const statement = database.prepare(sql);
    let parameters: unknown[] = [];
    const adapter = {
      bind(...nextParameters: unknown[]) {
        parameters = nextParameters;
        return adapter;
      },
      async all() {
        return result(statement.all(...parameters as never[]) as Record<string, unknown>[]);
      },
      async run() {
        const execution = statement.run(...parameters as never[]);
        return result([], Number(execution.changes));
      },
    };
    return adapter;
  },
});

const claimInput = {
  generationId: 'generation-1',
  generationRequestId: 'request-1',
  payloadHash: 'payload-hash-1',
  actorKey: 'user:42',
  payload: {
    mode: 'classic',
    language: 'zh-CN',
    combatants: [
      { roomCombatantKey: 'data-card:character-a', type: 'magical-girl', data: { name: 'A' } },
      { roomCombatantKey: 'host-local:character:1:b', type: 'magical-girl', data: { name: 'B' } },
    ],
  },
  metadata: {
    streamMeta: { report: { headline: '战报标题', winner: 'A' } },
  },
  markdown: '# 战报标题\n\n## 胜利者\nA',
  telemetry: { model: 'model-1', usage: { totalTokens: 9 } },
  status: 'completed' as const,
  errorCode: null,
  resultRef: 'r2:v1/battle-report-generations/generation-1/output.md',
};

const rejectedInput: ArenaGenerationRejectedTerminalRecordInput = {
  generationId: 'generation-rejected-1',
  generationRequestId: 'pvp_request_1234',
  actorKey: 'user:42',
  payloadHash: 'payload-hash-rejected-1',
  code: 'ARENA_CONTENT_POLICY_REJECTED',
  stage: 'safety-policy',
  endpoint: 'api/generate-battle-story',
  generationMode: 'non-stream',
  startedAt: '2026-08-25T03:59:59.000Z',
  mode: 'classic',
  pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
};

describe('Arena D1/R2 finalization ports', () => {
  it('records a bounded failed PVP rejection without success-side-effect data', async () => {
    const client = sequentialD1([result([], 1)]);
    const recorder = createNodeArenaRejectedTerminalRecorder({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });

    await expect(recorder.record({
      ...rejectedInput,
      customProviderApiKey: 'must-not-enter-d1',
      sensitiveText: 'must-not-enter-d1',
      authoritySignature: 'must-not-enter-d1-signature',
      rawPayload: { prompt: 'must-not-enter-d1-raw-payload' },
    } as ArenaGenerationRejectedTerminalRecordInput)).resolves.toEqual({ kind: 'recorded' });

    const insertSql = vi.mocked(client.prepare).mock.calls[0]?.[0] ?? '';
    expect(insertSql).toContain('INSERT OR IGNORE INTO battle_report_generations');
    const columns = insertSql
      .match(/battle_report_generations\s*\(([\s\S]*?)\)\s*VALUES/u)?.[1]
      ?.split(',')
      .map((column) => column.trim()) ?? [];
    expect(columns).toEqual(expect.arrayContaining([
      'id',
      'started_at',
      'ended_at',
      'duration_ms',
      'status',
      'generation_mode',
      'endpoint',
      'mode',
      'created_at',
      'updated_at',
    ]));
    expect(client.prepare).not.toHaveBeenCalledWith(expect.stringContaining(
      'battle_report_generation_combatants',
    ));
    const serialized = JSON.stringify(client.boundCalls);
    expect(serialized).not.toContain('must-not-enter-d1');
    expect(serialized).not.toContain('must-not-enter-d1-signature');
    expect(serialized).not.toContain('must-not-enter-d1-raw-payload');
    expect(serialized).toContain('ARENA_CONTENT_POLICY_REJECTED');
    expect(serialized).toContain('safety-policy');
    expect(serialized).toContain('room-1');
  });

  it('reconciles duplicate and indeterminate rejected-terminal inserts by identity', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rejectedInput.actorKey),
    ).then((bytes) => Array.from(
      new Uint8Array(bytes),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join(''));
    const stored = {
      id: rejectedInput.generationId,
      status: 'failed',
      extra_json: JSON.stringify({
        generationRequestId: rejectedInput.generationRequestId,
        generationOwnerHash: ownerHash,
        generationPayloadHash: rejectedInput.payloadHash,
        generationTerminalStatus: 'failed',
        finalizationCompleted: true,
        rejectedBeforeProvider: true,
      }),
    };
    const duplicateClient = sequentialD1([result([], 0), result([stored])]);
    const indeterminateClient = sequentialD1([
      new Error('D1_TRANSPORT_TIMEOUT'),
      result([stored]),
    ]);

    await expect(createNodeArenaRejectedTerminalRecorder({
      getD1Client: () => duplicateClient,
    }).record(rejectedInput)).resolves.toEqual({ kind: 'recorded' });
    await expect(createNodeArenaRejectedTerminalRecorder({
      getD1Client: () => indeterminateClient,
    }).record(rejectedInput)).resolves.toEqual({ kind: 'recorded' });
  });

  it('reports an identity mismatch instead of reusing a conflicting rejected terminal', async () => {
    const client = sequentialD1([
      result([], 0),
      result([{
        id: rejectedInput.generationId,
        status: 'failed',
        extra_json: JSON.stringify({
          generationRequestId: rejectedInput.generationRequestId,
          generationOwnerHash: 'different-owner',
          generationPayloadHash: 'different-payload',
          generationTerminalStatus: 'failed',
          finalizationCompleted: true,
          rejectedBeforeProvider: true,
        }),
      }]),
    ]);
    const recorder = createNodeArenaRejectedTerminalRecorder({ getD1Client: () => client });

    await expect(recorder.record(rejectedInput)).resolves.toEqual({ kind: 'conflict' });
  });

  it('does not reinterpret an existing successful generation as the rejected terminal', async () => {
    const client = sequentialD1([
      result([], 0),
      result([{
        id: rejectedInput.generationId,
        status: 'completed',
        extra_json: JSON.stringify({
          generationRequestId: rejectedInput.generationRequestId,
          generationOwnerHash: await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(rejectedInput.actorKey),
          ).then((bytes) => Array.from(
            new Uint8Array(bytes),
            (byte) => byte.toString(16).padStart(2, '0'),
          ).join('')),
          generationPayloadHash: rejectedInput.payloadHash,
          generationTerminalStatus: 'completed',
          finalizationCompleted: true,
        }),
      }]),
    ]);
    const recorder = createNodeArenaRejectedTerminalRecorder({ getD1Client: () => client });

    await expect(recorder.record(rejectedInput)).resolves.toEqual({ kind: 'conflict' });
  });

  it('uses server-derived companion endpoint and delivery mode in generation audit rows', async () => {
    const client = sequentialD1([result([], 1)]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });

    await ports.claimTerminal({
      ...claimInput,
      payload: {
        ...claimInput.payload,
        __arenaServerContextV1: {
          endpoint: 'api/generate-battle-story',
          deliveryMode: 'non-stream',
        },
      },
    });

    expect(client.boundCalls[0]?.[5]).toBe('non-stream');
    expect(client.boundCalls[0]?.[6]).toBe('api/generate-battle-story');
  });

  it('indexes structured non-stream JSON without relying on Markdown headings', async () => {
    const client = sequentialD1([result([], 1)]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });
    const structured = {
      headline: '原生 JSON 战报',
      article: { body: '正文', analysis: '点评' },
      officialReport: { winner: '角色B', conclusion: '结论' },
      impacts: [{ characterName: '角色B', impact: '成长' }],
    };

    await ports.claimTerminal({
      ...claimInput,
      payload: {
        ...claimInput.payload,
        writeArenaHistory: true,
        writeCurrentState: false,
        __arenaServerContextV1: {
          endpoint: 'api/arena/generate',
          deliveryMode: 'non-stream',
        },
      },
      metadata: { outputContract: 'structured-report' },
      markdown: JSON.stringify(structured),
    });

    expect(client.boundCalls[0]?.[33]).toBe(structured.headline);
    expect(client.boundCalls[0]?.[34]).toBe(structured.officialReport.winner);
    const extraJson = client.boundCalls[0]?.[44];
    expect(extraJson).toEqual(expect.any(String));
    expect(JSON.parse(extraJson as string).localCardReconciliation).toMatchObject({
      report: {
        headline: structured.headline,
        officialReport: { winner: structured.officialReport.winner },
      },
      impacts: structured.impacts,
    });
  });

  it.each([
    ['stream', 'api/arena/generate-stream', 'stream-markdown'],
    ['non-stream', 'api/arena/generate', 'structured-report'],
  ] as const)('persists the %s render snapshot without rerolling or leaking undeclared metadata', async (
    _label,
    endpoint,
    outputContract,
  ) => {
    const client = sequentialD1([result([], 1)]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });
    const adjudicationResults = [{
      depth: 0,
      description: '攻击是否命中？',
      type: 'binary',
      roll: 42,
      outcome: '成功',
      details: '掷骰(42) vs 成功率(65%)',
    }];

    await ports.claimTerminal({
      ...claimInput,
      payload: {
        ...claimInput.payload,
        __arenaServerContextV1: {
          endpoint,
          deliveryMode: outputContract === 'structured-report' ? 'non-stream' : 'stream',
        },
      },
      metadata: {
        outputContract,
        reporterInfo: { name: '测试记者', publication: 'A.R.E.N.A.' },
        userGuidance: '保持克制',
        characterGuidances: [{ characterName: '角色甲', guidance: '保护队友' }],
        adjudicationResults,
        narrativeHistoryReadCount: 3,
        rawReasoning: 'must-not-enter-render-snapshot',
        apiKey: 'must-not-enter-render-snapshot',
      },
    });

    const serializedExtra = client.boundCalls
      .flat()
      .find((value) => typeof value === 'string' && value.includes('generationOwnerHash'));
    expect(serializedExtra).toEqual(expect.any(String));
    const extra = JSON.parse(serializedExtra as string);
    expect(extra.battleReportRenderSnapshotV1).toEqual({
      version: 1,
      reporterInfo: { name: '测试记者', publication: 'A.R.E.N.A.' },
      userGuidance: '保持克制',
      characterGuidances: [{ characterName: '角色甲', guidance: '保护队友' }],
      adjudicationResults,
      narrativeHistoryReadCount: 3,
    });
    expect(extra.combatantsFallback.map((entry: Record<string, unknown>) => (
      entry.roomCombatantKey
    ))).toEqual(['data-card:character-a', 'host-local:character:1:b']);
    expect(JSON.stringify(extra.battleReportRenderSnapshotV1)).not.toContain('must-not-enter-render-snapshot');
  });

  it('writes PVP columns only from the trusted server context', async () => {
    const unsignedClient = sequentialD1([result([], 1)]);
    const unsignedPorts = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => unsignedClient,
    });
    await unsignedPorts.claimTerminal({
      ...claimInput,
      payload: {
        ...claimInput.payload,
        pvpContext: { roomId: 'forged-room', matchId: 'forged-match', roundId: 'forged-round' },
      },
    });
    expect(unsignedClient.boundCalls[0]?.slice(15, 18)).toEqual([null, null, null]);

    const trustedClient = sequentialD1([result([], 1)]);
    const trustedPorts = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => trustedClient,
    });
    await trustedPorts.claimTerminal({
      ...claimInput,
      payload: {
        ...claimInput.payload,
        pvpContext: { roomId: 'forged-room', matchId: 'forged-match', roundId: 'forged-round' },
        __arenaServerContextV1: {
          trustedPvpContext: {
            roomId: 'trusted-room',
            matchId: 'trusted-match',
            roundId: 'trusted-round',
          },
        },
      },
    });
    expect(trustedClient.boundCalls[0]?.slice(15, 18)).toEqual([
      'trusted-room',
      'trusted-match',
      'trusted-round',
    ]);
  });

  it('claims the D1 terminal row with INSERT OR IGNORE and distinguishes retries', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('user:42'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const stored = {
      id: 'generation-1',
      status: 'completed',
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        generationPayloadHash: 'payload-hash-1',
        finalizationCompleted: true,
        resultRef: claimInput.resultRef,
      }),
    };
    const client = sequentialD1([
      result([], 1),
      result([], 0),
      result([stored]),
    ]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });

    await expect(ports.claimTerminal(claimInput)).resolves.toEqual({
      kind: 'created',
      resultRef: claimInput.resultRef,
      finalized: false,
    });
    await expect(ports.claimTerminal(claimInput)).resolves.toEqual({
      kind: 'existing',
      resultRef: claimInput.resultRef,
      finalized: true,
    });
    expect(client.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
  });

  it('does not persist failed terminal markdown as D1 preview or output metrics', async () => {
    const client = sequentialD1([result([], 1)]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });
    const failedMarkdown = 'failed terminal body must not enter D1 preview';

    await ports.claimTerminal({
      ...claimInput,
      status: 'failed',
      errorCode: 'ARENA_R2_STORAGE_FAILED',
      resultRef: null,
      markdown: failedMarkdown,
    });

    expect(JSON.stringify(client.boundCalls)).not.toContain(failedMarkdown);
  });

  it('stops writing completed terminal Markdown into the D1 output preview', async () => {
    const client = sequentialD1([result([], 1)]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });

    await ports.claimTerminal(claimInput);

    const insertSql = vi.mocked(client.prepare).mock.calls[0]?.[0] ?? '';
    const columns = insertSql
      .match(/battle_report_generations\s*\(([\s\S]*?)\)\s*VALUES/u)?.[1]
      ?.split(',')
      .map((column) => column.trim()) ?? [];
    const outputPreviewIndex = columns.indexOf('output_preview');
    expect(outputPreviewIndex).toBeGreaterThan(-1);
    expect(client.boundCalls[0]?.[outputPreviewIndex]).toBeNull();
  });

  it('reconciles an indeterminate INSERT error before reporting terminal failure', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('user:42'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([
      new Error('D1_TRANSPORT_TIMEOUT'),
      result([{
        id: 'generation-1',
        status: 'completed',
        extra_json: JSON.stringify({
          generationRequestId: 'request-1',
          generationOwnerHash: ownerHash,
          generationPayloadHash: 'payload-hash-1',
          finalizationCompleted: true,
          resultRef: claimInput.resultRef,
        }),
      }]),
    ]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });

    await expect(ports.claimTerminal(claimInput)).resolves.toEqual({
      kind: 'existing',
      resultRef: claimInput.resultRef,
      finalized: true,
    });
  });

  it('stores the full terminal object and indexes the deterministic R2 key', async () => {
    const put = vi.fn(async () => ({ bytes: 4, storedBytes: 4, contentEncoding: null }));
    const client = sequentialD1([result([], 1)]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
      objectStore: { put, getText: vi.fn() },
    });

    await expect(ports.storeOutput({
      generationId: 'generation-1',
      actorKey: 'user:42',
      markdown: 'body',
      contentType: 'text/markdown; charset=utf-8',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      resultRef: 'r2:v1/battle-report-generations/generation-1/output.md',
    });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      key: 'v1/battle-report-generations/generation-1/output.md',
      body: 'body',
      contentType: 'text/markdown; charset=utf-8',
    }));
    expect(client.prepare).toHaveBeenCalledWith(expect.stringContaining('large_objects'));
  });

  it('keeps local card bodies out of the bounded D1 reconciliation manifest', async () => {
    const client = sequentialD1([result([], 1)]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });

    await ports.claimTerminal({
      ...claimInput,
      payload: {
        ...claimInput.payload,
        combatants: [{
          type: 'magical-girl',
          isNative: false,
          data: { name: 'A', privateLocalCardBody: 'must-not-enter-d1-extra-json' },
        }],
      },
    });

    const serializedExtra = client.boundCalls
      .flat()
      .find((value) => typeof value === 'string' && value.includes('localCardReconciliation'));
    expect(serializedExtra).toEqual(expect.any(String));
    expect(serializedExtra).not.toContain('must-not-enter-d1-extra-json');
    expect(serializedExtra).not.toContain('updatedCombatants');
  });

  it('bounds the existing D1 terminal manifest and combatant rows under adversarial input', async () => {
    const client = sequentialD1(Array.from(
      { length: MAX_ARENA_TERMINAL_COMBATANTS + 1 },
      () => result([], 1),
    ));
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });
    const combatants = Array.from({ length: MAX_ARENA_TERMINAL_COMBATANTS + 20 }, (_, index) => ({
      type: `type-${index}-${'x'.repeat(2_000)}`,
      filename: `template-${index}-${'x'.repeat(2_000)}`,
      sourceDataCardId: `card-${index}-${'x'.repeat(2_000)}`,
      sourceDataCardUpdatedAt: `revision-${index}-${'x'.repeat(2_000)}`,
      characterGuidance: 'x'.repeat(5_000),
      data: { name: `combatant-${index}-${'x'.repeat(5_000)}` },
    }));
    const oversizedInput = {
      ...claimInput,
      payload: {
        ...claimInput.payload,
        combatants,
        questionnaireLoreIds: Array.from({ length: 500 }, (_, index) => `q-${index}-${'x'.repeat(500)}`),
        materialSourceTypes: Array.from({ length: 500 }, (_, index) => `m-${index}-${'x'.repeat(500)}`),
        __arenaServerContextV1: {
          season: {
            authorityAvailable: true,
            storyGuidance: 'x'.repeat(500_000),
            questionnaireLorePresetIds: Array.from(
              { length: 500 },
              (_, index) => `season-${index}-${'x'.repeat(500)}`,
            ),
          },
        },
      },
      metadata: {
        streamMeta: {
          impacts: Array.from({ length: 500 }, (_, index) => ({
            characterName: `name-${index}-${'x'.repeat(500)}`,
            impact: 'x'.repeat(10_000),
            currentStateSummary: 'x'.repeat(10_000),
          })),
        },
        adjudicationResults: Array.from({ length: 16 }, (_, index) => ({
          depth: 0,
          description: `event-${index}`,
          type: 'binary',
          roll: 50,
          outcome: '成功',
          details: 'x'.repeat(2_000),
        })),
      },
    };

    await ports.claimTerminal(oversizedInput);
    await ports.persistCombatants({
      ...oversizedInput,
      idempotencyKey: 'arena-terminal:generation-1:combatants',
    });

    const serializedExtra = client.boundCalls
      .flat()
      .find((value) => typeof value === 'string' && value.includes('generationOwnerHash'));
    expect(serializedExtra).toEqual(expect.any(String));
    expect(new TextEncoder().encode(serializedExtra as string).byteLength)
      .toBeLessThanOrEqual(MAX_ARENA_TERMINAL_EXTRA_JSON_BYTES);
    expect(JSON.parse(serializedExtra as string).combatantsFallback)
      .toHaveLength(MAX_ARENA_TERMINAL_COMBATANTS);
    expect(JSON.parse(serializedExtra as string).battleReportRenderSnapshotV1.adjudicationResults)
      .toHaveLength(16);
    const combatantWrites = vi.mocked(client.prepare).mock.calls.filter(([sql]) => (
      sql.includes('battle_report_generation_combatants')
      && sql.includes('WHERE NOT EXISTS')
      && sql.includes('generation_id = ?')
      && sql.includes('sort_index = ?')
    ));
    expect(combatantWrites).toHaveLength(MAX_ARENA_TERMINAL_COMBATANTS);
  });

  it('rejects a combatant effect whose idempotency identity does not match the generation', async () => {
    const client = sequentialD1([]);
    const ports = createNodeArenaGenerationFinalizationPorts({ getD1Client: () => client });

    await expect(ports.persistCombatants({
      ...claimInput,
      idempotencyKey: 'arena-terminal:another-generation:combatants',
    })).rejects.toThrow('ARENA_COMBATANTS_IDEMPOTENCY_KEY_INVALID');
    expect(client.prepare).not.toHaveBeenCalled();
  });

  it('executes combatant idempotency SQL against SQLite and keeps one row per generation slot', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
CREATE TABLE battle_report_generation_combatants (
  generation_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  template_id TEXT,
  is_native INTEGER,
  is_preset INTEGER,
  team_id TEXT,
  character_guidance TEXT,
  data_card_id TEXT,
  data_card_updated_at TEXT,
  size_chars INTEGER,
  size_bytes INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (generation_id, sort_index)
)
      `.trim());
      const ports = createNodeArenaGenerationFinalizationPorts({
        getD1Client: () => sqliteD1(database),
        now: () => new Date('2026-08-25T04:00:00.000Z'),
      });
      const input = {
        ...claimInput,
        idempotencyKey: 'arena-terminal:generation-1:combatants',
      };

      await ports.persistCombatants(input);
      await ports.persistCombatants(input);

      const rows = database.prepare(`
SELECT generation_id AS generationId, sort_index AS sortIndex, name
FROM battle_report_generation_combatants
ORDER BY sort_index
      `.trim()).all().map((row) => ({ ...row }));
      expect(rows).toEqual([
        { generationId: 'generation-1', sortIndex: 0, name: 'A' },
        { generationId: 'generation-1', sortIndex: 1, name: 'B' },
      ]);
    } finally {
      database.close();
    }
  });

  it('authorizes terminal fallback by actor hash and reads full R2 output', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('anonymous:anon-id-1'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([result([{
      id: 'generation-1',
      status: 'completed',
      updated_at: '2026-08-25T04:00:00.000Z',
      output_preview: 'preview',
      mode: 'classic',
      scenario_title: '雨夜车站',
      language: 'zh-CN',
      story_length: 'standard',
      ai_provider_name: 'must-not-project-provider-name',
      ai_provider_type: 'must-not-project-provider-type',
      ai_model: 'gpt-safe',
      headline: '雨夜决战',
      winner: '角色甲',
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      cached_tokens: 2,
      reasoning_tokens: 4,
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        generationPayloadHash: 'payload-hash-1',
        generationTerminalStatus: 'completed',
        finalizationCompleted: true,
        resultRef: 'r2:key',
        battleReportRenderSnapshotV1: {
          version: 1,
          reporterInfo: { name: '测试记者', publication: 'A.R.E.N.A.' },
          userGuidance: '保持克制',
          characterGuidances: [{ characterName: '角色甲', guidance: '保护队友' }],
          adjudicationResults: [{
            depth: 0,
            description: '攻击是否命中？',
            type: 'binary',
            roll: 42,
            outcome: '成功',
            details: '掷骰(42) vs 成功率(65%)',
          }],
          narrativeHistoryReadCount: 3,
        },
        combatantsFallback: [{
          sortIndex: 0,
          roomCombatantKey: 'data-card:character-1',
          name: '角色甲',
          privatePayload: { apiKey: 'must-not-leak' },
        }],
        localCardReconciliation: {
          impacts: [{
            characterName: '角色甲',
            impact: '受轻伤',
            currentStateSummary: '仍可行动',
            fullCharacter: { private: true },
          }],
        },
        rawReasoning: 'must-not-leak',
        providerDiagnostic: { requestId: 'must-not-leak' },
      }),
      r2_key: 'key',
    }])]);
    const store = createNodeArenaGenerationTerminalStore({
      getD1Client: () => client,
      objectStore: {
        put: vi.fn(),
        getText: vi.fn(async () => ({ kind: 'found' as const, text: 'full body' })),
      },
    });

    const terminal = await store.readOwnedTerminal({
      generationId: 'generation-1',
      actorKey: 'anonymous:anon-id-1',
    });
    expect(terminal).toMatchObject({
      markdown: 'full body',
      generationRequestId: 'request-1',
      roomSafeResult: {
        version: 1,
        format: 'stream-markdown',
        reporterInfo: { name: '测试记者', publication: 'A.R.E.N.A.' },
        mode: 'classic',
        scenarioDisplayName: '雨夜车站',
        sharedGuidance: '保持克制',
        characterGuidances: [{
          combatantKey: 'data-card:character-1',
          displayName: '角色甲',
          guidance: '保护队友',
        }],
        language: 'zh-CN',
        storyLength: 'standard',
        adjudicationResults: expect.any(Array),
        narrativeHistoryReadCount: 3,
        report: { headline: '雨夜决战', winner: '角色甲' },
        ai: {
          model: 'gpt-safe',
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cachedTokens: 2,
            reasoningTokens: 4,
          },
        },
        combatantUpdates: [{
          combatantKey: 'data-card:character-1',
          displayName: '角色甲',
          impact: '受轻伤',
          currentStateSummary: '仍可行动',
        }],
      },
    });
    expect(JSON.stringify(terminal?.roomSafeResult)).not.toMatch(
      /extra_json|must-not-leak|must-not-project-provider|rawReasoning|providerDiagnostic|privatePayload|fullCharacter/u,
    );
    await expect(store.readOwnedTerminal({
      generationId: 'generation-1',
      actorKey: 'anonymous:other-id',
    })).resolves.toBeNull();
  });

  it('materializes only the persisted stable terminal error code', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('anonymous:anon-id-1'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([result([{
      id: 'generation-1',
      status: 'failed',
      updated_at: '2026-08-25T04:00:00.000Z',
      output_preview: 'failed terminal body must remain private',
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        generationPayloadHash: 'payload-hash-1',
        generationTerminalStatus: 'failed',
        finalizationCompleted: true,
        errorCode: 'AI_UPSTREAM_REQUEST_FAILED',
      }),
      r2_key: null,
    }])]);
    const store = createNodeArenaGenerationTerminalStore({ getD1Client: () => client });

    await expect(store.readOwnedTerminal({
      generationId: 'generation-1',
      actorKey: 'anonymous:anon-id-1',
    })).resolves.toMatchObject({
      errorCode: 'AI_UPSTREAM_REQUEST_FAILED',
      markdown: '',
      contentAvailable: true,
    });
  });

  it('projects a minimal safe result for a legacy completed row with only a valid mode', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('anonymous:anon-id-1'),
    ).then((bytes) => Array.from(
      new Uint8Array(bytes),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join(''));
    const client = sequentialD1([result([{
      id: 'generation-legacy-1',
      status: 'completed',
      updated_at: '2026-08-25T04:00:00.000Z',
      mode: 'classic',
      extra_json: JSON.stringify({
        generationRequestId: 'request-legacy-1',
        generationOwnerHash: ownerHash,
        generationPayloadHash: 'payload-hash-legacy-1',
        generationTerminalStatus: 'completed',
        finalizationCompleted: true,
        resultRef: 'r2:legacy',
      }),
      r2_key: 'legacy-key',
    }])]);
    const store = createNodeArenaGenerationTerminalStore({
      getD1Client: () => client,
      objectStore: {
        put: vi.fn(),
        getText: vi.fn(async () => ({ kind: 'found' as const, text: 'legacy full body' })),
      },
    });

    await expect(store.readOwnedTerminal({
      generationId: 'generation-legacy-1',
      actorKey: 'anonymous:anon-id-1',
    })).resolves.toMatchObject({
      roomSafeResult: { version: 1, format: 'stream-markdown', mode: 'classic' },
    });
  });

  it('marks completed terminal content unavailable instead of silently serving its preview', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('anonymous:anon-id-1'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([result([{
      id: 'generation-1',
      status: 'completed',
      updated_at: '2026-08-25T04:00:00.000Z',
      output_preview: 'truncated preview',
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        generationPayloadHash: 'payload-hash-1',
        finalizationCompleted: true,
        resultRef: 'r2:key',
      }),
      r2_key: 'key',
    }])]);
    const store = createNodeArenaGenerationTerminalStore({
      getD1Client: () => client,
      objectStore: {
        put: vi.fn(),
        getText: vi.fn(async () => { throw new Error('R2 unavailable'); }),
      },
    });

    await expect(store.readOwnedTerminal({
      generationId: 'generation-1',
      actorKey: 'anonymous:anon-id-1',
    })).resolves.toMatchObject({
      markdown: '',
      contentAvailable: false,
      contentUnavailableReason: 'temporary',
    });
  });

  it('classifies an expired R2 object as not-found without exposing the historical preview', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('anonymous:anon-id-1'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([result([{
      id: 'generation-1',
      status: 'completed',
      updated_at: '2026-08-25T04:00:00.000Z',
      output_preview: 'truncated historical preview',
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        generationPayloadHash: 'payload-hash-1',
        finalizationCompleted: true,
        resultRef: 'r2:key',
      }),
      r2_key: 'key',
    }])]);
    const store = createNodeArenaGenerationTerminalStore({
      getD1Client: () => client,
      objectStore: {
        put: vi.fn(),
        getText: vi.fn(async () => ({ kind: 'not-found' as const })),
      },
    });

    await expect(store.readOwnedTerminal({
      generationId: 'generation-1',
      actorKey: 'anonymous:anon-id-1',
    })).resolves.toMatchObject({
      markdown: '',
      contentAvailable: false,
      contentUnavailableReason: 'not-found',
    });
  });

  it('does not expose a completed preview when the required R2 object index is missing', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('anonymous:anon-id-1'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([result([{
      id: 'generation-1',
      status: 'completed',
      updated_at: '2026-08-25T04:00:00.000Z',
      output_preview: 'not the full report',
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        generationPayloadHash: 'payload-hash-1',
        generationTerminalStatus: 'completed',
        finalizationCompleted: true,
        resultRef: 'r2:key',
      }),
      r2_key: null,
    }])]);
    const store = createNodeArenaGenerationTerminalStore({ getD1Client: () => client });

    await expect(store.readOwnedTerminal({
      generationId: 'generation-1',
      actorKey: 'anonymous:anon-id-1',
    })).resolves.toMatchObject({
      markdown: '',
      contentAvailable: false,
      contentUnavailableReason: 'not-found',
    });
  });

  it('reports an actor-owned incomplete finalization without treating it as not found', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('user:42'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([result([{
      id: 'generation-1',
      status: 'completed',
      updated_at: '2026-08-25T04:00:00.000Z',
      output_preview: 'preview',
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        generationPayloadHash: 'payload-hash-1',
        generationTerminalStatus: 'completed',
        finalizationCompleted: false,
      }),
      r2_key: 'key',
    }])]);
    const store = createNodeArenaGenerationTerminalStore({ getD1Client: () => client });

    await expect(store.inspectOwnedFinalization?.({
      generationId: 'generation-1',
      actorKey: 'user:42',
    })).resolves.toEqual({ kind: 'pending', payloadHash: 'payload-hash-1' });
  });

  it('repairs an incomplete durable terminal after the Redis producer lease expires', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('user:42'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const pendingExtra = {
      generationRequestId: 'request-1',
      generationOwnerHash: ownerHash,
      generationPayloadHash: 'payload-hash-1',
      generationTerminalStatus: 'completed',
      finalizationCompleted: false,
      resultRef: 'r2:key',
      combatantsFallback: [
        { sortIndex: 0, name: 'A', type: 'magical-girl', isNative: false, isPreset: false },
        { sortIndex: 1, name: 'B', type: 'magical-girl', isNative: false, isPreset: false },
      ],
    };
    const finalizedExtra = { ...pendingExtra, finalizationCompleted: true };
    const client = sequentialD1([
      result([{
        id: 'generation-1',
        status: 'completed',
        updated_at: '2026-08-25T04:00:00.000Z',
        output_preview: 'preview',
        extra_json: JSON.stringify(pendingExtra),
        r2_key: null,
      }]),
      result([], 1),
      result([], 1),
      result([], 1),
      result([{
        id: 'generation-1',
        status: 'completed',
        updated_at: '2026-08-25T04:01:00.000Z',
        output_preview: 'preview',
        extra_json: JSON.stringify(finalizedExtra),
        r2_key: null,
      }]),
    ]);
    const settleRatings = vi.fn(async () => undefined);
    const store = createNodeArenaGenerationTerminalStore({
      getD1Client: () => client,
      settleRatings,
    });

    await expect(store.reconcileExpiredLease?.({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'user:42',
      payloadHash: 'payload-hash-1',
      mode: 'classic',
      updatedAt: '2026-08-25T04:01:00.000Z',
      code: 'PRODUCER_LEASE_EXPIRED',
    })).resolves.toMatchObject({
      status: 'completed',
      resultRef: 'r2:key',
      markdown: '',
      contentAvailable: false,
      contentUnavailableReason: 'not-found',
    });
    expect(settleRatings).toHaveBeenCalledWith({
      generationId: 'generation-1',
      idempotencyKey: 'arena-terminal:generation-1:ratings',
    });
    expect(client.prepare).toHaveBeenCalledWith(expect.stringMatching(
      /battle_report_generation_combatants[\s\S]*WHERE NOT EXISTS[\s\S]*generation_id = \?[\s\S]*sort_index = \?/u,
    ));
  });

  it('reads bounded local-card reconciliation only for the completed finalized owner', async () => {
    const readOwnedReconciliation = (
      arenaD1Finalization as typeof arenaD1Finalization & {
        readOwnedNodeArenaGenerationReconciliation?: (_input: {
          client: NodeDataD1Client;
          generationId: string;
          actorKey: string;
        }) => Promise<unknown>;
      }
    ).readOwnedNodeArenaGenerationReconciliation;
    expect(readOwnedReconciliation).toBeTypeOf('function');
    if (!readOwnedReconciliation) return;

    const payload = { rosterCount: 2, writeArenaHistory: true };
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('user:42'),
    ).then((bytes) => Array.from(
      new Uint8Array(bytes),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join(''));
    const completedRow = {
      status: 'completed',
      extra_json: JSON.stringify({
        generationOwnerHash: ownerHash,
        finalizationCompleted: true,
        localCardReconciliation: payload,
      }),
    };
    const foundClient = sequentialD1([result([completedRow])]);

    await expect(readOwnedReconciliation({
      client: foundClient,
      generationId: 'generation-1',
      actorKey: 'user:42',
    })).resolves.toEqual({ kind: 'found', reconciliation: payload });
    await expect(readOwnedReconciliation({
      client: sequentialD1([result([completedRow])]),
      generationId: 'generation-1',
      actorKey: 'user:7',
    })).resolves.toEqual({ kind: 'not-found', reason: 'owner_mismatch' });
    await expect(readOwnedReconciliation({
      client: sequentialD1([result()]),
      generationId: 'generation-1',
      actorKey: 'user:42',
    })).resolves.toEqual({ kind: 'not-found', reason: 'row_missing' });
    await expect(readOwnedReconciliation({
      client: sequentialD1([result([{
        ...completedRow,
        extra_json: JSON.stringify({
          generationOwnerHash: ownerHash,
          finalizationCompleted: false,
          localCardReconciliation: payload,
        }),
      }])]),
      generationId: 'generation-1',
      actorKey: 'user:42',
    })).resolves.toEqual({ kind: 'unavailable', reason: 'finalization_pending' });
    await expect(readOwnedReconciliation({
      client: sequentialD1([result([{ ...completedRow, status: 'failed' }])]),
      generationId: 'generation-1',
      actorKey: 'user:42',
    })).resolves.toEqual({ kind: 'unavailable', reason: 'generation_not_completed' });
    await expect(readOwnedReconciliation({
      client: sequentialD1([result([{
        status: 'completed',
        extra_json: JSON.stringify({
          generationOwnerHash: ownerHash,
          finalizationCompleted: true,
        }),
      }])]),
      generationId: 'generation-1',
      actorKey: 'user:42',
    })).resolves.toEqual({ kind: 'unavailable', reason: 'manifest_missing' });
    expect(foundClient.prepare).toHaveBeenCalledWith(expect.stringContaining(
      'FROM battle_report_generations',
    ));
  });

  it('reads exact Provider provenance only for the completed finalized owner', async () => {
    const readOwnedProvenance = (
      arenaD1Finalization as typeof arenaD1Finalization & {
        readOwnedNodeArenaGenerationProvenance?: (_input: {
          client: NodeDataD1Client;
          generationId: string;
          actorKey: string;
        }) => Promise<unknown>;
      }
    ).readOwnedNodeArenaGenerationProvenance;
    expect(readOwnedProvenance).toBeTypeOf('function');
    if (!readOwnedProvenance) return;

    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('user:42'),
    ).then((bytes) => Array.from(
      new Uint8Array(bytes),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join(''));
    const completedRow = {
      status: 'completed',
      custom_provider_id: 'kourichat',
      custom_model_id: 'gpt-5.5',
      ai_provider_name: 'KouriChat',
      ai_provider_type: 'openai',
      ai_model: 'gpt-5.5',
      extra_json: JSON.stringify({
        generationOwnerHash: ownerHash,
        finalizationCompleted: true,
      }),
    };

    await expect(readOwnedProvenance({
      client: sequentialD1([result([completedRow])]),
      generationId: 'generation-1',
      actorKey: 'user:42',
    })).resolves.toEqual({
      kind: 'found',
      provenance: {
        customProviderId: 'kourichat',
        customModelId: 'gpt-5.5',
        aiProviderName: 'KouriChat',
        aiProviderType: 'openai',
        aiModel: 'gpt-5.5',
      },
    });
    await expect(readOwnedProvenance({
      client: sequentialD1([result([completedRow])]),
      generationId: 'generation-1',
      actorKey: 'user:7',
    })).resolves.toEqual({ kind: 'not-found', reason: 'owner_mismatch' });
    await expect(readOwnedProvenance({
      client: sequentialD1([result([{ ...completedRow, ai_model: null }])]),
      generationId: 'generation-1',
      actorKey: 'user:42',
    })).resolves.toEqual({ kind: 'unavailable', reason: 'provenance_missing' });
  });
});
