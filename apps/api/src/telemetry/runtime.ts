import type { EventEmitter } from 'node:events';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type {
  AiUpstreamAttemptObserver,
  AiUpstreamFinishObservation,
  D1RoundTripObservation,
  HostedRuntimeObserver,
} from '@mahoshojo/hosted-runtime/telemetry';
import type {
  RedisRuntimeObserver,
  RedisRuntimeOperationObservation,
  RedisServerStatsObservation,
} from '#/redis/runtime';

const TELEMETRY_EVENT = 'hono.runtime.telemetry';
const DEFAULT_SAMPLE_INTERVAL_MS = 60_000;
const EVENT_LOOP_DELAY_RESOLUTION_MS = 20;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

type FinishObservation = () => void;

type DurationSummary = {
  samples: number;
  totalMilliseconds: number;
  maxMilliseconds: number | null;
};

export interface RuntimeTelemetryService {
  beginRequest(): FinishObservation;
  beginStream(): FinishObservation;
  beginSocket(): FinishObservation;
}

export type HonoRuntimeTelemetrySnapshot = {
  event: 'hono.runtime.telemetry';
  schemaVersion: 2;
  service: 'mahoshojo-hono';
  capturedAt: string;
  runtime: {
    origin: 'hono-node';
    selection: 'not-observed';
    failoverReason: null;
  };
  process: {
    uptimeSeconds: number;
    cpu: {
      userSeconds: number;
      systemSeconds: number;
      intervalUtilization: number | null;
    };
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      heapLimitBytes: number;
    };
  };
  eventLoop: {
    utilization: number;
    activeMilliseconds: number;
    idleMilliseconds: number;
    delay: {
      samples: number;
      meanMilliseconds: number | null;
      p99Milliseconds: number | null;
      maxMilliseconds: number | null;
    };
  };
  http: {
    activeRequests: number;
    peakActiveRequests: number;
    activeStreams: number;
    peakActiveStreams: number;
    activeSockets: number;
    peakActiveSockets: number;
  };
  aiUpstream: {
    attempts: {
      active: number;
      peakActive: number;
      started: number;
      completed: number;
      outcomes: {
        success: number;
        error: number;
        aborted: number;
        timeout: number;
      };
    };
    ttfb: DurationSummary;
    duration: DurationSummary;
  };
  d1: {
    roundTrips: number;
    outcomes: { ok: number; error: number };
    errorClasses: {
      none: number;
      aborted: number;
      timeout: number;
      transport: number;
      response: number;
      unknown: number;
    };
    latency: DurationSummary;
    rows: { read: number; written: number };
  };
  redis: {
    commands: number;
    outcomes: { ok: number; error: number; unavailable: number };
    byOperation: {
      connect: number;
      ping: number;
      'rate-limit': number;
      info: number;
    };
    latency: DurationSummary;
    server: {
      status: 'observed' | 'not-observed';
      capturedAt: string | null;
      usedMemoryBytes: number | null;
      evictedKeys: number | null;
      keyspaceHits: number | null;
      keyspaceMisses: number | null;
    };
  };
};

export type HonoRuntimeTelemetryOptions = {
  logger?: (line: string) => void;
  errorLogger?: (message: string, error: unknown) => void;
  sampleIntervalMs?: number;
};

class ActiveGauge {
  private active = 0;

  private peak = 0;

  begin(): FinishObservation {
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.active = Math.max(0, this.active - 1);
    };
  }

  read(): { active: number; peak: number } {
    return { active: this.active, peak: this.peak };
  }

  resetPeak(): void {
    this.peak = this.active;
  }
}

class DurationAccumulator {
  private samples = 0;

  private totalMilliseconds = 0;

  private maxMilliseconds: number | null = null;

  observe(durationMs: number): void {
    const normalized = normalizeDuration(durationMs);
    this.samples += 1;
    this.totalMilliseconds += normalized;
    this.maxMilliseconds = Math.max(this.maxMilliseconds ?? 0, normalized);
  }

