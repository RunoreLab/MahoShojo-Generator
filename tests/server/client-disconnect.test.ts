import { describe, expect, it, vi } from 'vitest';
import {
  handleUnhandledRejection,
  isExpectedClientDisconnect,
} from '@/server/client-disconnect';

describe('Hono client disconnect guard', () => {
  it('识别 @hono/node-server 的客户端断连异常', () => {
    expect(isExpectedClientDisconnect(new Error('Client connection prematurely closed.'))).toBe(true);
    expect(isExpectedClientDisconnect('Client connection prematurely closed.')).toBe(true);
    expect(isExpectedClientDisconnect(new Error('database unavailable'))).toBe(false);
  });

  it('忽略预期断连但不终止进程', () => {
    const logExpected = vi.fn();
    const logFatal = vi.fn();
    const terminate = vi.fn();

    const result = handleUnhandledRejection(
      new Error('Client connection prematurely closed.'),
      { logExpected, logFatal, terminate },
    );

    expect(result).toBe('ignored-client-disconnect');
    expect(logExpected).toHaveBeenCalledOnce();
    expect(logFatal).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
  });

  it('未知的未处理 rejection 仍保持失败退出', () => {
    const logExpected = vi.fn();
    const logFatal = vi.fn();
    const terminate = vi.fn();
    const reason = new Error('unexpected failure');

    const result = handleUnhandledRejection(reason, { logExpected, logFatal, terminate });

    expect(result).toBe('fatal');
    expect(logExpected).not.toHaveBeenCalled();
    expect(logFatal).toHaveBeenCalledWith(reason);
    expect(terminate).toHaveBeenCalledWith(1);
  });
});
