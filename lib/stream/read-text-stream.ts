import { createStreamReadWithTimeout, STREAM_READ_IDLE_TIMEOUT_MS, STREAM_READ_TOTAL_TIMEOUT_MS } from '@/lib/stream/timeout';

export type ReadTextStreamFromResponseOptions = {
  label?: string;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  onText?: (text: string) => void;
};

export async function readTextStreamFromResponse(
  response: Response,
  options: ReadTextStreamFromResponseOptions = {}
): Promise<string> {
  const reader = response.body?.getReader() ?? null;
  if (!reader) {
    throw new Error('无法读取响应流，请使用最新版本的浏览器。');
  }

  const decoder = new TextDecoder();
  let accumulatedText = '';

    const readWithTimeout = createStreamReadWithTimeout({
      label: options.label,
      idleTimeoutMs: options.idleTimeoutMs ?? STREAM_READ_IDLE_TIMEOUT_MS,
      totalTimeoutMs: options.totalTimeoutMs ?? STREAM_READ_TOTAL_TIMEOUT_MS,
      onTimeout: () => {
        try {
          void reader.cancel('timeout').catch(() => {});
        } catch {
          // ignore
        }
      },
    });

  while (true) {
    const { value, done } = await readWithTimeout(reader);
    if (done) break;
    if (!value) continue;
    accumulatedText += decoder.decode(value, { stream: true });
    options.onText?.(accumulatedText);
  }

  accumulatedText += decoder.decode();
  options.onText?.(accumulatedText);
  return accumulatedText;
}
