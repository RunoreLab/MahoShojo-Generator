// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDesktopConfigText, type DesktopZoomPercent } from '@mahoshojo/contracts/desktop-config';
import { DesktopConfigStore } from '../src/features/config/desktop-config-store';
import { DesktopZoomController, installDesktopZoomGestures } from '../src/features/zoom/desktop-zoom-controller';
import { setMainWindowZoom } from '../src/platform/zoom-bridge';

const REV = `sha256:${'a'.repeat(64)}`;
const readResult = (zoomPercent: number) => ({
  path: 'C:\\test\\config.json', directory: 'C:\\test', backupPresent: false, invalidPresent: false,
  file: { status: 'ok', revision: REV, content: JSON.stringify({ version: 1, desktop: { zoomPercent } }) },
});
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fixture = (initial = 100) => {
  const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>): Promise<unknown> => {
    if (command === 'desktop_config_read') return readResult(initial);
    if (command === 'desktop_config_write') return { revision: REV };
    throw new Error(`unexpected command ${command}`);
  });
  const config = new DesktopConfigStore({ invoke });
  const apply = vi.fn(async (percent: DesktopZoomPercent) => percent);
  const controller = new DesktopZoomController(config, apply);
  return { config, apply, controller, invoke };
};

afterEach(() => { vi.useRealTimers(); });

