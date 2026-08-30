import type { EventEmitter } from 'node:events';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type {
  AiUpstreamAttemptObserver,
  AiUpstreamFinishObservation,
  D1RoundTripObservation,
  HostedGenerationLifecycleObservation,
  HostedRuntimeObserver,
} from '@mahoshojo/hosted-runtime/telemetry';
import type {
  ArenaGenerationObservation,
  ArenaGenerationObserver,
} from '@mahoshojo/hosted-api/arena-generation/service';
import type {
  ArenaRoomRuntimeObservation,
  ArenaRoomRuntimeObserver,
} from '#/arena-room/runtime-observer';
import type {
  RedisRuntimeObserver,
  RedisRuntimeOperationObservation,
  RedisServerStatsObservation,
} from '#/redis/runtime';

const TELEMETRY_EVENT = 'hono.runtime.telemetry';
const DEFAULT_SAMPLE_INTERVAL_MS = 60_000;
const DEFAULT_RESOURCE_SAMPLE_TIMEOUT_MS = 5_000;
const EVENT_LOOP_DELAY_RESOLUTION_MS = 20;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

type FinishObservation = () => void;

type DurationSummary = {
  samples: number;
  totalMilliseconds: number;
  maxMilliseconds: number | null;
  p50Milliseconds: number | null;
  p95Milliseconds: number | null;
  p99Milliseconds: number | null;
};

type OutcomeDurationSummary = {
  outcomes: { success: number; failure: number };
  duration: DurationSummary;
};

export interface RuntimeTelemetryService {
  beginRequest(): FinishObservation;
  beginStream(): FinishObservation;
  beginSocket(): FinishObservation;
}

export type HonoRuntimeTelemetrySnapshot = {
  event: 'hono.runtime.telemetry';
  schemaVersion: 5;
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
  hostedGeneration: {
    byOperation: {
      'generate-magical-girl-details': number;
      'generate-magical-girl-details-stream': number;
      'generate-sublimation': number;
      'generate-sublimation-stream': number;
    };
    byPlacement: { honoPrimary: number; nextDr: number };
    outcomes: { success: number; rejected: number; failure: number; cancelled: number };
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
      generation: number;
      room: number;
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
  arenaGeneration: {
    requests: {
      created: number;
      reused: number;
      conflicts: number;
      unavailable: number;
      secondProviderPreventions: number;
      inputBytes: number;
    };
    companion: {
      byOperation: {
        arenaGenerate: number;
        generateBattleStory: number;
        arenaSessionGenerateNext: number;
      };
      byPlacement: { honoPrimary: number; nextDr: number };
      outcomes: { success: number; rejected: number; failure: number; cancelled: number };
      duration: DurationSummary;
    };
    clientDisconnects: number;
    resume: {
      attempts: number;
      successes: number;
      failures: {
        unauthorized: number;
        notFound: number;
        stateUnavailable: number;
        cursorConflict: number;
        unknown: number;
      };
      latency: DurationSummary;
    };
    replay: { events: number; bytes: number; snapshotBootstraps: number };
    provider: {
      started: number;
      outcomes: { success: number; failure: number; cancelled: number };
      duration: DurationSummary;
    };
    phases: {
      safety: OutcomeDurationSummary;
      assembly: OutcomeDurationSummary;
      finalization: OutcomeDurationSummary;
    };
    r2: {
      outcomes: { success: number; failure: number };
      bytes: number;
      latency: DurationSummary;
    };
    cancels: { user: number };
    producerLost: number;
    redisDegraded: number;
    terminals: { completed: number; failed: number; cancelled: number; producerLost: number };
  };
  arenaRoom: {
    registry: {
      activeRooms: number;
      peakActiveRooms: number;
      residentActors: number;
      peakResidentActors: number;
    };
    actor: {
      queue: {
        queuedCurrent: number;
        peakQueued: number;
        peakPerRoom: number;
        overloads: number;
      };
      operations: {
        byOperation: { command: number; story: number };
        outcomes: { applied: number; idempotent: number; rejected: number; error: number };
        latency: DurationSummary;
      };
    };
    checkpoints: {
      byOperation: {
        load: number;
        save: number;
        refresh: number;
        expire: number;
        delete: number;
      };
      outcomes: {
        ok: number;
        missing: number;
        conflict: number;
        error: number;
        unavailable: number;
      };
      serializedBytes: {
        samples: number;
        totalBytes: number;
        maxBytes: number | null;
      };
      latency: DurationSummary;
    };
    sockets: {
      active: number;
      peakActive: number;
      opened: number;
      closed: number;
      slowConsumerResyncCloses: number;
      outbound: {
        queuedFramesCurrent: number;
        peakQueuedFrames: number;
        queuedBytesCurrent: number;
        peakQueuedBytes: number;
      };
    };
    sync: {
      reconnectAttempts: number;
      deliveries: { current: number; replay: number; snapshot: number };
      resync: { requested: number; required: number };
    };
    publishers: {
      active: number;
      peakActive: number;
      started: number;
      finished: number;
      outcomes: { published: number; rejected: number; dropped: number; error: number };
      inFlight: { current: number; peak: number };
    };
    incidents: {
      created: number;
      recovered: number;
      fenced: number;
      quarantined: number;
      replacementRequired: number;
    };
  };
};

export type HonoRuntimeTelemetryOptions = {
  logger?: (line: string) => void;
  errorLogger?: (message: string, error: unknown) => void;
  sampleIntervalMs?: number;
  resourceSampleTimeoutMs?: number;
};

type ResourceSampleResult = RedisServerStatsObservation | null;

type SettledResourceSample =
  | { outcome: 'ok'; value: ResourceSampleResult }
  | { outcome: 'error'; error: unknown }
  | { outcome: 'timeout' };

type ArenaGenerationAudit = {
  providerStarted: boolean;
  subscriberDisconnects: number;
  resumeAttempts: number;
  snapshotBootstrap: boolean;
  secondProviderPrevention: boolean;
  finalization: 'success' | 'failure' | 'not-observed';
  r2: 'success' | 'failure' | 'not-observed';
};

const createArenaGenerationAudit = (): ArenaGenerationAudit => ({
  providerStarted: false,
  subscriberDisconnects: 0,
  resumeAttempts: 0,
  snapshotBootstrap: false,
  secondProviderPrevention: false,
  finalization: 'not-observed',
  r2: 'not-observed',
});

const settleResourceSample = (
  sampler: () => Promise<ResourceSampleResult>,
  timeoutMs: number,
): Promise<SettledResourceSample> => new Promise((resolve) => {
  let settled = false;
  const finish = (result: SettledResourceSample): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve(result);
  };
  const timeout = setTimeout(() => finish({ outcome: 'timeout' }), timeoutMs);
  timeout.unref();
  void Promise.resolve()
    .then(sampler)
    .then(
      (value) => finish({ outcome: 'ok', value }),
      (error: unknown) => finish({ outcome: 'error', error }),
    );
});

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

