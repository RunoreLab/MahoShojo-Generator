import {
  readTextAndReasoningStreamFromResponse,
  type ReadTextAndReasoningStreamOptions,
  type ReadTextAndReasoningStreamResult,
} from '@/lib/stream/read-text-and-reasoning-stream';
import { isAbortErrorLike, STREAM_ABORT_REASON_OUTPUT_SAFETY } from '@/lib/stream/abort';
import { createStreamOutputSafetyController } from '@/lib/stream/output-safety';

type ReadSafeTextAndReasoningStreamOptions = Omit<ReadTextAndReasoningStreamOptions, 'onText'> & {
  abortController: AbortController;
  onText?: (text: string) => void;
  safetyReason?: string;
  onSafetyBlocked?: (safeText: string, truncatedAt: number | null) => void;
};

export type ReadSafeTextAndReasoningStreamResult = ReadTextAndReasoningStreamResult & {
  outputSafetyStatus: 'blocked' | 'done';
  wasAborted: boolean;
  abortReason: unknown;
};

export async function readSafeTextAndReasoningStreamFromResponse(
  response: Response,
  options: ReadSafeTextAndReasoningStreamOptions,
): Promise<ReadSafeTextAndReasoningStreamResult> {
  const {
    abortController,
    onText,
    onReasoning,
    onTelemetry,
    onMeta,
    onEvent,
    safetyReason,
    onSafetyBlocked,
    ...rest
  } = options;

  let latestReasoning: ReadTextAndReasoningStreamResult['reasoning'] = null;
  let latestTelemetry: ReadTextAndReasoningStreamResult['telemetry'] = null;
  let latestMeta: ReadTextAndReasoningStreamResult['meta'] = null;

  const outputSafety = createStreamOutputSafetyController({
    reason: safetyReason,
    onBlocked: (safeText, truncatedAt) => {
      onText?.(safeText);
      onSafetyBlocked?.(safeText, truncatedAt);
      if (!abortController.signal.aborted) {
        abortController.abort(STREAM_ABORT_REASON_OUTPUT_SAFETY);
      }
    },
  });

  try {
    const result = await readTextAndReasoningStreamFromResponse(response, {
      ...rest,
      onText: (text) => {
        outputSafety.ingest(text);
        onText?.(text);
      },
      onReasoning: (reasoning) => {
        latestReasoning = reasoning;
        onReasoning?.(reasoning);
      },
      onTelemetry: (payload) => {
        latestTelemetry = payload;
        onTelemetry?.(payload);
      },
      onMeta: (payload) => {
        latestMeta = payload;
        onMeta?.(payload);
      },
      onEvent,
    });

    const finalized = await outputSafety.finalize(result.text);
    if (finalized.safeText !== result.text) {
      onText?.(finalized.safeText);
    }

    return {
      ...result,
      text: finalized.safeText,
      outputSafetyStatus: finalized.status,
      wasAborted: false,
      abortReason: null,
    };
  } catch (error) {
    if (!abortController.signal.aborted && !isAbortErrorLike(error)) {
      throw error;
    }

    const finalized = await outputSafety.finalizeAfterAbort(abortController.signal.reason);
    onText?.(finalized.safeText);

    return {
      text: finalized.safeText,
      reasoning: latestReasoning,
      telemetry: latestTelemetry,
      meta: latestMeta,
      isSse: (response.headers.get('content-type') || '').toLowerCase().includes('text/event-stream'),
      outputSafetyStatus: finalized.status,
      wasAborted: true,
      abortReason: abortController.signal.reason,
    };
  } finally {
    outputSafety.clearTimer();
  }
}
