import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import { collectAiStreamResult, type AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { AiExecutionPort } from '@mahoshojo/ai-direct';

import {
  CANCEL_DIRECT_AI_COMMAND,
  openDirectAiStream,
  type DesktopAiExecutionOptions,
} from './direct-ai-bridge';

/**
 * `AiExecutionPort` 的桌面实现。
 *
 * native 侧只实现**流式**通路；`execute()` 通过收集流得到结果。这样"只有一条执行通路"
 * 成立——取消、超时、限流、协议校验只需要在一处正确实现，而 `collectAiStreamResult`
 * 已经把这些不变式编码好了。
 *
 * 取消采用双路径：先 abort 本地 AbortSignal 立即停止消费，再向 native 发取消请求让上游
 * 真正断流。顺序不能反——只发 IPC 会让本地迭代器继续挂着；只 abort 会让上游继续烧 token。
 */

export type { DesktopAiExecutionOptions } from './direct-ai-bridge';

const createNativeCancellation = (
  options: DesktopAiExecutionOptions,
  requestId: string,
  signal: AbortSignal,
) => {
  let started = false;
  let requested = false;
  let sent = false;
  const cancel = () => {
    requested = true;
    // started 在 native 注册取消句柄之后发出。提前 cancel 会因尚未注册而丢失。
    if (!started || sent) return;
    sent = true;
    void options.invoke(CANCEL_DIRECT_AI_COMMAND, { requestId }).catch(() => undefined);
  };
  return {
    cancel,
    observe: (event: AiStreamEvent) => {
      if (event.type === 'started' && event.requestId === requestId) {
        started = true;
        if (requested || signal.aborted) cancel();
      }
    },
  };
};

export const createDesktopAiExecutionPort = (
  options: DesktopAiExecutionOptions,
): AiExecutionPort => {
  const collect = async (
    request: AiExecutionRequest,
    signal: AbortSignal,
  ): Promise<AiExecutionResult> => {
    const queued: AiStreamEvent[] = [];
    let failure: unknown;
    const cancellation = createNativeCancellation(options, request.requestId, signal);

    const pump = openDirectAiStream(
      options,
      request,
      (event) => {
        cancellation.observe(event);
        queued.push(event);
      },
    ).catch((cause: unknown) => {
      failure = cause;
    });

    const onAbort = () => {
      cancellation.cancel();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await pump;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    if (signal.aborted) {
      return {
        status: 'cancelled',
        requestId: request.requestId,
        contractVersion: request.contractVersion,
        mode: request.mode,
        reason: 'aborted',
      };
    }

    if (failure !== undefined) {
      throw failure;
    }

    // 协议归约交给 ai-core：序列连续性、单一终态、delta 上限都在那里统一实现，
    // Desktop 不再维护第二套。
    return collectAiStreamResult(request, queued);
  };

  return {
    execute: async (request, signal) => {
      if (signal.aborted) {
        return {
          status: 'cancelled',
          requestId: request.requestId,
          contractVersion: request.contractVersion,
          mode: request.mode,
          reason: 'aborted',
        };
      }
      return collect(request, signal);
    },
    stream: async function* stream(request, signal) {
      if (signal.aborted) return;
      const queue: AiStreamEvent[] = [];
      let failure: unknown;
      let done = false;
      let waiter: (() => void) | undefined;
      const cancellation = createNativeCancellation(options, request.requestId, signal);

      const wake = () => {
        waiter?.();
        waiter = undefined;
      };

      const pump = openDirectAiStream(
        options,
        request,
        (event) => {
          cancellation.observe(event);
          queue.push(event);
          wake();
        },
      )
        .catch((cause: unknown) => {
          failure = cause;
        })
        .finally(() => {
          done = true;
          wake();
        });

      const onAbort = () => {
        cancellation.cancel();
        wake();
      };
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        for (;;) {
          // abort 检查必须在排空队列**之前**：否则取消之后仍会把已到达的事件吐给调用方。
          if (signal.aborted) return;
          while (queue.length > 0) {
            if (signal.aborted) return;
            yield queue.shift() as AiStreamEvent;
          }
          if (done) break;
          if (failure !== undefined) throw failure;
          await new Promise<void>((resolve) => {
            waiter = resolve;
          });
        }
        while (queue.length > 0) {
          if (signal.aborted) return;
          yield queue.shift() as AiStreamEvent;
        }
        if (failure !== undefined) throw failure;
      } finally {
        signal.removeEventListener('abort', onAbort);
        // 消费者提前退出也须终止上游，不能让付费生成在无人消费时继续运行。
        if (!done && !signal.aborted) onAbort();
        await pump;
      }
    },
  };
};