class CurrentPeakGauge {
  private current = 0;

  private peak = 0;

  set(value: number): void {
    this.current = normalizeMetricInteger(value) ?? 0;
    this.peak = Math.max(this.peak, this.current);
  }

  increment(): void {
    this.set(this.current + 1);
  }

  decrement(): void {
    this.set(Math.max(0, this.current - 1));
  }

  read(): { current: number; peak: number } {
    return { current: this.current, peak: this.peak };
  }

  resetPeak(): void {
    this.peak = this.current;
  }
}

class IntegerAccumulator {
  private samples = 0;

  private total = 0;

  private max: number | null = null;

  observe(value: number): void {
    const normalized = normalizeMetricInteger(value);
    if (normalized === null) return;
    this.samples += 1;
    this.total = Math.min(Number.MAX_SAFE_INTEGER, this.total + normalized);
    this.max = Math.max(this.max ?? 0, normalized);
  }

  read(): { samples: number; total: number; max: number | null } {
    return { samples: this.samples, total: this.total, max: this.max };
  }

  reset(): void {
    this.samples = 0;
    this.total = 0;
    this.max = null;
  }
}

class DurationAccumulator {
  private samples = 0;

  private totalMilliseconds = 0;

  private maxMilliseconds: number | null = null;

  private readonly values: number[] = [];

  observe(durationMs: number): void {
    const normalized = normalizeDuration(durationMs);
    this.samples += 1;
    this.totalMilliseconds += normalized;
    this.maxMilliseconds = Math.max(this.maxMilliseconds ?? 0, normalized);
    if (this.values.length < 4_096) this.values.push(normalized);
  }

