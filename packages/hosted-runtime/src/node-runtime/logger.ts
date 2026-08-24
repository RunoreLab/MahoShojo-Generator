export type NodeAiLogger = {
  debug(_message: string, _context?: unknown): void;
  info(_message: string, _context?: unknown): void;
  warn(_message: string, _context?: unknown): void;
  error(_message: string, _context?: unknown): void;
};

export const silentLogger: NodeAiLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * AI runtime 的调用参数、Provider 与上游 Error 均可能含 secret/正文/URL。
 * 该投影只保留固定低基数事件，不把动态 message/context 交给实际 sink。
 */
export const createSafeAiRuntimeLogger = (sink: NodeAiLogger): NodeAiLogger => ({
  debug: () => sink.debug('[ai-runtime] debug'),
  info: () => sink.info('[ai-runtime] info'),
  warn: () => sink.warn('[ai-runtime] warning'),
  error: () => sink.error('[ai-runtime] error'),
});