  read(): DurationSummary {
    return {
      samples: this.samples,
      totalMilliseconds: round(this.totalMilliseconds, 3),
      maxMilliseconds: this.maxMilliseconds === null
        ? null
        : round(this.maxMilliseconds, 3),
    };
  }

  reset(): void {
    this.samples = 0;
    this.totalMilliseconds = 0;
    this.maxMilliseconds = null;
  }
}

const round = (value: number, digits = 6): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const finiteOrNull = (value: number): number | null => (
  Number.isFinite(value) ? round(value) : null
);

const normalizeDuration = (value: number): number => Math.min(
  Number.MAX_SAFE_INTEGER,
  Number.isFinite(value) && value > 0 ? value : 0,
);

const normalizeMetricInteger = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
};

export class HonoRuntimeTelemetry implements
  RuntimeTelemetryService,
  HostedRuntimeObserver,
  RedisRuntimeObserver {
  private readonly requests = new ActiveGauge();

  private readonly streams = new ActiveGauge();

  private readonly sockets = new ActiveGauge();

  private readonly aiAttempts = new ActiveGauge();

  private aiAttemptsStarted = 0;

  private aiAttemptsCompleted = 0;

  private readonly aiOutcomes = { success: 0, error: 0, aborted: 0, timeout: 0 };

  private readonly aiTtfb = new DurationAccumulator();

  private readonly aiDuration = new DurationAccumulator();

  private d1RoundTrips = 0;

  private readonly d1Outcomes = { ok: 0, error: 0 };

  private readonly d1ErrorClasses = {
    none: 0,
    aborted: 0,
    timeout: 0,
    transport: 0,
    response: 0,
    unknown: 0,
  };

  private readonly d1Latency = new DurationAccumulator();

  private d1RowsRead = 0;

  private d1RowsWritten = 0;

  private redisCommands = 0;

  private readonly redisOutcomes = { ok: 0, error: 0, unavailable: 0 };

  private readonly redisByOperation = { connect: 0, ping: 0, 'rate-limit': 0, info: 0 };

  private readonly redisLatency = new DurationAccumulator();

  private redisServerStats: HonoRuntimeTelemetrySnapshot['redis']['server'] = {
    status: 'not-observed',
    capturedAt: null,
    usedMemoryBytes: null,
    evictedKeys: null,
    keyspaceHits: null,
    keyspaceMisses: null,
  };

  private readonly delayMonitor = monitorEventLoopDelay({
    resolution: EVENT_LOOP_DELAY_RESOLUTION_MS,
  });

  private readonly logger: (line: string) => void;

  private readonly errorLogger: (message: string, error: unknown) => void;

  private readonly sampleIntervalMs: number;

  private previousCpuUsage = process.cpuUsage();

  private previousSampleAt = performance.now();

  private previousEventLoopUtilization = performance.eventLoopUtilization();

  private sampleTimer: ReturnType<typeof setInterval> | null = null;

  private redisResourceSampler: (() => Promise<void>) | null = null;

  private resourceSnapshotInFlight: Promise<void> | null = null;

  constructor(options: HonoRuntimeTelemetryOptions = {}) {
    const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
    if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs < 1_000) {
      throw new Error('sampleIntervalMs 必须是大于或等于 1000 的有限数字');
    }
    this.logger = options.logger ?? ((line) => console.info(line));
    this.errorLogger = options.errorLogger
      ?? ((message, error) => console.error(message, error));
    this.sampleIntervalMs = sampleIntervalMs;
  }

  beginRequest(): FinishObservation {
    return this.requests.begin();
  }

  beginStream(): FinishObservation {
    return this.streams.begin();
  }

  beginSocket(): FinishObservation {
    return this.sockets.begin();
  }

  beginAiUpstream(): AiUpstreamAttemptObserver {
    this.aiAttemptsStarted += 1;
    const finishGauge = this.aiAttempts.begin();
    let ttfbRecorded = false;
    let finished = false;

    return {
      recordTtfb: (durationMs) => {
        if (ttfbRecorded || finished) return;
        ttfbRecorded = true;
        this.aiTtfb.observe(durationMs);
      },
      finish: (observation: AiUpstreamFinishObservation) => {
        if (finished) return;
        finished = true;
        finishGauge();
        this.aiAttemptsCompleted += 1;
        this.aiDuration.observe(observation.durationMs);
        switch (observation.outcome) {
          case 'success':
          case 'error':
          case 'aborted':
          case 'timeout':
            this.aiOutcomes[observation.outcome] += 1;
            break;
          default:
            this.aiOutcomes.error += 1;
        }
      },
    };
  }

  observeD1RoundTrip(observation: D1RoundTripObservation): void {
    this.d1RoundTrips += 1;
    this.d1Latency.observe(observation.durationMs);
    this.d1RowsRead += observation.rowsRead;
    this.d1RowsWritten += observation.rowsWritten;
    if (observation.outcome === 'ok') this.d1Outcomes.ok += 1;
    else this.d1Outcomes.error += 1;
    switch (observation.errorClass) {
      case 'none':
      case 'aborted':
      case 'timeout':
      case 'transport':
      case 'response':
      case 'unknown':
        this.d1ErrorClasses[observation.errorClass] += 1;
        break;
      default:
        this.d1ErrorClasses.unknown += 1;
    }
  }

  observeRedisOperation(observation: RedisRuntimeOperationObservation): void {
    this.redisCommands += 1;
    switch (observation.outcome) {
      case 'ok':
      case 'error':
      case 'unavailable':
        this.redisOutcomes[observation.outcome] += 1;
        break;
      default:
        this.redisOutcomes.error += 1;
    }
    switch (observation.operation) {
      case 'connect':
      case 'ping':
      case 'rate-limit':
      case 'info':
        this.redisByOperation[observation.operation] += 1;
        break;
      default:
        this.redisByOperation.info += 1;
    }
    if (observation.outcome !== 'unavailable') {
      this.redisLatency.observe(observation.durationMs);
    }
  }

  observeRedisServerStats(observation: RedisServerStatsObservation): void {
    this.redisServerStats = {
      status: 'observed',
      capturedAt: new Date().toISOString(),
      usedMemoryBytes: normalizeMetricInteger(observation.usedMemoryBytes),
      evictedKeys: normalizeMetricInteger(observation.evictedKeys),
      keyspaceHits: normalizeMetricInteger(observation.keyspaceHits),
      keyspaceMisses: normalizeMetricInteger(observation.keyspaceMisses),
    };
  }

  setRedisResourceSampler(sampler: () => Promise<void>): () => void {
    this.redisResourceSampler = sampler;
    return () => {
      if (this.redisResourceSampler === sampler) this.redisResourceSampler = null;
    };
  }

  start(): void {
    if (this.sampleTimer) return;
    this.delayMonitor.enable();
    this.sampleTimer = setInterval(() => {
      void this.emitSnapshotWithResources();
    }, this.sampleIntervalMs);
    this.sampleTimer.unref();
  }

  stop(): void {
    if (!this.sampleTimer) return;
    clearInterval(this.sampleTimer);
    this.sampleTimer = null;
    this.delayMonitor.disable();
  }

  snapshot(): HonoRuntimeTelemetrySnapshot {
    const capturedAt = new Date().toISOString();
    const sampledAt = performance.now();
    const elapsedMilliseconds = sampledAt - this.previousSampleAt;
    const cpuUsage = process.cpuUsage();
    const cpuDelta = {
      user: Math.max(0, cpuUsage.user - this.previousCpuUsage.user),
      system: Math.max(0, cpuUsage.system - this.previousCpuUsage.system),
    };
    const intervalCpuMilliseconds = (cpuDelta.user + cpuDelta.system) / 1_000;
    const intervalUtilization = elapsedMilliseconds > 0
      ? round(intervalCpuMilliseconds / elapsedMilliseconds)
      : null;
    this.previousCpuUsage = cpuUsage;
    this.previousSampleAt = sampledAt;

    const eventLoopUtilization = performance.eventLoopUtilization();
    const eventLoopDelta = performance.eventLoopUtilization(
      eventLoopUtilization,
      this.previousEventLoopUtilization,
    );
    this.previousEventLoopUtilization = eventLoopUtilization;

    const memory = process.memoryUsage();
    const heap = getHeapStatistics();
    const requestGauge = this.requests.read();
    const streamGauge = this.streams.read();
    const socketGauge = this.sockets.read();
    const aiAttemptGauge = this.aiAttempts.read();
    const delaySamples = this.delayMonitor.count;
    const hasDelaySamples = delaySamples > 0;

    return {
      event: TELEMETRY_EVENT,
      schemaVersion: 2,
      service: 'mahoshojo-hono',
      capturedAt,
      runtime: {
        origin: 'hono-node',
        selection: 'not-observed',
        failoverReason: null,
      },
      process: {
        uptimeSeconds: round(process.uptime(), 3),
        cpu: {
          userSeconds: round(cpuUsage.user / 1_000_000),
          systemSeconds: round(cpuUsage.system / 1_000_000),
          intervalUtilization,
        },
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          heapLimitBytes: heap.heap_size_limit,
        },
      },
      eventLoop: {
        utilization: round(Math.min(1, Math.max(0, eventLoopDelta.utilization))),
        activeMilliseconds: round(Math.max(0, eventLoopDelta.active), 3),
        idleMilliseconds: round(Math.max(0, eventLoopDelta.idle), 3),
        delay: {
          samples: delaySamples,
          meanMilliseconds: hasDelaySamples
            ? finiteOrNull(this.delayMonitor.mean / NANOSECONDS_PER_MILLISECOND)
            : null,
          p99Milliseconds: hasDelaySamples
            ? finiteOrNull(this.delayMonitor.percentile(99) / NANOSECONDS_PER_MILLISECOND)
            : null,
          maxMilliseconds: hasDelaySamples
            ? finiteOrNull(this.delayMonitor.max / NANOSECONDS_PER_MILLISECOND)
            : null,
        },
      },
      http: {
        activeRequests: requestGauge.active,
        peakActiveRequests: requestGauge.peak,
        activeStreams: streamGauge.active,
        peakActiveStreams: streamGauge.peak,
        activeSockets: socketGauge.active,
        peakActiveSockets: socketGauge.peak,
      },
      aiUpstream: {
        attempts: {
          active: aiAttemptGauge.active,
          peakActive: aiAttemptGauge.peak,
          started: this.aiAttemptsStarted,
          completed: this.aiAttemptsCompleted,
          outcomes: { ...this.aiOutcomes },
        },
        ttfb: this.aiTtfb.read(),
        duration: this.aiDuration.read(),
      },
      d1: {
        roundTrips: this.d1RoundTrips,
        outcomes: { ...this.d1Outcomes },
        errorClasses: { ...this.d1ErrorClasses },
        latency: this.d1Latency.read(),
        rows: { read: this.d1RowsRead, written: this.d1RowsWritten },
      },
      redis: {
        commands: this.redisCommands,
        outcomes: { ...this.redisOutcomes },
        byOperation: { ...this.redisByOperation },
        latency: this.redisLatency.read(),
        server: { ...this.redisServerStats },
      },
    };
  }

  private reportFailure(message: string, error: unknown): void {
    try {
      this.errorLogger(message, error);
    } catch {
      // Telemetry transport 失败不得影响请求处理或进程存活。
    }
  }

  emitSnapshot(): void {
    try {
      this.logger(JSON.stringify(this.snapshot()));
    } catch (error) {
      this.reportFailure('[hono][telemetry] 导出失败', error);
    } finally {
      try {
        this.delayMonitor.reset();
        this.requests.resetPeak();
        this.streams.resetPeak();
        this.sockets.resetPeak();
        this.aiAttempts.resetPeak();
        this.resetIntervalCounters();
      } catch (error) {
        this.reportFailure('[hono][telemetry] 采样状态重置失败', error);
      }
    }
  }

  emitSnapshotWithResources(): Promise<void> {
    if (this.resourceSnapshotInFlight) return this.resourceSnapshotInFlight;
    const run = async (): Promise<void> => {
      if (this.redisResourceSampler) {
        try {
          await this.redisResourceSampler();
        } catch (error) {
          this.reportFailure('[hono][telemetry] Redis 资源采样失败', error);
        }
      }
      this.emitSnapshot();
    };
    const inFlight = run();
    this.resourceSnapshotInFlight = inFlight;
    void inFlight.finally(() => {
      if (this.resourceSnapshotInFlight === inFlight) this.resourceSnapshotInFlight = null;
    });
    return inFlight;
  }

  async flushSnapshot(): Promise<void> {
    if (this.resourceSnapshotInFlight) await this.resourceSnapshotInFlight;
    await this.emitSnapshotWithResources();
  }

  private resetIntervalCounters(): void {
    this.aiAttemptsStarted = 0;
    this.aiAttemptsCompleted = 0;
    Object.assign(this.aiOutcomes, { success: 0, error: 0, aborted: 0, timeout: 0 });
    this.aiTtfb.reset();
    this.aiDuration.reset();
    this.d1RoundTrips = 0;
    Object.assign(this.d1Outcomes, { ok: 0, error: 0 });
    Object.assign(this.d1ErrorClasses, {
      none: 0,
      aborted: 0,
      timeout: 0,
      transport: 0,
      response: 0,
      unknown: 0,
    });
    this.d1Latency.reset();
    this.d1RowsRead = 0;
    this.d1RowsWritten = 0;
    this.redisCommands = 0;
    Object.assign(this.redisOutcomes, { ok: 0, error: 0, unavailable: 0 });
    Object.assign(this.redisByOperation, { connect: 0, ping: 0, 'rate-limit': 0, info: 0 });
    this.redisLatency.reset();
  }
}

