import { EventEmitter } from 'node:events';
import {
  beginAiUpstream,
  observeHostedGenerationLifecycle,
  observeD1RoundTrip,
  registerHostedRuntimeObserver,
} from '@mahoshojo/hosted-runtime/telemetry';
import { describe, expect, it, vi } from 'vitest';
import { observeArenaRoomRuntime } from '#/arena-room/runtime-observer';
import {
  HonoRuntimeTelemetry,
  instrumentStreamingResponse,
  isStreamingResponse,
  observeServerConnections,
} from '#/telemetry/runtime';

describe('Hono runtime telemetry', () => {
  it('导出进程、event-loop 和 HTTP 容量快照', () => {
    const telemetry = new HonoRuntimeTelemetry();
    const finishRequestOne = telemetry.beginRequest();
    const finishRequestTwo = telemetry.beginRequest();
    const finishStream = telemetry.beginStream();
    const finishSocket = telemetry.beginSocket();

    finishRequestOne();
    const snapshot = telemetry.snapshot();

    expect(snapshot).toMatchObject({
      schemaVersion: 5,
      service: 'mahoshojo-hono',
      runtime: {
        origin: 'hono-node',
        selection: 'not-observed',
        failoverReason: null,
      },
      http: {
        activeRequests: 1,
        peakActiveRequests: 2,
        activeStreams: 1,
        peakActiveStreams: 1,
        activeSockets: 1,
        peakActiveSockets: 1,
      },
    });
    expect(snapshot.process.cpu.userSeconds).toBeGreaterThanOrEqual(0);
    expect(snapshot.process.cpu.systemSeconds).toBeGreaterThanOrEqual(0);
    expect(snapshot.process.memory.rssBytes).toBeGreaterThan(0);
    expect(snapshot.process.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(snapshot.process.memory.heapLimitBytes).toBeGreaterThan(0);
    expect(snapshot.eventLoop.utilization).toBeGreaterThanOrEqual(0);
    expect(snapshot.eventLoop.utilization).toBeLessThanOrEqual(1);

    finishRequestTwo();
    finishStream();
    finishSocket();
    expect(telemetry.snapshot().http).toMatchObject({
      activeRequests: 0,
      activeStreams: 0,
      activeSockets: 0,
    });
  });

  it('聚合 AI upstream、D1 和 Redis 的低基数运行时指标', () => {
    const telemetry = new HonoRuntimeTelemetry();
    const unregister = registerHostedRuntimeObserver(telemetry);
    try {
      const successfulAttempt = beginAiUpstream();
      successfulAttempt.recordTtfb(12);
      successfulAttempt.finish({ outcome: 'success', durationMs: 30 });
      const activeAttempt = beginAiUpstream();
      activeAttempt.recordTtfb(18);

      observeD1RoundTrip({
        durationMs: 7,
        rowsRead: 3,
        rowsWritten: 1,
        outcome: 'ok',
      });
      observeD1RoundTrip({
        durationMs: 11,
        rowsRead: 0,
        rowsWritten: 0,
        outcome: 'error',
        errorClass: 'timeout',
      });

      telemetry.observeRedisOperation({
        operation: 'connect',
        outcome: 'ok',
        durationMs: 4,
      });
      telemetry.observeRedisOperation({
        operation: 'ping',
        outcome: 'error',
        durationMs: 6,
      });
      telemetry.observeRedisOperation({
        operation: 'rate-limit',
        outcome: 'ok',
        durationMs: 8,
      });
      telemetry.observeRedisOperation({
        operation: 'generation',
        outcome: 'ok',
        durationMs: 10,
      });
      telemetry.observeRedisServerStats({
        usedMemoryBytes: 1_024,
        evictedKeys: 2,
        keyspaceHits: 5,
        keyspaceMisses: 3,
      });

      expect(telemetry.snapshot()).toMatchObject({
        schemaVersion: 5,
        aiUpstream: {
          attempts: {
            active: 1,
            peakActive: 1,
            started: 2,
            completed: 1,
            outcomes: { success: 1, error: 0, aborted: 0, timeout: 0 },
          },
          ttfb: { samples: 2, totalMilliseconds: 30, maxMilliseconds: 18 },
          duration: { samples: 1, totalMilliseconds: 30, maxMilliseconds: 30 },
        },
        d1: {
          roundTrips: 2,
          outcomes: { ok: 1, error: 1 },
          errorClasses: {
            none: 1,
            aborted: 0,
            timeout: 1,
            transport: 0,
            response: 0,
            unknown: 0,
          },
          latency: { samples: 2, totalMilliseconds: 18, maxMilliseconds: 11 },
          rows: { read: 3, written: 1 },
        },
        redis: {
          commands: 4,
          outcomes: { ok: 3, error: 1, unavailable: 0 },
          byOperation: {
            connect: 1,
            ping: 1,
            'rate-limit': 1,
            generation: 1,
            info: 0,
          },
          latency: { samples: 4, totalMilliseconds: 28, maxMilliseconds: 10 },
          server: {
            status: 'observed',
            usedMemoryBytes: 1_024,
            evictedKeys: 2,
            keyspaceHits: 5,
            keyspaceMisses: 3,
          },
        },
      });

      activeAttempt.finish({ outcome: 'aborted', durationMs: 21 });
    } finally {
      unregister();
    }
  });

  it('聚合 G25H fixed operation/placement/outcome，且不接收请求载荷', () => {
    const telemetry = new HonoRuntimeTelemetry();
    const unregister = registerHostedRuntimeObserver(telemetry);
    try {
      observeHostedGenerationLifecycle({
        event: 'hosted-generation',
        operation: 'generate-magical-girl-details',
        placement: 'hono-primary',
        outcome: 'success',
        durationMs: 13,
      });
      observeHostedGenerationLifecycle({
        event: 'hosted-generation',
        operation: 'generate-sublimation-stream',
        placement: 'next-dr',
        outcome: 'cancelled',
        durationMs: 21,
      });

      expect(telemetry.snapshot()).toMatchObject({
        schemaVersion: 5,
        hostedGeneration: {
          byOperation: {
            'generate-magical-girl-details': 1,
            'generate-magical-girl-details-stream': 0,
            'generate-sublimation': 0,
            'generate-sublimation-stream': 1,
          },
          byPlacement: { honoPrimary: 1, nextDr: 1 },
          outcomes: { success: 1, rejected: 0, failure: 0, cancelled: 1 },
          duration: { samples: 2, totalMilliseconds: 34, maxMilliseconds: 21 },
        },
      });
    } finally {
      unregister();
    }
  });

  it('区间导出后重置完成计数并保留 active AI 与 Redis server gauges', () => {
    const logger = vi.fn();
    const telemetry = new HonoRuntimeTelemetry({ logger });
    const activeAttempt = telemetry.beginAiUpstream();
    telemetry.observeD1RoundTrip({
      durationMs: 3,
      rowsRead: 1,
      rowsWritten: 0,
      outcome: 'ok',
      errorClass: 'none',
    });
    telemetry.observeRedisServerStats({
      usedMemoryBytes: 2_048,
      evictedKeys: 4,
      keyspaceHits: 8,
      keyspaceMisses: 1,
    });

    telemetry.emitSnapshot();

    expect(telemetry.snapshot()).toMatchObject({
      aiUpstream: {
        attempts: { active: 1, peakActive: 1, started: 0, completed: 0 },
      },
      d1: { roundTrips: 0 },
      redis: {
        commands: 0,
        server: {
          status: 'observed',
          usedMemoryBytes: 2_048,
          evictedKeys: 4,
          keyspaceHits: 8,
          keyspaceMisses: 1,
        },
      },
    });
    activeAttempt.finish({ outcome: 'success', durationMs: 5 });
  });

  it('Redis unavailable 计入固定结果但不伪造 round-trip latency', () => {
    const telemetry = new HonoRuntimeTelemetry();
    telemetry.observeRedisOperation({
      operation: 'ping',
      outcome: 'unavailable',
      durationMs: 50,
    });

    expect(telemetry.snapshot().redis).toMatchObject({
      commands: 1,
      outcomes: { ok: 0, error: 0, unavailable: 1 },
      latency: { samples: 0, totalMilliseconds: 0, maxMilliseconds: null },
    });
  });

  it('聚合 Arena resume/replay/provider/finalization 指标并输出无正文的 terminal audit', () => {
    const logger = vi.fn();
    const telemetry = new HonoRuntimeTelemetry({ logger });
    telemetry.observeArenaGeneration({
      event: 'request', generationId: 'generation-1', outcome: 'created', inputBytes: 128,
    });
    telemetry.observeArenaGeneration({
      event: 'request', generationId: 'generation-1', outcome: 'reused', inputBytes: 128,
    });
    telemetry.observeArenaGeneration({
      event: 'companion',
      operation: 'arena/session/generate-next',
      placement: 'hono-primary',
      outcome: 'success',
      durationMs: 18,
    });
    telemetry.observeArenaGeneration({ event: 'client_disconnect', generationId: 'generation-1' });
    telemetry.observeArenaGeneration({
      event: 'resume', generationId: 'generation-1', outcome: 'attempt',
    });
    telemetry.observeArenaGeneration({
      event: 'resume', generationId: 'generation-1', outcome: 'success', latencyMs: 12,
    });
    telemetry.observeArenaGeneration({
      event: 'replay', generationId: 'generation-1', events: 3, bytes: 512,
      snapshotBootstrap: true,
    });
    telemetry.observeArenaGeneration({
      event: 'provider', generationId: 'generation-1', outcome: 'started',
    });
    telemetry.observeArenaGeneration({
      event: 'provider', generationId: 'generation-1', outcome: 'failure', durationMs: 42,
    });
    telemetry.observeArenaGeneration({
      event: 'phase', generationId: 'generation-1', phase: 'finalization',
      outcome: 'success', durationMs: 9,
    });
    telemetry.observeArenaGeneration({
      event: 'storage', generationId: 'generation-1', storage: 'r2',
      outcome: 'success', durationMs: 5, bytes: 256,
    });
    telemetry.observeArenaGeneration({
      event: 'terminal', generationId: 'generation-1', status: 'failed', code: 'GENERATION_FAILED',
    });

    expect(telemetry.snapshot().arenaGeneration).toMatchObject({
      requests: {
        created: 1,
        reused: 1,
        conflicts: 0,
        unavailable: 0,
        secondProviderPreventions: 1,
        inputBytes: 256,
      },
      companion: {
        byOperation: {
          arenaGenerate: 0,
          generateBattleStory: 0,
          arenaSessionGenerateNext: 1,
        },
        byPlacement: { honoPrimary: 1, nextDr: 0 },
        outcomes: { success: 1, rejected: 0, failure: 0, cancelled: 0 },
        duration: { samples: 1, totalMilliseconds: 18, maxMilliseconds: 18 },
      },
      clientDisconnects: 1,
      resume: {
        attempts: 1,
        successes: 1,
        failures: { unauthorized: 0, notFound: 0, stateUnavailable: 0, cursorConflict: 0, unknown: 0 },
        latency: { samples: 1, totalMilliseconds: 12, maxMilliseconds: 12 },
      },
      replay: { events: 3, bytes: 512, snapshotBootstraps: 1 },
      provider: {
        started: 1,
        outcomes: { success: 0, failure: 1, cancelled: 0 },
        duration: { samples: 1, totalMilliseconds: 42, maxMilliseconds: 42 },
      },
      phases: {
        finalization: {
          outcomes: { success: 1, failure: 0 },
          duration: { samples: 1, totalMilliseconds: 9, maxMilliseconds: 9 },
        },
      },
      r2: {
        outcomes: { success: 1, failure: 0 },
        bytes: 256,
        latency: { samples: 1, totalMilliseconds: 5, maxMilliseconds: 5 },
      },
      terminals: { completed: 0, failed: 1, cancelled: 0, producerLost: 0 },
    });
    expect(JSON.parse(String(logger.mock.calls[0]?.[0]))).toMatchObject({
      event: 'arena.generation.terminal.audit',
      generationId: 'generation-1',
      providerStarted: true,
      subscriberDisconnects: 1,
      resumeAttempts: 1,
      snapshotBootstrap: true,
      secondProviderPrevention: true,
      terminal: { status: 'failed', code: 'GENERATION_FAILED' },
      finalization: 'success',
      r2: 'success',
    });
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/prompt|正文|user:42/u);
  });

  it('聚合 Arena Room 固定低基数词汇与 active/peak gauges', () => {
    const telemetry = new HonoRuntimeTelemetry();

    telemetry.observeArenaRoomRuntime({
      event: 'registry',
      activeRooms: 2,
      residentActors: 3,
    });
    telemetry.observeArenaRoomRuntime({
      event: 'actor_queue',
      queuedCurrent: 4,
      roomQueuedCurrent: 3,
      overloaded: true,
    });
    telemetry.observeArenaRoomRuntime({
      event: 'actor_operation',
      operation: 'command',
      outcome: 'applied',
      durationMs: 12,
    });
    telemetry.observeArenaRoomRuntime({
      event: 'actor_operation',
      operation: 'story',
      outcome: 'idempotent',
      durationMs: 18,
    });
    telemetry.observeArenaRoomRuntime({
      event: 'checkpoint',
      operation: 'save',
      outcome: 'ok',
      serializedBytes: 2_048,
      durationMs: 7,
    });
    telemetry.observeArenaRoomRuntime({
      event: 'checkpoint',
      operation: 'load',
      outcome: 'missing',
      durationMs: 5,
    });
    telemetry.observeArenaRoomRuntime({ event: 'socket', action: 'opened' });
    telemetry.observeArenaRoomRuntime({ event: 'socket', action: 'opened' });
    telemetry.observeArenaRoomRuntime({ event: 'socket', action: 'closed' });
    telemetry.observeArenaRoomRuntime({
      event: 'socket_backlog',
      queuedFrames: 6,
      queuedBytes: 4_096,
    });
    telemetry.observeArenaRoomRuntime({ event: 'slow_consumer_resync_close' });
    telemetry.observeArenaRoomRuntime({ event: 'sync', action: 'reconnect_attempt' });
    telemetry.observeArenaRoomRuntime({ event: 'sync', action: 'delivery', mode: 'replay' });
    telemetry.observeArenaRoomRuntime({ event: 'sync', action: 'resync_requested' });
    telemetry.observeArenaRoomRuntime({ event: 'sync', action: 'resync_required' });
    telemetry.observeArenaRoomRuntime({ event: 'publisher', action: 'started' });
    telemetry.observeArenaRoomRuntime({ event: 'publisher', action: 'started' });
    telemetry.observeArenaRoomRuntime({ event: 'publisher', action: 'finished' });
    telemetry.observeArenaRoomRuntime({
      event: 'publisher_backlog',
      inFlightCurrent: 5,
    });
    telemetry.observeArenaRoomRuntime({
      event: 'publisher_outcome',
      outcome: 'published',
    });
    telemetry.observeArenaRoomRuntime({ event: 'incident', outcome: 'created' });
    telemetry.observeArenaRoomRuntime({ event: 'incident', outcome: 'recovered' });
    telemetry.observeArenaRoomRuntime({ event: 'incident', outcome: 'fenced' });
    telemetry.observeArenaRoomRuntime({ event: 'incident', outcome: 'quarantined' });
    telemetry.observeArenaRoomRuntime({ event: 'incident', outcome: 'replacement_required' });

    expect(telemetry.snapshot()).toMatchObject({
      schemaVersion: 5,
      arenaRoom: {
        registry: {
          activeRooms: 2,
          peakActiveRooms: 2,
          residentActors: 3,
          peakResidentActors: 3,
        },
        actor: {
          queue: {
            queuedCurrent: 4,
            peakQueued: 4,
            peakPerRoom: 3,
            overloads: 1,
          },
          operations: {
            byOperation: { command: 1, story: 1 },
            outcomes: { applied: 1, idempotent: 1, rejected: 0, error: 0 },
            latency: { samples: 2, totalMilliseconds: 30, maxMilliseconds: 18 },
          },
        },
        checkpoints: {
          byOperation: { load: 1, save: 1, refresh: 0, expire: 0, delete: 0 },
          outcomes: { ok: 1, missing: 1, conflict: 0, error: 0, unavailable: 0 },
          serializedBytes: { samples: 1, totalBytes: 2_048, maxBytes: 2_048 },
          latency: { samples: 2, totalMilliseconds: 12, maxMilliseconds: 7 },
        },
        sockets: {
          active: 1,
          peakActive: 2,
          opened: 2,
          closed: 1,
          slowConsumerResyncCloses: 1,
          outbound: {
            queuedFramesCurrent: 6,
            peakQueuedFrames: 6,
            queuedBytesCurrent: 4_096,
            peakQueuedBytes: 4_096,
          },
        },
        sync: {
          reconnectAttempts: 1,
          deliveries: { current: 0, replay: 1, snapshot: 0 },
          resync: { requested: 1, required: 1 },
        },
        publishers: {
          active: 1,
          peakActive: 2,
          started: 2,
          finished: 1,
          outcomes: { published: 1, rejected: 0, dropped: 0, error: 0 },
          inFlight: { current: 5, peak: 5 },
        },
        incidents: {
          created: 1,
          recovered: 1,
          fenced: 1,
          quarantined: 1,
          replacementRequired: 1,
        },
      },
    });
  });

  it('Arena Room 区间导出重置 counters/durations，并将 peak 重置到 current', () => {
    const telemetry = new HonoRuntimeTelemetry({ logger: vi.fn() });
    telemetry.observeArenaRoomRuntime({
      event: 'registry', activeRooms: 2, residentActors: 4,
    });
    telemetry.observeArenaRoomRuntime({
      event: 'actor_queue', queuedCurrent: 5, roomQueuedCurrent: 3, overloaded: true,
    });
    telemetry.observeArenaRoomRuntime({ event: 'socket', action: 'opened' });
    telemetry.observeArenaRoomRuntime({ event: 'socket', action: 'opened' });
    telemetry.observeArenaRoomRuntime({ event: 'socket', action: 'closed' });
    telemetry.observeArenaRoomRuntime({
      event: 'socket_backlog', queuedFrames: 4, queuedBytes: 512,
    });
    telemetry.observeArenaRoomRuntime({ event: 'publisher', action: 'started' });
    telemetry.observeArenaRoomRuntime({ event: 'publisher', action: 'started' });
    telemetry.observeArenaRoomRuntime({ event: 'publisher', action: 'finished' });
    telemetry.observeArenaRoomRuntime({ event: 'publisher_backlog', inFlightCurrent: 3 });
    telemetry.observeArenaRoomRuntime({
      event: 'actor_operation', operation: 'command', outcome: 'rejected', durationMs: 9,
    });

    telemetry.emitSnapshot();

    expect(telemetry.snapshot().arenaRoom).toMatchObject({
      registry: {
        activeRooms: 2,
        peakActiveRooms: 2,
        residentActors: 4,
        peakResidentActors: 4,
      },
      actor: {
        queue: { queuedCurrent: 5, peakQueued: 5, peakPerRoom: 0, overloads: 0 },
        operations: {
          byOperation: { command: 0, story: 0 },
          outcomes: { applied: 0, idempotent: 0, rejected: 0, error: 0 },
          latency: { samples: 0 },
        },
      },
      sockets: {
        active: 1,
        peakActive: 1,
        opened: 0,
        closed: 0,
        outbound: {
          queuedFramesCurrent: 4,
          peakQueuedFrames: 4,
          queuedBytesCurrent: 512,
          peakQueuedBytes: 512,
        },
      },
      publishers: {
        active: 1,
        peakActive: 1,
        started: 0,
        finished: 0,
        inFlight: { current: 3, peak: 3 },
      },
    });
  });

  it('Arena Room observer 调用 fail-soft，且非法/敏感词不会进入快照维度', async () => {
    expect(() => observeArenaRoomRuntime({
      observeArenaRoomRuntime: () => {
        throw new Error('observer-secret-canary');
      },
    }, { event: 'incident', outcome: 'created' })).not.toThrow();
    expect(() => observeArenaRoomRuntime({
      observeArenaRoomRuntime: () => Promise.reject(new Error('async-observer-secret-canary')),
    }, { event: 'incident', outcome: 'created' })).not.toThrow();
    await Promise.resolve();

    const telemetry = new HonoRuntimeTelemetry();
    telemetry.observeArenaRoomRuntime({
      event: 'checkpoint',
      operation: 'room-secret-canary' as 'load',
      outcome: 'content-secret-canary' as 'error',
      serializedBytes: 12,
      durationMs: 1,
    });
    telemetry.observeArenaRoomRuntime({
      event: 'incident',
      outcome: 'user-42-secret-canary' as 'created',
    });

    const serialized = JSON.stringify(telemetry.snapshot().arenaRoom);
    expect(serialized).not.toMatch(/room-secret-canary|content-secret-canary|user-42-secret-canary/u);
    expect(JSON.parse(serialized)).toHaveProperty('checkpoints.byOperation.load');
  });

  it('资源导出先执行 Redis sampler，采样失败则 fail-soft 并继续导出', async () => {
    const logger = vi.fn();
    const errorLogger = vi.fn();
    const telemetry = new HonoRuntimeTelemetry({ logger, errorLogger });
    const detachSampler = telemetry.setRedisResourceSampler(async () => ({
      usedMemoryBytes: 8_192,
      evictedKeys: 1,
      keyspaceHits: 9,
      keyspaceMisses: 2,
    }));

    await telemetry.emitSnapshotWithResources();
    expect(JSON.parse(String(logger.mock.calls[0]?.[0])).redis.server).toMatchObject({
      status: 'observed',
      usedMemoryBytes: 8_192,
    });

    detachSampler();
    telemetry.setRedisResourceSampler(async () => {
      throw new Error('redis-info-url-secret-canary');
    });
    await expect(telemetry.emitSnapshotWithResources()).resolves.toBeUndefined();
    expect(errorLogger).toHaveBeenCalledWith(
      '[hono][telemetry] Redis 资源采样失败',
      { errorClass: 'telemetry_operation_failed' },
    );
    expect(JSON.stringify(errorLogger.mock.calls)).not.toContain('redis-info-url-secret-canary');
    expect(logger).toHaveBeenCalledTimes(2);
  });

  it('Redis sampler 永久 pending 时有界导出，且迟到结果不污染后续周期', async () => {
    vi.useFakeTimers();
    const logger = vi.fn();
    const errorLogger = vi.fn();
    let resolveFirst = (value: {
      usedMemoryBytes: number;
      evictedKeys: number;
      keyspaceHits: number;
      keyspaceMisses: number;
    }): void => {
      void value;
    };
    const firstSample = new Promise<{
      usedMemoryBytes: number;
      evictedKeys: number;
      keyspaceHits: number;
      keyspaceMisses: number;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const sampler = vi.fn()
      .mockReturnValueOnce(firstSample)
      .mockResolvedValueOnce({
        usedMemoryBytes: 2_048,
        evictedKeys: 2,
        keyspaceHits: 4,
        keyspaceMisses: 1,
      })
      .mockReturnValueOnce(new Promise(() => undefined));
    const telemetry = new HonoRuntimeTelemetry({
      logger,
      errorLogger,
      sampleIntervalMs: 1_000,
      resourceSampleTimeoutMs: 100,
    });
    telemetry.setRedisResourceSampler(sampler);
    try {
      const firstExport = telemetry.emitSnapshotWithResources();
      await vi.advanceTimersByTimeAsync(100);
      await expect(firstExport).resolves.toBeUndefined();
      expect(logger).toHaveBeenCalledTimes(1);
      expect(errorLogger).toHaveBeenCalledWith(
        '[hono][telemetry] Redis 资源采样超时',
        { errorClass: 'telemetry_operation_failed' },
      );

      await telemetry.emitSnapshotWithResources();
      expect(JSON.parse(String(logger.mock.calls[1]?.[0])).redis.server).toMatchObject({
        status: 'observed',
        usedMemoryBytes: 2_048,
      });

      resolveFirst({
        usedMemoryBytes: 999_999,
        evictedKeys: 9,
        keyspaceHits: 9,
        keyspaceMisses: 9,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(telemetry.snapshot().redis.server.usedMemoryBytes).toBe(2_048);

      const flush = telemetry.flushSnapshot();
      await vi.advanceTimersByTimeAsync(100);
      await expect(flush).resolves.toBeUndefined();
      expect(logger).toHaveBeenCalledTimes(3);
    } finally {
      telemetry.stop();
      vi.useRealTimers();
    }
  });

  it('以不含请求正文和凭据的结构化日志导出快照', () => {
    vi.stubEnv('AI_API_KEY', 'telemetry-secret-canary');
    vi.stubEnv('D1_GATEWAY_HMAC_SECRET', 'telemetry-hmac-canary');
    const logger = vi.fn();
    const telemetry = new HonoRuntimeTelemetry({ logger });
    telemetry.observeRedisOperation({
      operation: 'redis-secret-canary' as 'info',
      outcome: 'redis-outcome-canary' as 'error',
      durationMs: 1,
    });
    try {
      telemetry.emitSnapshot();

      expect(logger).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledWith(expect.any(String));
      const serialized = String(logger.mock.calls[0]?.[0]);
      expect(JSON.parse(serialized)).toMatchObject({
        event: 'hono.runtime.telemetry',
        service: 'mahoshojo-hono',
        runtime: { origin: 'hono-node', selection: 'not-observed' },
      });
      expect(serialized).not.toMatch(/authorization|cookie|prompt|output/i);
      expect(serialized).not.toContain('telemetry-secret-canary');
      expect(serialized).not.toContain('telemetry-hmac-canary');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('拒绝无效采样周期，且日志导出失败不抛出到业务运行时', () => {
    expect(() => new HonoRuntimeTelemetry({ sampleIntervalMs: 0 })).toThrow(
      /sampleIntervalMs/,
    );
    expect(() => new HonoRuntimeTelemetry({ sampleIntervalMs: Number.NaN })).toThrow(
      /sampleIntervalMs/,
    );
    expect(() => new HonoRuntimeTelemetry({ sampleIntervalMs: Number.POSITIVE_INFINITY })).toThrow(
      /sampleIntervalMs/,
    );
    expect(() => new HonoRuntimeTelemetry({
      sampleIntervalMs: 1_000,
      resourceSampleTimeoutMs: 1_000,
    })).toThrow(/resourceSampleTimeoutMs/);

    const errorLogger = vi.fn();
    const telemetry = new HonoRuntimeTelemetry({
      logger: () => {
        throw new Error('telemetry-sink-secret-canary');
      },
      errorLogger,
    });
    expect(() => telemetry.emitSnapshot()).not.toThrow();
    expect(errorLogger).toHaveBeenCalledWith(
      '[hono][telemetry] 导出失败',
      { errorClass: 'telemetry_operation_failed' },
    );
    expect(JSON.stringify(errorLogger.mock.calls)).not.toContain('telemetry-sink-secret-canary');
  });

  it('瞬时 sink 失败后恢复时不混用上一采样周期的 peak', () => {
    const exported: string[] = [];
    let sinkAvailable = false;
    const telemetry = new HonoRuntimeTelemetry({
      logger: (line) => {
        if (!sinkAvailable) throw new Error('sink temporarily unavailable');
        exported.push(line);
      },
      errorLogger: vi.fn(),
    });

    const finishFirst = telemetry.beginRequest();
    const finishSecond = telemetry.beginRequest();
    finishFirst();
    finishSecond();
    telemetry.emitSnapshot();

    sinkAvailable = true;
    const finishRecoveredRequest = telemetry.beginRequest();
    finishRecoveredRequest();
    telemetry.emitSnapshot();

    expect(exported).toHaveLength(1);
    expect(JSON.parse(exported[0] ?? '{}').http).toMatchObject({
      activeRequests: 0,
      peakActiveRequests: 1,
    });
  });

  it('启动后按周期导出，停止后不再产生日志', async () => {
    vi.useFakeTimers();
    const logger = vi.fn();
    const telemetry = new HonoRuntimeTelemetry({ logger, sampleIntervalMs: 1_000 });
    try {
      telemetry.start();
      telemetry.start();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(logger).toHaveBeenCalledTimes(2);

      telemetry.stop();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(logger).toHaveBeenCalledTimes(2);
    } finally {
      telemetry.stop();
      vi.useRealTimers();
    }
  });

  it('跟踪 Node server socket 生命周期并支持解除观测', () => {
    const telemetry = new HonoRuntimeTelemetry();
    const server = new EventEmitter();
    const firstSocket = new EventEmitter();
    const secondSocket = new EventEmitter();
    const detach = observeServerConnections(server, telemetry);

    server.emit('connection', firstSocket);
    server.emit('connection', secondSocket);
    expect(telemetry.snapshot().http).toMatchObject({
      activeSockets: 2,
      peakActiveSockets: 2,
    });

    firstSocket.emit('close');
    expect(telemetry.snapshot().http.activeSockets).toBe(1);

    detach();
    server.emit('connection', new EventEmitter());
    secondSocket.emit('close');
    expect(telemetry.snapshot().http.activeSockets).toBe(0);
  });

  it('在消费或取消 streaming response 后释放 active stream', async () => {
    const telemetry = new HonoRuntimeTelemetry();
    const encoder = new TextEncoder();
    const controllers: {
      source?: ReadableStreamDefaultController<Uint8Array>;
      error?: ReadableStreamDefaultController<Uint8Array>;
    } = {};
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controllers.source = controller;
      },
    });
    const response = instrumentStreamingResponse(new Response(source, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }), telemetry);

    expect(telemetry.snapshot().http.activeStreams).toBe(1);
    controllers.source?.enqueue(encoder.encode('event: done\n\n'));
    controllers.source?.close();
    await expect(response.text()).resolves.toBe('event: done\n\n');
    expect(telemetry.snapshot().http.activeStreams).toBe(0);

    const pending = new ReadableStream<Uint8Array>();
    const cancelled = instrumentStreamingResponse(new Response(pending, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }), telemetry);
    expect(telemetry.snapshot().http.activeStreams).toBe(1);
    await cancelled.body?.cancel('client disconnected');
    expect(telemetry.snapshot().http.activeStreams).toBe(0);

    const failing = instrumentStreamingResponse(new Response(new ReadableStream({
      start(controller) {
        controllers.error = controller;
      },
    })), telemetry);
    expect(telemetry.snapshot().http.activeStreams).toBe(1);
    controllers.error?.error(new Error('upstream failed'));
    await expect(failing.text()).rejects.toThrow('upstream failed');
    expect(telemetry.snapshot().http.activeStreams).toBe(0);
  });

  it('仅按明确的 streaming content-type 或 route segment 识别流响应', () => {
    expect(isStreamingResponse('/api/arena/generate-next', new Response('sse', {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }))).toBe(true);
    expect(isStreamingResponse('/api/generate-free-stream', new Response('text', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }))).toBe(true);
    expect(isStreamingResponse('/api/generate-free-stream', new Response('{}', {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }))).toBe(false);
    expect(isStreamingResponse('/api/upstream/status', new Response('text', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }))).toBe(false);
  });
});
