// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLeaveGuard } from '../src/app/useLeaveGuard';

const native = vi.hoisted(() => ({ listen: vi.fn(), destroy: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: native.listen }) }));

let root: Root;
let container: HTMLDivElement;
const listeners = new Set<() => void>();
function Guard({ name, busy, confirm }: { name: string; busy: () => boolean; confirm?: () => boolean }) {
  const guard = useLeaveGuard(busy, `${name}仍在进行`, undefined, confirm);
  return <p>{name}:{guard.ready ? 'ready' : 'pending'} {guard.message}</p>;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  listeners.clear();
  // 忠实模拟 Tauri：每个 listener 都创建独立 event，并独立执行默认 destroy。
  native.listen.mockImplementation(async (callback: (event: { preventDefault: () => void }) => void) => {
    const dispatch = () => {
      let prevented = false;
      callback({ preventDefault: () => { prevented = true; } });
      if (!prevented) native.destroy();
    };
    listeners.add(dispatch);
    return () => { listeners.delete(dispatch); };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  expect(listeners.size).toBe(0);
});
const requestClose = async () => { await act(async () => { [...listeners].forEach((dispatch) => dispatch()); }); };

it('shares one native listener so an idle settings guard cannot destroy a busy updater window', async () => {
  let updating = true;
  await act(async () => {
    root.render(<><Guard name="更新" busy={() => updating} /><Guard name="签名" busy={() => false} /></>);
  });
  expect(native.listen).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('更新:ready');
  expect(container.textContent).toContain('签名:ready');
  await requestClose();
  expect(native.destroy).not.toHaveBeenCalled();
  expect(container.textContent).toContain('更新仍在进行');
  updating = false;
  await requestClose();
  expect(native.destroy).toHaveBeenCalledOnce();
});

it('does not prompt to discard a draft while an uninterruptible update blocks closing', async () => {
  let updating = true;
  const confirm = vi.fn(() => false);
  await act(async () => {
    root.render(<><Guard name="签名" busy={() => true} confirm={confirm} /><Guard name="更新" busy={() => updating} /></>);
  });
  await requestClose();
  expect(confirm).not.toHaveBeenCalled();
  expect(native.destroy).not.toHaveBeenCalled();
  updating = false;
  await requestClose();
  expect(confirm).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  expect(container.textContent).toContain('签名仍在进行');
  confirm.mockReturnValue(true);
  await requestClose();
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(native.destroy).toHaveBeenCalledOnce();
});

it('requires every dirty guard to agree and keeps the listener until the final guard unmounts', async () => {
  const first = vi.fn(() => true);
  const second = vi.fn(() => false);
  await act(async () => {
    root.render(<><Guard key="a" name="甲" busy={() => true} confirm={first} /><Guard key="b" name="乙" busy={() => true} confirm={second} /></>);
  });
  await requestClose();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  await act(async () => {
    root.render(<Guard key="b" name="乙" busy={() => true} confirm={second} />);
  });
  expect(native.listen).toHaveBeenCalledOnce();
  expect(listeners.size).toBe(1);
  second.mockReturnValue(true);
  await requestClose();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledTimes(2);
  expect(native.destroy).toHaveBeenCalledOnce();
});