const noopFinish = (): void => undefined;

export const noopRuntimeTelemetry: RuntimeTelemetryService = Object.freeze({
  beginRequest: () => noopFinish,
  beginStream: () => noopFinish,
  beginSocket: () => noopFinish,
});

export const isStreamingResponse = (path: string, response: Response): boolean => {
  if (!response.body || response.body.locked) return false;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/event-stream')) return true;
  return response.status < 400
    && path.split('/').some((segment) => segment === 'stream' || segment.endsWith('-stream'));
};

export const instrumentStreamingResponse = (
  response: Response,
  telemetry: RuntimeTelemetryService,
): Response => {
  if (!response.body || response.body.locked) return response;

  const source = response.body.getReader();
  const finishStream = telemetry.beginStream();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await source.read();
        if (result.done) {
          finishStream();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        finishStream();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await source.cancel(reason);
      } finally {
        finishStream();
      }
    },
  });

  try {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    finishStream();
    void source.cancel(error);
    throw error;
  }
};

type SocketLike = EventEmitter;

export const observeServerConnections = (
  server: EventEmitter,
  telemetry: RuntimeTelemetryService,
): (() => void) => {
  const handleConnection = (socket: SocketLike): void => {
    const finishSocket = telemetry.beginSocket();
    socket.once('close', finishSocket);
  };

  server.on('connection', handleConnection);
  return () => server.off('connection', handleConnection);
};