describe('主窗口缩放 owner', () => {
  it('首次原生确认前不假定100%已经生效，首次失败保持未确认', async () => {
    const { controller, apply } = fixture();
    expect(controller.getSnapshot().actualPercent).toBeNull();
    apply.mockRejectedValueOnce(new Error('confirmation timed out'));
    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: null, applyError: 'confirmation timed out' });
    // 恢复100%的明确操作也能重试同一配置倍率，不能被“值没变”吞掉。
    controller.reset(); await settle();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 100, applyError: null });
  });
  it('恢复同一配置来源，不在首读时写回；外部重载也应用到主窗', async () => {
    const { controller, config, invoke, apply } = fixture(150);
    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 150, configuredPercent: 150, requestedPercent: 150 });
    expect(apply.mock.calls).toEqual([[150]]);
    expect(invoke.mock.calls.filter(([command]) => command === 'desktop_config_write')).toHaveLength(0);
    invoke.mockImplementation(async (command) => command === 'desktop_config_read' ? readResult(125) : { revision: REV });
    await config.reload(); await settle();
    expect(controller.getSnapshot().actualPercent).toBe(125);
  });

  it('连续输入基于最后意图推进，首笔写入在途也保留最终倍率', async () => {
    const { controller, config, invoke } = fixture();
    await controller.start();
    const firstWrite = deferred<unknown>();
    let writes = 0;
    invoke.mockImplementation(async (command) => {
      if (command === 'desktop_config_read') return readResult(100);
      writes++;
      return writes === 1 ? firstWrite.promise : { revision: REV };
    });
    controller.step(1); await settle(); // 110 的写确认尚未回来。
    controller.step(1); controller.step(1);
    expect(controller.getSnapshot().requestedPercent).toBe(150);
    firstWrite.resolve({ revision: REV }); await settle();
    expect(config.getSnapshot().values.zoomPercent).toBe(150);
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 150, requestedPercent: 150, saving: false });
    const lastWrite = invoke.mock.calls.filter(([command]) => command === 'desktop_config_write').at(-1)!;
    const request = lastWrite[1]!.request as { content: string };
    expect(parseDesktopConfigText(request.content).values.zoomPercent).toBe(150);
  });

  it('写失败保持已确认倍率，Native 失败保留实际倍率并允许独立重试', async () => {
    const { controller, invoke, apply } = fixture();
    await controller.start();
    invoke.mockImplementation(async () => { throw new Error('disk full'); });
    controller.setPercent(150); await settle();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 100, configuredPercent: 100, saveError: 'disk full' });
    expect(apply.mock.calls).toEqual([[100]]);
    invoke.mockImplementation(async () => ({ revision: REV }));
    apply.mockRejectedValueOnce(new Error('native unavailable'));
    controller.setPercent(150); await settle();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 100, configuredPercent: 150, applyError: 'native unavailable' });
    const calls = invoke.mock.calls.length;
    controller.retry(); await settle();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 150, applyError: null });
    expect(invoke.mock.calls).toHaveLength(calls);
  });

  it('Native 调用串行且最终收敛，迟到响应不会使旧倍率成为最终状态', async () => {
    const { controller, apply } = fixture();
    await controller.start();
    const inFlight = deferred<DesktopZoomPercent>();
    apply.mockImplementationOnce(() => inFlight.promise);
    controller.setPercent(110); await settle();
    controller.setPercent(150); await settle();
    expect(apply.mock.calls).toEqual([[100], [110]]);
    inFlight.resolve(110); await settle();
    expect(apply.mock.calls).toEqual([[100], [110], [150]]);
    expect(controller.getSnapshot().actualPercent).toBe(150);
  });

  it('真实配置冲突回到磁盘倍率且保留试图值，显式重新应用才写入', async () => {
    const { controller, config, invoke } = fixture();
    await controller.start();
    let conflict = true;
    invoke.mockImplementation(async (command) => {
      if (command === 'desktop_config_read') return readResult(150);
      if (conflict) throw { code: 'config-conflict', message: 'changed externally' };
      return { revision: REV };
    });
    controller.setPercent(125); await settle();
    expect(config.getSnapshot().conflictedFields).toContain('zoomPercent');
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 150, configuredPercent: 150, requestedPercent: 150 });
    expect(controller.getSnapshot().saveError).toContain('修改未写入');
    conflict = false;
    config.reapplyConflictedDraft(); await settle();
    expect(config.getSnapshot().conflictedFields).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 125, configuredPercent: 125, saveError: null });
  });

  it('读取未完成或失败时可临时调节，迟到读取不覆盖且保存需明确操作', async () => {
    const { controller, config, invoke } = fixture();
    const read = deferred<unknown>();
    invoke.mockImplementation(async () => read.promise);
    const start = controller.start();
    controller.setPercent(175); await settle();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 175, temporary: true });
    read.resolve(readResult(125)); await start; await settle();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 175, requestedPercent: 175, configuredPercent: 125, temporary: true });
    expect(invoke.mock.calls).toHaveLength(1);
    invoke.mockImplementation(async () => ({ revision: REV }));
    controller.setPercent(175); await settle();
    expect(config.getSnapshot().values.zoomPercent).toBe(175);
    expect(controller.getSnapshot().temporary).toBe(false);
    controller.stop();
  });

  it('读取失败时启动保持可用，临时恢复100%不重写坏配置', async () => {
    const { controller, invoke } = fixture();
    invoke.mockRejectedValue(new Error('read failed'));
    await controller.start();
    controller.setPercent(150); await settle();
    controller.reset(); await settle();
    expect(controller.getSnapshot()).toMatchObject({ actualPercent: 100, temporary: true, configuredPercent: 100 });
    expect(invoke.mock.calls).toHaveLength(1);
  });
});

