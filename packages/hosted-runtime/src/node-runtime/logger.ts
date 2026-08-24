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
