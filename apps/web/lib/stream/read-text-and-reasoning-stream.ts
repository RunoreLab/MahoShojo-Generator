import {
  appendReasoningDelta,
  extractHeuristicReasoningFromMarkdown,
  normalizeReasoningSource,
  updateReasoningStatus,
} from '@/lib/ai/reasoning-normalizer';
import { readTextStreamFromResponse, type ReadTextStreamFromResponseOptions } from '@/lib/stream/read-text-stream';
import {
  createStreamReadWithTimeout,
  STREAM_READ_IDLE_TIMEOUT_MS,
  STREAM_READ_TOTAL_TIMEOUT_MS,
  type StreamReadTimeoutMode,
} from '@/lib/stream/timeout';
import type { AIReasoningEnvelope, AIReasoningStatus } from '@/types/ai-reasoning';

type SseEventChunk = {
  event: string;
  data: string;
};

export type ReadTextAndReasoningStreamOptions = ReadTextStreamFromResponseOptions & {
  onReasoning?: (reasoning: AIReasoningEnvelope | null) => void;
  onTelemetry?: (payload: Record<string, unknown>) => void;
  onMeta?: (payload: Record<string, unknown>) => void;
  onEvent?: (event: string, payload: unknown) => void;
};

export type ReadTextAndReasoningStreamResult = {
  text: string;
  reasoning: AIReasoningEnvelope | null;
  telemetry: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  isSse: boolean;
};

const parseSseBlock = (block: string): SseEventChunk | null => {
  const lines = block.split('\n');
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
};

const tryParseJson = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const normalizeReasoningDoneStatus = (value: unknown): AIReasoningStatus => {
  if (value === 'unavailable') return 'unavailable';
  return 'done';
};