describe('缩放手势与窄桥', () => {
  it('键盘、小键盘、恢复和边界共用同一意图；组合输入及已消费事件让位', async () => {
    const { controller } = fixture(); await controller.start();
    const release = installDesktopZoomGestures(window, controller);
    const key = (init: KeyboardEventInit) => { const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); window.dispatchEvent(event); return event; };
    expect(key({ key: '=', ctrlKey: true }).defaultPrevented).toBe(true);
    key({ key: '+', code: 'NumpadAdd', ctrlKey: true });
    expect(controller.getSnapshot().requestedPercent).toBe(125);
    key({ key: '-', code: 'NumpadSubtract', ctrlKey: true });
    expect(controller.getSnapshot().requestedPercent).toBe(110);
    key({ key: '0', ctrlKey: true });
    expect(controller.getSnapshot().requestedPercent).toBe(100);
    expect(key({ key: '+', ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
    const consumed = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true }); consumed.preventDefault(); window.dispatchEvent(consumed);
    expect(controller.getSnapshot().requestedPercent).toBe(100);
    window.dispatchEvent(new CompositionEvent('compositionstart'));
    expect(key({ key: '+', ctrlKey: true }).defaultPrevented).toBe(false);
    window.dispatchEvent(new CompositionEvent('compositionend'));
    controller.setPercent(200); key({ key: '+', ctrlKey: true });
    expect(controller.getSnapshot().requestedPercent).toBe(200);
    release(); await settle();
    key({ key: '-', ctrlKey: true });
    expect(controller.getSnapshot().requestedPercent).toBe(200);
  });

  it('Ctrl滚轮保留尾部意图，小增量及各deltaMode可用，普通滚动不被拦截', async () => {
    vi.useFakeTimers();
    const { controller } = fixture(); await controller.start();
    const release = installDesktopZoomGestures(window, controller);
    const wheel = (deltaY: number, ctrlKey = true, deltaMode = 0) => {
      const event = new WheelEvent('wheel', { deltaY, ctrlKey, deltaMode, cancelable: true }); window.dispatchEvent(event); return event;
    };
    expect(wheel(-100, false).defaultPrevented).toBe(false);
    expect(wheel(-20).defaultPrevented).toBe(true);
    expect(controller.getSnapshot().requestedPercent).toBe(100);
    wheel(-20); expect(controller.getSnapshot().requestedPercent).toBe(110);
    wheel(-100); wheel(-100);
    expect(controller.getSnapshot().requestedPercent).toBe(110);
    await vi.advanceTimersByTimeAsync(120);
    expect(controller.getSnapshot().requestedPercent).toBe(125);
    wheel(3, true, 1); await vi.advanceTimersByTimeAsync(120);
    expect(controller.getSnapshot().requestedPercent).toBe(110);
    wheel(-1, true, 2); await vi.advanceTimersByTimeAsync(120);
    expect(controller.getSnapshot().requestedPercent).toBe(125);
    release();
  });

  it('桥拒绝错误目标形状、非法倍率和不一致回执', async () => {
    const invoke = vi.fn(async () => ({ zoomPercent: 125 }));
    await expect(setMainWindowZoom(invoke, 125)).resolves.toBe(125);
    expect(invoke).toHaveBeenCalledWith('set_main_window_zoom', { zoomPercent: 125 });
    invoke.mockResolvedValue({ zoomPercent: 150 });
    await expect(setMainWindowZoom(invoke, 125)).rejects.toThrow('不同');
    await expect(setMainWindowZoom(invoke, 500 as DesktopZoomPercent)).rejects.toThrow();
  });

  it('方向反转不足阈值时清掉尾部累计，不借下一手势触发额外缩放', async () => {
    vi.useFakeTimers();
    const { controller } = fixture(); await controller.start();
    const release = installDesktopZoomGestures(window, controller);
    const wheel = (deltaY: number) => window.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, cancelable: true }));
    wheel(-40); expect(controller.getSnapshot().requestedPercent).toBe(110);
    await vi.advanceTimersByTimeAsync(10); wheel(100);
    await vi.advanceTimersByTimeAsync(10); wheel(-10);
    await vi.advanceTimersByTimeAsync(110);
    expect(controller.getSnapshot().requestedPercent).toBe(110);
    await vi.advanceTimersByTimeAsync(70); wheel(10);
    expect(controller.getSnapshot().requestedPercent).toBe(110);
    // 一段不足阈值的小手势也会过期，与下一次独立小手势隔开。
    await vi.advanceTimersByTimeAsync(161); wheel(30);
    expect(controller.getSnapshot().requestedPercent).toBe(110);
    release();
  });
});
