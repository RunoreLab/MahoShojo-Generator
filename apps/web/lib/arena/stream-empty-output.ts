export const AI_EMPTY_OUTPUT_ERROR_MESSAGE =
  'AI 返回空对象/空内容（{} / [] / 空白），未收到有效正文，请重试或切换模型。';

export const AI_REASONING_ONLY_WITHOUT_MARKDOWN_ERROR_MESSAGE =
  'AI 只返回了思考过程，但未返回可展示的战报正文。通常是模型把输出预算耗在 reasoning，或上游未发送 text-delta；请减少超长思考要求、重试或切换模型。';

type EmptyStreamOutputDebugInput = {
  outputBytes: number;
  outputChars: number;
  markdownCharsSent: number;
  hasMeaningfulMarkdown: boolean;
  metaHasImpacts: boolean;
  inMeta: boolean;
  pendingMarkdownTailLength: number;
  metaBufferLength: number;
  metaFallbackTailLength: number;
  reasoningCharsSent: number;
  hasReasoningStarted: boolean;
  hasReasoningDelta: boolean;
  reasoningCompleted: boolean;
  finishReason?: string | null;
  rawPreview: string | null;
};

export type EmptyStreamOutputErrorCode = 'ai_empty_output' | 'ai_reasoning_only_without_markdown';

export type EmptyStreamOutputErrorPayload = {
  ok: false;
  error: string;
  errorCode: EmptyStreamOutputErrorCode;
  source: 'sdk';
  debug: (EmptyStreamOutputDebugInput & { reasoningOnly: boolean }) | null;
};

type BuildEmptyStreamOutputErrorPayloadInput = EmptyStreamOutputDebugInput & {
  debug: boolean;
};

export function buildEmptyStreamOutputErrorPayload(
  input: BuildEmptyStreamOutputErrorPayloadInput
): EmptyStreamOutputErrorPayload {
  const reasoningOnly = input.hasReasoningDelta || input.reasoningCharsSent > 0;
  const errorCode: EmptyStreamOutputErrorCode = reasoningOnly
    ? 'ai_reasoning_only_without_markdown'
    : 'ai_empty_output';

  return {
    ok: false,
    error: reasoningOnly ? AI_REASONING_ONLY_WITHOUT_MARKDOWN_ERROR_MESSAGE : AI_EMPTY_OUTPUT_ERROR_MESSAGE,
    errorCode,
    source: 'sdk',
    debug: input.debug
      ? {
          outputBytes: input.outputBytes,
          outputChars: input.outputChars,
          markdownCharsSent: input.markdownCharsSent,
          hasMeaningfulMarkdown: input.hasMeaningfulMarkdown,
          metaHasImpacts: input.metaHasImpacts,
          inMeta: input.inMeta,
          pendingMarkdownTailLength: input.pendingMarkdownTailLength,
          metaBufferLength: input.metaBufferLength,
          metaFallbackTailLength: input.metaFallbackTailLength,
          reasoningCharsSent: input.reasoningCharsSent,
          hasReasoningStarted: input.hasReasoningStarted,
          hasReasoningDelta: input.hasReasoningDelta,
          reasoningCompleted: input.reasoningCompleted,
          finishReason: input.finishReason ?? null,
          rawPreview: input.rawPreview,
          reasoningOnly,
        }
      : null,
  };
}