const extractReasoningTokensFromTelemetry = (payload: Record<string, unknown> | null): number | null => {
  if (!payload || typeof payload !== 'object') return null;
  const usage = payload.usage;
  if (!usage || typeof usage !== 'object') return null;
  const usageRecord = usage as Record<string, unknown>;
  const value = usageRecord.reasoningTokens ?? usageRecord.reasoning_tokens;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

export async function readTextAndReasoningStreamFromResponse(
  response: Response,
  options: ReadTextAndReasoningStreamOptions = {}
): Promise<ReadTextAndReasoningStreamResult> {
  const { onReasoning, onTelemetry, onMeta, onEvent, ...textStreamOptions } = options;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isSse = contentType.includes('text/event-stream');

  if (!isSse) {
    const text = await readTextStreamFromResponse(response, textStreamOptions);
    const heuristicReasoning = extractHeuristicReasoningFromMarkdown(text);
    onReasoning?.(heuristicReasoning);
    return {
      text,
      reasoning: heuristicReasoning,
      telemetry: null,
      meta: null,
      isSse: false,
    };
  }

  const reader = response.body?.getReader() ?? null;
  if (!reader) {
    throw new Error('无法读取响应流，请使用最新版本的浏览器。');
  }

  const decoder = new TextDecoder();
  let accumulatedText = '';
  let sseBuffer = '';
  let sawDone = false;
  let latestTelemetry: Record<string, unknown> | null = null;
  let latestMeta: Record<string, unknown> | null = null;
  let latestReasoning: AIReasoningEnvelope | null = null;
  let latestReasoningTokens: number | null = null;

  const timeoutMode: StreamReadTimeoutMode = options.timeoutMode === 'soft' ? 'soft' : 'hard';
  const readWithTimeout = createStreamReadWithTimeout({
    label: options.label,
    mode: timeoutMode,
    idleTimeoutMs: options.idleTimeoutMs ?? STREAM_READ_IDLE_TIMEOUT_MS,
    totalTimeoutMs: options.totalTimeoutMs ?? STREAM_READ_TOTAL_TIMEOUT_MS,
    onTimeout: () => {
      try {
        void reader.cancel('timeout').catch(() => {});
      } catch {
        // ignore
      }
    },
    onSoftTimeout: (event) => {
      options.onSoftTimeout?.(event);
    },
  });

  const emitReasoning = (reasoning: AIReasoningEnvelope | null) => {
    latestReasoning = reasoning;
    onReasoning?.(reasoning);
  };

  const handleSseEvent = (event: string, data: string) => {
    const parsed = tryParseJson(data);
    const payload = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    onEvent?.(event, payload ?? parsed ?? data);

    if (event === 'markdown') {
      const chunk =
        (payload && typeof payload.chunk === 'string' ? payload.chunk : '') ||
        (!payload ? data : '');
      if (!chunk) return;
      accumulatedText += chunk;
      textStreamOptions.onText?.(accumulatedText);
      return;
    }

    if (event === 'reasoning') {
      const chunk = payload && typeof payload.chunk === 'string' ? payload.chunk : '';
      const source = normalizeReasoningSource(payload?.source);
      const normalizedSource = source === 'unknown' ? 'sdk' : source;
      const nextReasoning = appendReasoningDelta(latestReasoning, chunk, {
        source: normalizedSource,
        reasoningTokens: latestReasoningTokens,
        status: 'thinking',
      });
      emitReasoning(nextReasoning);
      return;
    }

    if (event === 'reasoning_done') {
      const source = normalizeReasoningSource(payload?.source);
      const normalizedSource = source === 'unknown' ? (latestReasoning?.source ?? 'sdk') : source;
      const nextReasoning = updateReasoningStatus(latestReasoning, {
        status: normalizeReasoningDoneStatus(payload?.status),
        source: normalizedSource,
        reasoningTokens: latestReasoningTokens,
      });
      emitReasoning(nextReasoning);
      return;
    }

    if (event === 'telemetry') {
      latestTelemetry = payload ?? null;
      const reasoningTokens = extractReasoningTokensFromTelemetry(latestTelemetry);
      if (typeof reasoningTokens === 'number') {
        latestReasoningTokens = reasoningTokens;
        if (latestReasoning) {
          emitReasoning({
            ...latestReasoning,
            reasoningTokens,
          });
        }
      }
      if (latestTelemetry) {
        onTelemetry?.(latestTelemetry);
      }
      return;
    }

    if (event === 'meta' || event === 'meta_error') {
      latestMeta = payload ?? null;
      if (latestMeta) {
        onMeta?.(latestMeta);
      }
      return;
    }

    if (event === 'error') {
      const message = payload && typeof payload.error === 'string' ? payload.error : '上游流式生成失败';
      const nextReasoning = updateReasoningStatus(latestReasoning, {
        status: 'error',
        source: latestReasoning?.source ?? 'sdk',
        errorMessage: message,
      });
      emitReasoning(nextReasoning);
      throw new Error(message);
    }

    if (event === 'done') {
      sawDone = true;
    }
  };

  const consumeSseBuffer = (flushRemainder = false) => {
    let separatorIndex = sseBuffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawBlock = sseBuffer.slice(0, separatorIndex);
      sseBuffer = sseBuffer.slice(separatorIndex + 2);
      const parsedBlock = parseSseBlock(rawBlock);
      if (parsedBlock) {
        handleSseEvent(parsedBlock.event, parsedBlock.data);
      }
      if (sawDone) return;
      separatorIndex = sseBuffer.indexOf('\n\n');
    }

    if (flushRemainder && sseBuffer.trim()) {
      const parsedBlock = parseSseBlock(sseBuffer);
      sseBuffer = '';
      if (parsedBlock) {
        handleSseEvent(parsedBlock.event, parsedBlock.data);
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await readWithTimeout(reader);
      if (done) break;
      if (!value) continue;
      sseBuffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      consumeSseBuffer(false);
      if (!sawDone) continue;
      try {
        await reader.cancel('sse_done');
      } catch {
        // 明确 done 已经给出协议终态；底层 cancel 清理失败不覆盖成功结果。
      }
      break;
    }
  } catch (error) {
    try {
      await reader.cancel('sse_error');
    } catch {
      // 保留原始协议/transport 错误；generation client 会单独投影 ambiguous。
    }
    throw error;
  }

  const flushed = decoder.decode();
  if (flushed) {
    sseBuffer += flushed.replace(/\r\n/g, '\n');
  }
  consumeSseBuffer(true);
  if (!sawDone) {
    try {
      await reader.cancel('sse_eof_before_done');
    } catch {
      // EOF 已经是不完整终态，cancel 清理失败不覆盖该错误。
    }
    throw new Error('SSE 流在明确 done 终态前结束。');
  }

  const reasoningSnapshot = latestReasoning as AIReasoningEnvelope | null;

  if (reasoningSnapshot && reasoningSnapshot.status === 'thinking') {
    const hasText = typeof reasoningSnapshot.text === 'string' && reasoningSnapshot.text.trim().length > 0;
    const finalizedReasoning = updateReasoningStatus(reasoningSnapshot, {
      status: hasText ? 'done' : 'unavailable',
      source: reasoningSnapshot.source ?? 'sdk',
      reasoningTokens: latestReasoningTokens,
    });
    emitReasoning(finalizedReasoning);
  } else if (!reasoningSnapshot) {
    const heuristicReasoning = extractHeuristicReasoningFromMarkdown(accumulatedText);
    if (heuristicReasoning) {
      emitReasoning(heuristicReasoning);
    } else {
      emitReasoning(
        updateReasoningStatus(null, {
          status: 'unavailable',
          source: 'sdk',
          reasoningTokens: latestReasoningTokens,
        })
      );
    }
  }

  textStreamOptions.onText?.(accumulatedText);

  return {
    text: accumulatedText,
    reasoning: latestReasoning,
    telemetry: latestTelemetry,
    meta: latestMeta,
    isSse: true,
  };
}
