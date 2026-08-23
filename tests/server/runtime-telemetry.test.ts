import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  HonoRuntimeTelemetry,
  instrumentStreamingResponse,
  isStreamingResponse,
  observeServerConnections,
} from '@/server/telemetry/runtime';

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
      schemaVersion: 1,
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

  it('以不含请求正文和凭据的结构化日志导出快照', () => {
    vi.stubEnv('AI_API_KEY', 'telemetry-secret-canary');
    vi.stubEnv('D1_GATEWAY_HMAC_SECRET', 'telemetry-hmac-canary');
    const logger = vi.fn();
    const telemetry = new HonoRuntimeTelemetry({ logger });
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

    const errorLogger = vi.fn();
    const telemetry = new HonoRuntimeTelemetry({
      logger: () => {
        throw new Error('log transport unavailable');
      },
      errorLogger,
    });
    expect(() => telemetry.emitSnapshot()).not.toThrow();
    expect(errorLogger).toHaveBeenCalledWith(
      '[hono][telemetry] 导出失败',
      expect.any(Error),
    );
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
    let sourceController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });
    const response = instrumentStreamingResponse(new Response(source, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }), telemetry);

    expect(telemetry.snapshot().http.activeStreams).toBe(1);
    sourceController?.enqueue(encoder.encode('event: done\n\n'));
    sourceController?.close();
    await expect(response.text()).resolves.toBe('event: done\n\n');
    expect(telemetry.snapshot().http.activeStreams).toBe(0);

    const pending = new ReadableStream<Uint8Array>();
    const cancelled = instrumentStreamingResponse(new Response(pending, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }), telemetry);
    expect(telemetry.snapshot().http.activeStreams).toBe(1);
    await cancelled.body?.cancel('client disconnected');
    expect(telemetry.snapshot().http.activeStreams).toBe(0);

    let errorController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const failing = instrumentStreamingResponse(new Response(new ReadableStream({
      start(controller) {
        errorController = controller;
      },
    })), telemetry);
    expect(telemetry.snapshot().http.activeStreams).toBe(1);
    errorController?.error(new Error('upstream failed'));
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
