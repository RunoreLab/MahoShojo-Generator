/**
 * 流式 attempt 的一次性 outcome 记分器。
 *
 * 规格要求：在「上游 attempt 结束」时记分，而非 stream 创建/首包时。
 * 流式路径上 onError / onFinish / body close / cancel / catch 可能交错触发，
 * 因此同一 attempt 只允许 commit 一次，避免 success+failure 双计。
 */

import {
  classifyOutcome,
  classifySuccess,
  type OutcomeClassification,
} from './outcome-classification';
import type { RecordAiChannelOutcome } from './types';

export type AttemptChannelContext = {
  providerId: string;
  modelId: string;
};

export type AttemptOutcomeRecorder = {
  /** 是否已提交过 outcome */
  readonly settled: boolean;
  recordSuccess: () => void;
  /** 按 classifyOutcome 规则记 failure/excluded */
  recordFromError: (_error: unknown) => void;
  recordClassification: (_classification: OutcomeClassification) => void;
  /**
   * 流被 cancel 时调用。
   * - timeout / 读超时 → failure
   * - 其余（客户端断开等）→ excluded/user_cancel
   */
  recordFromCancel: (_reason?: unknown) => void;
};

const cancelReasonToMessage = (reason: unknown): string => {
  if (reason instanceof Error) return reason.message || reason.name || '';
  if (typeof reason === 'string') return reason;
  if (reason == null) return '';
  try {
    return String(reason);
  } catch {
    return '';
  }
};

/**
 * 创建单次 attempt 的 outcome 记分器。无 channelContext 时全部 no-op。
 */
export function createAttemptOutcomeRecorder(
  channelContext?: AttemptChannelContext | null,
  recordAiChannelOutcome: RecordAiChannelOutcome = () => undefined,
): AttemptOutcomeRecorder {
  let settled = false;
  const isSystemChannel = channelContext?.providerId === 'system';

  const commit = (classification: OutcomeClassification): void => {
    if (!channelContext || settled) return;
    settled = true;
    void recordAiChannelOutcome({
      providerId: channelContext.providerId,
      modelId: channelContext.modelId,
      ...classification,
    });
  };

  return {
    get settled() {
      return settled;
    },
    recordSuccess() {
      commit(classifySuccess());
    },
    recordFromError(error: unknown) {
      commit(classifyOutcome(Boolean(isSystemChannel), error));
    },
    recordClassification(classification: OutcomeClassification) {
      commit(classification);
    },
    recordFromCancel(reason?: unknown) {
      const message = cancelReasonToMessage(reason);
      const lower = message.toLowerCase();

      if (
        lower.includes('timeout') ||
        lower === 'timeout' ||
        message.includes('超时')
      ) {
        commit({ outcome: 'failure', errorClass: 'timeout' });
        return;
      }

      // 预检空输出 cancel 后通常会 throw；此处兜底记 failure
      if (lower.includes('empty-output') || lower.includes('empty_output')) {
        commit({ outcome: 'failure', errorClass: 'empty_output' });
        return;
      }

      commit({ outcome: 'excluded', errorClass: 'user_cancel' });
    },
  };
}

export type PipeStreamOutcomeOptions = {
  /**
   * 流正常 close 时是否记 success。
   * - raw text 流：true（默认），以消费完成为 attempt 成功
   * - streamObject：false，成功/本地校验交给 onFinish，避免 schema 失败被误记 success
   */
  recordSuccessOnClose?: boolean;
};

/**
 * 包装 ReadableStream：异常时 failure，cancel 时按 reason 分类；
 * 可选在正常结束时 success。与 AI SDK 回调共用同一 recorder 时只记一次。
 */
export function pipeStreamWithAttemptOutcome<T>(
  source: ReadableStream<T>,
  recorder: AttemptOutcomeRecorder,
  options?: PipeStreamOutcomeOptions,
): ReadableStream<T> {
  const recordSuccessOnClose = options?.recordSuccessOnClose !== false;
  const reader = source.getReader();

  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (recordSuccessOnClose) {
            recorder.recordSuccess();
          }
          controller.close();
          return;
        }
        controller.enqueue(value as T);
      } catch (error) {
        recorder.recordFromError(error);
        try {
          controller.error(error);
        } catch {
          // controller 可能已关闭
        }
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // ignore
      }
      recorder.recordFromCancel(reason);
    },
  });
}

/**
 * 包装 Response.body。
 * @param options.recordSuccessOnClose 默认 true；streamObject 应传 false，由 onFinish 定 success/excluded
 */
export function wrapResponseWithAttemptOutcome(
  response: Response,
  recorder: AttemptOutcomeRecorder,
  options?: PipeStreamOutcomeOptions,
): Response {
  const recordSuccessOnClose = options?.recordSuccessOnClose !== false;

  if (!response.body) {
    if (recordSuccessOnClose) {
      recorder.recordSuccess();
    }
    return response;
  }

  const wrappedBody = pipeStreamWithAttemptOutcome(response.body, recorder, options);
  return new Response(wrappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
