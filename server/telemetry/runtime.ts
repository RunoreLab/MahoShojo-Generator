import type { EventEmitter } from 'node:events';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

const TELEMETRY_EVENT = 'hono.runtime.telemetry';
const DEFAULT_SAMPLE_INTERVAL_MS = 60_000;
const EVENT_LOOP_DELAY_RESOLUTION_MS = 20;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

type FinishObservation = () => void;

export interface RuntimeTelemetryService {
  beginRequest(): FinishObservation;
  beginStream(): FinishObservation;
  beginSocket(): FinishObservation;
}

export type HonoRuntimeTelemetrySnapshot = {
  event: 'hono.runtime.telemetry';
  schemaVersion: 1;
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

const round = (value: number, digits = 6): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const finiteOrNull = (value: number): number | null => (
  Number.isFinite(value) ? round(value) : null
);

export class HonoRuntimeTelemetry implements RuntimeTelemetryService {
  private readonly requests = new ActiveGauge();

  private readonly streams = new ActiveGauge();

  private readonly sockets = new ActiveGauge();

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

  start(): void {
    if (this.sampleTimer) return;
    this.delayMonitor.enable();
    this.sampleTimer = setInterval(() => this.emitSnapshot(), this.sampleIntervalMs);
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
    const delaySamples = this.delayMonitor.count;
    const hasDelaySamples = delaySamples > 0;

    return {
      event: TELEMETRY_EVENT,
      schemaVersion: 1,
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
      } catch (error) {
        this.reportFailure('[hono][telemetry] 采样状态重置失败', error);
      }
    }
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