  private percentile(percentile: number): number | null {
    if (this.values.length === 0) return null;
    const sorted = [...this.values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
    return round(sorted[index] ?? 0, 3);
  }

  read(): DurationSummary {
    return {
      samples: this.samples,
      totalMilliseconds: round(this.totalMilliseconds, 3),
      maxMilliseconds: this.maxMilliseconds === null
        ? null
        : round(this.maxMilliseconds, 3),
      p50Milliseconds: this.percentile(50),
      p95Milliseconds: this.percentile(95),
      p99Milliseconds: this.percentile(99),
    };
  }

  reset(): void {
    this.samples = 0;
    this.totalMilliseconds = 0;
    this.maxMilliseconds = null;
    this.values.length = 0;
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
  RedisRuntimeObserver,
  ArenaGenerationObserver,
  ArenaRoomRuntimeObserver {
  private readonly requests = new ActiveGauge();

  private readonly streams = new ActiveGauge();

  private readonly sockets = new ActiveGauge();

  private readonly aiAttempts = new ActiveGauge();

  private aiAttemptsStarted = 0;

  private aiAttemptsCompleted = 0;

  private readonly aiOutcomes = { success: 0, error: 0, aborted: 0, timeout: 0 };

  private readonly aiTtfb = new DurationAccumulator();

  private readonly aiDuration = new DurationAccumulator();

  private readonly hostedGenerationByOperation = {
    'generate-magical-girl-details': 0,
    'generate-magical-girl-details-stream': 0,
    'generate-sublimation': 0,
    'generate-sublimation-stream': 0,
  };

  private readonly hostedGenerationByPlacement = { honoPrimary: 0, nextDr: 0 };

  private readonly hostedGenerationOutcomes = {
    success: 0,
    rejected: 0,
    failure: 0,
    cancelled: 0,
  };

  private readonly hostedGenerationDuration = new DurationAccumulator();

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

  private readonly redisByOperation = {
    connect: 0,
    ping: 0,
    'rate-limit': 0,
    generation: 0,
    room: 0,
    info: 0,
  };

  private readonly redisLatency = new DurationAccumulator();

  private redisServerStats: HonoRuntimeTelemetrySnapshot['redis']['server'] = {
    status: 'not-observed',
    capturedAt: null,
    usedMemoryBytes: null,
    evictedKeys: null,
    keyspaceHits: null,
    keyspaceMisses: null,
  };

  private readonly arenaRequests = {
    created: 0,
    reused: 0,
    conflicts: 0,
    unavailable: 0,
    secondProviderPreventions: 0,
    inputBytes: 0,
  };

  private readonly arenaCompanionByOperation = {
    arenaGenerate: 0,
    generateBattleStory: 0,
    arenaSessionGenerateNext: 0,
  };

  private readonly arenaCompanionByPlacement = { honoPrimary: 0, nextDr: 0 };

  private readonly arenaCompanionOutcomes = {
    success: 0,
    rejected: 0,
    failure: 0,
    cancelled: 0,
  };

  private readonly arenaCompanionDuration = new DurationAccumulator();

  private arenaClientDisconnects = 0;

  private arenaResumeAttempts = 0;

  private arenaResumeSuccesses = 0;

  private readonly arenaResumeFailures = {
    unauthorized: 0,
    notFound: 0,
    stateUnavailable: 0,
    cursorConflict: 0,
    unknown: 0,
  };

  private readonly arenaResumeLatency = new DurationAccumulator();

  private readonly arenaReplay = { events: 0, bytes: 0, snapshotBootstraps: 0 };

  private arenaProviderStarted = 0;

  private readonly arenaProviderOutcomes = { success: 0, failure: 0, cancelled: 0 };

  private readonly arenaProviderDuration = new DurationAccumulator();

  private readonly arenaPhaseOutcomes = {
    safety: { success: 0, failure: 0 },
    prompt: { success: 0, failure: 0 },
    finalization: { success: 0, failure: 0 },
  };

  private readonly arenaPhaseDurations = {
    safety: new DurationAccumulator(),
    prompt: new DurationAccumulator(),
    finalization: new DurationAccumulator(),
  };

  private readonly arenaR2Outcomes = { success: 0, failure: 0 };

  private readonly arenaR2Latency = new DurationAccumulator();

  private arenaR2Bytes = 0;

  private arenaUserCancels = 0;

  private arenaProducerLost = 0;

  private arenaRedisDegraded = 0;

  private readonly arenaTerminals = {
    completed: 0,
    failed: 0,
    cancelled: 0,
    producerLost: 0,
  };

  private readonly arenaAudits = new Map<string, ArenaGenerationAudit>();

  private readonly roomActiveRooms = new CurrentPeakGauge();

  private readonly roomResidentActors = new CurrentPeakGauge();

  private readonly roomActorQueued = new CurrentPeakGauge();

  private roomActorPeakPerRoom = 0;

  private roomActorOverloads = 0;

  private readonly roomActorOperations = { command: 0, story: 0 };

  private readonly roomActorOutcomes = {
    applied: 0,
    idempotent: 0,
    rejected: 0,
    error: 0,
  };

  private readonly roomActorLatency = new DurationAccumulator();

  private readonly roomCheckpointOperations = {
    load: 0,
    save: 0,
    refresh: 0,
    expire: 0,
    delete: 0,
  };

  private readonly roomCheckpointOutcomes = {
    ok: 0,
    missing: 0,
    conflict: 0,
    error: 0,
    unavailable: 0,
  };

  private readonly roomCheckpointBytes = new IntegerAccumulator();

  private readonly roomCheckpointLatency = new DurationAccumulator();

  private readonly roomSockets = new CurrentPeakGauge();

  private roomSocketsOpened = 0;

  private roomSocketsClosed = 0;

  private roomSlowConsumerResyncCloses = 0;

  private readonly roomOutboundQueuedFrames = new CurrentPeakGauge();

  private readonly roomOutboundQueuedBytes = new CurrentPeakGauge();

  private roomReconnectAttempts = 0;

  private readonly roomSyncDeliveries = { current: 0, replay: 0, snapshot: 0 };

  private readonly roomResync = { requested: 0, required: 0 };

  private readonly roomPublishers = new CurrentPeakGauge();

  private roomPublishersStarted = 0;

  private roomPublishersFinished = 0;

  private readonly roomPublisherOutcomes = {
    published: 0,
    rejected: 0,
    dropped: 0,
    error: 0,
  };

  private readonly roomPublisherInFlight = new CurrentPeakGauge();

  private readonly roomIncidents = {
    created: 0,
    recovered: 0,
    fenced: 0,
    quarantined: 0,
    replacementRequired: 0,
  };

  private readonly delayMonitor = monitorEventLoopDelay({
    resolution: EVENT_LOOP_DELAY_RESOLUTION_MS,
  });

  private readonly logger: (line: string) => void;

  private readonly errorLogger: (message: string, error: unknown) => void;

  private readonly sampleIntervalMs: number;

  private readonly resourceSampleTimeoutMs: number;

  private previousCpuUsage = process.cpuUsage();

  private previousSampleAt = performance.now();

  private previousEventLoopUtilization = performance.eventLoopUtilization();

  private sampleTimer: ReturnType<typeof setInterval> | null = null;

  private redisResourceSampler: (() => Promise<ResourceSampleResult>) | null = null;

  private resourceSnapshotInFlight: Promise<void> | null = null;

  constructor(options: HonoRuntimeTelemetryOptions = {}) {
    const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
    if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs < 1_000) {
      throw new Error('sampleIntervalMs 必须是大于或等于 1000 的有限数字');
    }
    const resourceSampleTimeoutMs = options.resourceSampleTimeoutMs
      ?? Math.min(DEFAULT_RESOURCE_SAMPLE_TIMEOUT_MS, sampleIntervalMs - 1);
    if (
      !Number.isFinite(resourceSampleTimeoutMs)
      || resourceSampleTimeoutMs < 1
      || resourceSampleTimeoutMs >= sampleIntervalMs
    ) {
      throw new Error('resourceSampleTimeoutMs 必须是小于采样周期的正有限数字');
    }
    this.logger = options.logger ?? ((line) => console.info(line));
    this.errorLogger = options.errorLogger
      ?? ((message, context) => console.error(message, context));
    this.sampleIntervalMs = sampleIntervalMs;
    this.resourceSampleTimeoutMs = resourceSampleTimeoutMs;
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

  observeHostedGenerationLifecycle(observation: HostedGenerationLifecycleObservation): void {
    this.hostedGenerationByOperation[observation.operation] += 1;
    const placement = observation.placement === 'hono-primary' ? 'honoPrimary' : 'nextDr';
    this.hostedGenerationByPlacement[placement] += 1;
    this.hostedGenerationOutcomes[observation.outcome] += 1;
    this.hostedGenerationDuration.observe(observation.durationMs);
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
      case 'generation':
      case 'room':
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

  private getArenaAudit(generationId: string): ArenaGenerationAudit {
    const existing = this.arenaAudits.get(generationId);
    if (existing) return existing;
    if (this.arenaAudits.size >= 10_000) {
      const oldest = this.arenaAudits.keys().next().value as string | undefined;
      if (oldest) this.arenaAudits.delete(oldest);
    }
    const created = createArenaGenerationAudit();
    this.arenaAudits.set(generationId, created);
    return created;
  }

  observeArenaGeneration(observation: ArenaGenerationObservation): void {
    switch (observation.event) {
      case 'companion': {
        const operation = observation.operation === 'arena/generate'
          ? 'arenaGenerate'
          : observation.operation === 'generate-battle-story'
            ? 'generateBattleStory'
            : 'arenaSessionGenerateNext';
        const placement = observation.placement === 'hono-primary' ? 'honoPrimary' : 'nextDr';
        this.arenaCompanionByOperation[operation] += 1;
        this.arenaCompanionByPlacement[placement] += 1;
        this.arenaCompanionOutcomes[observation.outcome] += 1;
        this.arenaCompanionDuration.observe(observation.durationMs);
        break;
      }
      case 'request': {
        this.arenaRequests.inputBytes += Math.max(0, Math.floor(observation.inputBytes));
        if (observation.outcome === 'created') this.arenaRequests.created += 1;
        else if (observation.outcome === 'reused') {
          this.arenaRequests.reused += 1;
          this.arenaRequests.secondProviderPreventions += 1;
          this.getArenaAudit(observation.generationId).secondProviderPrevention = true;
        } else if (observation.outcome === 'conflict') this.arenaRequests.conflicts += 1;
        else this.arenaRequests.unavailable += 1;
        if (observation.outcome === 'created') this.getArenaAudit(observation.generationId);
        break;
      }
      case 'client_disconnect':
        this.arenaClientDisconnects += 1;
        this.getArenaAudit(observation.generationId).subscriberDisconnects += 1;
        break;
      case 'resume': {
        if (observation.outcome === 'attempt') {
          this.arenaResumeAttempts += 1;
          this.getArenaAudit(observation.generationId).resumeAttempts += 1;
        } else if (observation.outcome === 'success') {
          this.arenaResumeSuccesses += 1;
          this.arenaResumeLatency.observe(observation.latencyMs ?? 0);
        } else {
          const key = observation.reason === 'not_found'
            ? 'notFound'
            : observation.reason === 'state_unavailable'
              ? 'stateUnavailable'
              : observation.reason === 'cursor_conflict'
                ? 'cursorConflict'
                : observation.reason === 'unauthorized'
                  ? 'unauthorized'
                  : 'unknown';
          this.arenaResumeFailures[key] += 1;
          this.arenaResumeLatency.observe(observation.latencyMs ?? 0);
        }
        break;
      }
      case 'replay':
        this.arenaReplay.events += Math.max(0, Math.floor(observation.events));
        this.arenaReplay.bytes += Math.max(0, Math.floor(observation.bytes));
        if (observation.snapshotBootstrap) {
          this.arenaReplay.snapshotBootstraps += 1;
          this.getArenaAudit(observation.generationId).snapshotBootstrap = true;
        }
        break;
      case 'provider':
        if (observation.outcome === 'started') {
          this.arenaProviderStarted += 1;
          this.getArenaAudit(observation.generationId).providerStarted = true;
        } else {
          this.arenaProviderOutcomes[observation.outcome] += 1;
          this.arenaProviderDuration.observe(observation.durationMs ?? 0);
        }
        break;
      case 'phase':
        this.arenaPhaseOutcomes[observation.phase][observation.outcome] += 1;
        this.arenaPhaseDurations[observation.phase].observe(observation.durationMs);
        if (observation.phase === 'finalization' && observation.generationId) {
          this.getArenaAudit(observation.generationId).finalization = observation.outcome;
        }
        break;
      case 'storage':
        this.arenaR2Outcomes[observation.outcome] += 1;
        this.arenaR2Latency.observe(observation.durationMs);
        this.arenaR2Bytes += Math.max(0, Math.floor(observation.bytes ?? 0));
        this.getArenaAudit(observation.generationId).r2 = observation.outcome;
        break;
      case 'cancel':
        this.arenaUserCancels += 1;
        break;
      case 'producer_lost':
        this.arenaProducerLost += 1;
        break;
      case 'redis_degraded':
        this.arenaRedisDegraded += 1;
        break;
      case 'terminal': {
        const terminalKey = observation.status === 'producer_lost'
          ? 'producerLost'
          : observation.status;
        this.arenaTerminals[terminalKey] += 1;
        const audit = this.getArenaAudit(observation.generationId);
        try {
          this.logger(JSON.stringify({
            event: 'arena.generation.terminal.audit',
            schemaVersion: 1,
            runtime: 'hono-node',
            generationId: observation.generationId,
            providerStarted: audit.providerStarted,
            subscriberDisconnects: audit.subscriberDisconnects,
            resumeAttempts: audit.resumeAttempts,
            snapshotBootstrap: audit.snapshotBootstrap,
            secondProviderPrevention: audit.secondProviderPrevention,
            terminal: { status: observation.status, code: observation.code },
            finalization: audit.finalization,
            r2: audit.r2,
          }));
        } catch {
          // Terminal audit transport failures never affect the producer.
        }
        this.arenaAudits.delete(observation.generationId);
        break;
      }
      default:
        break;
    }
  }

  observeArenaRoomRuntime(observation: ArenaRoomRuntimeObservation): void {
    switch (observation.event) {
      case 'registry':
        this.roomActiveRooms.set(observation.activeRooms);
        this.roomResidentActors.set(observation.residentActors);
        break;
      case 'actor_queue': {
        this.roomActorQueued.set(observation.queuedCurrent);
        const roomQueued = normalizeMetricInteger(observation.roomQueuedCurrent) ?? 0;
        this.roomActorPeakPerRoom = Math.max(this.roomActorPeakPerRoom, roomQueued);
        if (observation.overloaded === true) this.roomActorOverloads += 1;
        break;
      }
      case 'actor_operation':
        switch (observation.operation) {
          case 'command':
          case 'story':
            this.roomActorOperations[observation.operation] += 1;
            break;
          default:
            break;
        }
        switch (observation.outcome) {
          case 'applied':
          case 'idempotent':
          case 'rejected':
          case 'error':
            this.roomActorOutcomes[observation.outcome] += 1;
            break;
          default:
            this.roomActorOutcomes.error += 1;
        }
        this.roomActorLatency.observe(observation.durationMs);
        break;
      case 'checkpoint':
        switch (observation.operation) {
          case 'load':
          case 'save':
          case 'refresh':
          case 'expire':
          case 'delete':
            this.roomCheckpointOperations[observation.operation] += 1;
            break;
          default:
            break;
        }
        switch (observation.outcome) {
          case 'ok':
          case 'missing':
          case 'conflict':
          case 'error':
          case 'unavailable':
            this.roomCheckpointOutcomes[observation.outcome] += 1;
            break;
          default:
            this.roomCheckpointOutcomes.error += 1;
        }
        if (observation.serializedBytes !== undefined) {
          this.roomCheckpointBytes.observe(observation.serializedBytes);
        }
        this.roomCheckpointLatency.observe(observation.durationMs);
        break;
      case 'socket':
        if (observation.action === 'opened') {
          this.roomSockets.increment();
          this.roomSocketsOpened += 1;
        } else if (observation.action === 'closed') {
          this.roomSockets.decrement();
          this.roomSocketsClosed += 1;
        }
        break;
      case 'socket_backlog':
        this.roomOutboundQueuedFrames.set(observation.queuedFrames);
        this.roomOutboundQueuedBytes.set(observation.queuedBytes);
        break;
      case 'slow_consumer_resync_close':
        this.roomSlowConsumerResyncCloses += 1;
        break;
      case 'sync':
        if (observation.action === 'reconnect_attempt') {
          this.roomReconnectAttempts += 1;
        } else if (observation.action === 'delivery') {
          switch (observation.mode) {
            case 'current':
            case 'replay':
            case 'snapshot':
              this.roomSyncDeliveries[observation.mode] += 1;
              break;
            default:
              break;
          }
        } else if (observation.action === 'resync_requested') {
          this.roomResync.requested += 1;
        } else if (observation.action === 'resync_required') {
          this.roomResync.required += 1;
        }
        break;
      case 'publisher':
        if (observation.action === 'started') {
          this.roomPublishers.increment();
          this.roomPublishersStarted += 1;
        } else if (observation.action === 'finished') {
          this.roomPublishers.decrement();
          this.roomPublishersFinished += 1;
        }
        break;
      case 'publisher_backlog':
        this.roomPublisherInFlight.set(observation.inFlightCurrent);
        break;
      case 'publisher_outcome':
        switch (observation.outcome) {
          case 'published':
          case 'rejected':
          case 'dropped':
          case 'error':
            this.roomPublisherOutcomes[observation.outcome] += 1;
            break;
          default:
            this.roomPublisherOutcomes.error += 1;
        }
        break;
      case 'incident':
        switch (observation.outcome) {
          case 'created':
          case 'recovered':
          case 'fenced':
          case 'quarantined':
            this.roomIncidents[observation.outcome] += 1;
            break;
          case 'replacement_required':
            this.roomIncidents.replacementRequired += 1;
            break;
          default:
            break;
        }
        break;
      default:
        break;
    }
  }

  setRedisResourceSampler(sampler: () => Promise<ResourceSampleResult>): () => void {
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
    const roomActiveRooms = this.roomActiveRooms.read();
    const roomResidentActors = this.roomResidentActors.read();
    const roomActorQueued = this.roomActorQueued.read();
    const roomCheckpointBytes = this.roomCheckpointBytes.read();
    const roomSockets = this.roomSockets.read();
    const roomOutboundQueuedFrames = this.roomOutboundQueuedFrames.read();
    const roomOutboundQueuedBytes = this.roomOutboundQueuedBytes.read();
    const roomPublishers = this.roomPublishers.read();
    const roomPublisherInFlight = this.roomPublisherInFlight.read();
    const delaySamples = this.delayMonitor.count;
    const hasDelaySamples = delaySamples > 0;

    return {
      event: TELEMETRY_EVENT,
      schemaVersion: 5,
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
      hostedGeneration: {
        byOperation: { ...this.hostedGenerationByOperation },
        byPlacement: { ...this.hostedGenerationByPlacement },
        outcomes: { ...this.hostedGenerationOutcomes },
        duration: this.hostedGenerationDuration.read(),
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
      arenaGeneration: {
        requests: { ...this.arenaRequests },
        companion: {
          byOperation: { ...this.arenaCompanionByOperation },
          byPlacement: { ...this.arenaCompanionByPlacement },
          outcomes: { ...this.arenaCompanionOutcomes },
          duration: this.arenaCompanionDuration.read(),
        },
        clientDisconnects: this.arenaClientDisconnects,
        resume: {
          attempts: this.arenaResumeAttempts,
          successes: this.arenaResumeSuccesses,
          failures: { ...this.arenaResumeFailures },
          latency: this.arenaResumeLatency.read(),
        },
        replay: { ...this.arenaReplay },
        provider: {
          started: this.arenaProviderStarted,
          outcomes: { ...this.arenaProviderOutcomes },
          duration: this.arenaProviderDuration.read(),
        },
        phases: {
          safety: {
            outcomes: { ...this.arenaPhaseOutcomes.safety },
            duration: this.arenaPhaseDurations.safety.read(),
          },
          assembly: {
            outcomes: { ...this.arenaPhaseOutcomes.prompt },
            duration: this.arenaPhaseDurations.prompt.read(),
          },
          finalization: {
            outcomes: { ...this.arenaPhaseOutcomes.finalization },
            duration: this.arenaPhaseDurations.finalization.read(),
          },
        },
        r2: {
          outcomes: { ...this.arenaR2Outcomes },
          bytes: this.arenaR2Bytes,
          latency: this.arenaR2Latency.read(),
        },
        cancels: { user: this.arenaUserCancels },
        producerLost: this.arenaProducerLost,
        redisDegraded: this.arenaRedisDegraded,
        terminals: { ...this.arenaTerminals },
      },
      arenaRoom: {
        registry: {
          activeRooms: roomActiveRooms.current,
          peakActiveRooms: roomActiveRooms.peak,
          residentActors: roomResidentActors.current,
          peakResidentActors: roomResidentActors.peak,
        },
        actor: {
          queue: {
            queuedCurrent: roomActorQueued.current,
            peakQueued: roomActorQueued.peak,
            peakPerRoom: this.roomActorPeakPerRoom,
            overloads: this.roomActorOverloads,
          },
          operations: {
            byOperation: { ...this.roomActorOperations },
            outcomes: { ...this.roomActorOutcomes },
            latency: this.roomActorLatency.read(),
          },
        },
        checkpoints: {
          byOperation: { ...this.roomCheckpointOperations },
          outcomes: { ...this.roomCheckpointOutcomes },
          serializedBytes: {
            samples: roomCheckpointBytes.samples,
            totalBytes: roomCheckpointBytes.total,
            maxBytes: roomCheckpointBytes.max,
          },
          latency: this.roomCheckpointLatency.read(),
        },
        sockets: {
          active: roomSockets.current,
          peakActive: roomSockets.peak,
          opened: this.roomSocketsOpened,
          closed: this.roomSocketsClosed,
          slowConsumerResyncCloses: this.roomSlowConsumerResyncCloses,
          outbound: {
            queuedFramesCurrent: roomOutboundQueuedFrames.current,
            peakQueuedFrames: roomOutboundQueuedFrames.peak,
            queuedBytesCurrent: roomOutboundQueuedBytes.current,
            peakQueuedBytes: roomOutboundQueuedBytes.peak,
          },
        },
        sync: {
          reconnectAttempts: this.roomReconnectAttempts,
          deliveries: { ...this.roomSyncDeliveries },
          resync: { ...this.roomResync },
        },
        publishers: {
          active: roomPublishers.current,
          peakActive: roomPublishers.peak,
          started: this.roomPublishersStarted,
          finished: this.roomPublishersFinished,
          outcomes: { ...this.roomPublisherOutcomes },
          inFlight: {
            current: roomPublisherInFlight.current,
            peak: roomPublisherInFlight.peak,
          },
        },
        incidents: { ...this.roomIncidents },
      },
    };
  }

  private reportFailure(message: string, _error: unknown): void {
    try {
      this.errorLogger(message, { errorClass: 'telemetry_operation_failed' });
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
        this.roomActiveRooms.resetPeak();
        this.roomResidentActors.resetPeak();
        this.roomActorQueued.resetPeak();
        this.roomSockets.resetPeak();
        this.roomOutboundQueuedFrames.resetPeak();
        this.roomOutboundQueuedBytes.resetPeak();
        this.roomPublishers.resetPeak();
        this.roomPublisherInFlight.resetPeak();
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
        const result = await settleResourceSample(
          this.redisResourceSampler,
          this.resourceSampleTimeoutMs,
        );
        if (result.outcome === 'ok') {
          if (result.value) this.observeRedisServerStats(result.value);
        } else if (result.outcome === 'timeout') {
          this.reportFailure(
            '[hono][telemetry] Redis 资源采样超时',
            new Error('REDIS_RESOURCE_SAMPLE_TIMEOUT'),
          );
        } else {
          this.reportFailure('[hono][telemetry] Redis 资源采样失败', result.error);
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
    Object.assign(this.hostedGenerationByOperation, {
      'generate-magical-girl-details': 0,
      'generate-magical-girl-details-stream': 0,
      'generate-sublimation': 0,
      'generate-sublimation-stream': 0,
    });
    Object.assign(this.hostedGenerationByPlacement, { honoPrimary: 0, nextDr: 0 });
    Object.assign(this.hostedGenerationOutcomes, {
      success: 0,
      rejected: 0,
      failure: 0,
      cancelled: 0,
    });
    this.hostedGenerationDuration.reset();
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
    Object.assign(this.redisByOperation, {
      connect: 0,
      ping: 0,
      'rate-limit': 0,
      generation: 0,
      room: 0,
      info: 0,
    });
    this.redisLatency.reset();
    Object.assign(this.arenaRequests, {
      created: 0,
      reused: 0,
      conflicts: 0,
      unavailable: 0,
      secondProviderPreventions: 0,
      inputBytes: 0,
    });
    Object.assign(this.arenaCompanionByOperation, {
      arenaGenerate: 0,
      generateBattleStory: 0,
      arenaSessionGenerateNext: 0,
    });
    Object.assign(this.arenaCompanionByPlacement, { honoPrimary: 0, nextDr: 0 });
    Object.assign(this.arenaCompanionOutcomes, {
      success: 0,
      rejected: 0,
      failure: 0,
      cancelled: 0,
    });
    this.arenaCompanionDuration.reset();
    this.arenaClientDisconnects = 0;
    this.arenaResumeAttempts = 0;
    this.arenaResumeSuccesses = 0;
    Object.assign(this.arenaResumeFailures, {
      unauthorized: 0,
      notFound: 0,
      stateUnavailable: 0,
      cursorConflict: 0,
      unknown: 0,
    });
    this.arenaResumeLatency.reset();
    Object.assign(this.arenaReplay, { events: 0, bytes: 0, snapshotBootstraps: 0 });
    this.arenaProviderStarted = 0;
    Object.assign(this.arenaProviderOutcomes, { success: 0, failure: 0, cancelled: 0 });
    this.arenaProviderDuration.reset();
    for (const phase of ['safety', 'prompt', 'finalization'] as const) {
      Object.assign(this.arenaPhaseOutcomes[phase], { success: 0, failure: 0 });
      this.arenaPhaseDurations[phase].reset();
    }
    Object.assign(this.arenaR2Outcomes, { success: 0, failure: 0 });
    this.arenaR2Latency.reset();
    this.arenaR2Bytes = 0;
    this.arenaUserCancels = 0;
    this.arenaProducerLost = 0;
    this.arenaRedisDegraded = 0;
    Object.assign(this.arenaTerminals, {
      completed: 0,
      failed: 0,
      cancelled: 0,
      producerLost: 0,
    });
    this.roomActorPeakPerRoom = 0;
    this.roomActorOverloads = 0;
    Object.assign(this.roomActorOperations, { command: 0, story: 0 });
    Object.assign(this.roomActorOutcomes, {
      applied: 0,
      idempotent: 0,
      rejected: 0,
      error: 0,
    });
    this.roomActorLatency.reset();
    Object.assign(this.roomCheckpointOperations, {
      load: 0,
      save: 0,
      refresh: 0,
      expire: 0,
      delete: 0,
    });
    Object.assign(this.roomCheckpointOutcomes, {
      ok: 0,
      missing: 0,
      conflict: 0,
      error: 0,
      unavailable: 0,
    });
    this.roomCheckpointBytes.reset();
    this.roomCheckpointLatency.reset();
    this.roomSocketsOpened = 0;
    this.roomSocketsClosed = 0;
    this.roomSlowConsumerResyncCloses = 0;
    this.roomReconnectAttempts = 0;
    Object.assign(this.roomSyncDeliveries, { current: 0, replay: 0, snapshot: 0 });
    Object.assign(this.roomResync, { requested: 0, required: 0 });
    this.roomPublishersStarted = 0;
    this.roomPublishersFinished = 0;
    Object.assign(this.roomPublisherOutcomes, {
      published: 0,
      rejected: 0,
      dropped: 0,
      error: 0,
    });
    Object.assign(this.roomIncidents, {
      created: 0,
      recovered: 0,
      fenced: 0,
      quarantined: 0,
      replacementRequired: 0,
    });
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
