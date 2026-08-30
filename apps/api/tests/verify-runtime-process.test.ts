import { EventEmitter } from 'node:events';

import { terminateChildProcess } from '../scripts/child-process-lifecycle.mjs';

describe('verify runtime child-process lifecycle', () => {
  test('子进程已提前退出时立即完成，不再挂新的 exit listener', async () => {
    const child = {
      exitCode: 1,
      signalCode: null,
      kill: vi.fn(),
      once: vi.fn(),
    };

    await expect(terminateChildProcess(child)).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.once).not.toHaveBeenCalled();
  });

  test('存活子进程先注册 exit listener，再发送 SIGTERM 并等待退出', async () => {
    const events = new EventEmitter();
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn((signal: NodeJS.Signals) => {
        child.signalCode = signal;
        queueMicrotask(() => events.emit('exit', null, signal));
        return true;
      }),
      once: events.once.bind(events),
    };

    await expect(terminateChildProcess(child)).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
