export type PvpGenerationSseSnapshot = Readonly<{
  markdown: string;
  reasoning: string;
  status: string | null;
}>;

export const readPvpGenerationSseSnapshot = (payload: unknown): PvpGenerationSseSnapshot => {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as { markdown?: unknown; reasoning?: unknown; status?: unknown }
    : null;
  if (typeof value?.markdown !== 'string' || typeof value.reasoning !== 'string') {
    throw new Error('上游流式生成返回了无效快照');
  }
  return {
    markdown: value.markdown,
    reasoning: value.reasoning,
    status: typeof value.status === 'string' ? value.status : null,
  };
};

export const assertCompletedPvpGenerationSseDone = (payload: unknown): void => {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as { ok?: unknown; status?: unknown; error?: unknown }
    : null;
  if (value?.ok === true && value.status === 'completed') return;
  const message = typeof value?.error === 'string' && value.error.trim()
    ? value.error.trim()
    : typeof value?.status === 'string' && value.status.trim()
      ? `上游流式生成未成功完成：${value.status.trim()}`
      : '上游流式生成未返回成功终态';
  throw new Error(message);
};

export const assertPvpGenerationSseCompletedBeforeEof = (
  isSseUpstream: boolean,
  sawCompletedDone: boolean,
): void => {
  if (isSseUpstream && !sawCompletedDone) {
    throw new Error('上游流式生成在成功终态前结束');
  }
};
