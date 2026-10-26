import { useEffect, useRef, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { registerBusyOperation } from './busy-operations';

const DEFAULT_BUSY_MESSAGE = '仍有操作在进行，请等待完成后再离开或关闭窗口。';

type NativeGuard = {
  isBusy: () => boolean;
  getConfirmLeave: () => (() => boolean) | undefined;
  blocked: () => void;
  ready: () => void;
  failed: () => void;
};
const nativeGuards = new Set<NativeGuard>();
type NativeListener = { disposed: boolean; status: 'pending' | 'ready' | 'failed'; release?: () => void };
let nativeListener: NativeListener | null = null;

// Tauri 的每个 close listener 都独立决定是否 destroy 窗口，必须统一协调全部守卫。
const registerNativeGuard = (guard: NativeGuard) => {
  nativeGuards.add(guard);
  if (nativeListener) {
    if (nativeListener.status === 'ready') guard.ready();
    else if (nativeListener.status === 'failed') guard.failed();
  } else {
    const listener: NativeListener = { disposed: false, status: 'pending' };
    nativeListener = listener;
    void (async () => {
      try {
        const release = await getCurrentWindow().onCloseRequested((event) => {
          // StrictMode 的旧异步注册可能晚到，不能自行放行关闭。
          if (listener.disposed) { event.preventDefault(); return; }
          const busy = [...nativeGuards].filter((entry) => entry.isBusy());
          // 有不可中断工作时先阻止关闭，不提前询问是否丢弃其他草稿。
          const blocking = busy.filter((entry) => !entry.getConfirmLeave());
          if (blocking.length > 0) {
            event.preventDefault();
            blocking.forEach((entry) => entry.blocked());
            return;
          }
          for (const entry of busy) {
            if (!entry.getConfirmLeave()?.()) {
              event.preventDefault();
              entry.blocked();
              return;
            }
          }
        });
        if (listener.disposed) release();
        else {
          listener.release = release;
          listener.status = 'ready';
          nativeGuards.forEach((entry) => entry.ready());
        }
      } catch {
        if (!listener.disposed) {
          listener.status = 'failed';
          nativeGuards.forEach((entry) => entry.failed());
        }
      }
    })();
  }
  return () => {
    nativeGuards.delete(guard);
    if (nativeGuards.size === 0 && nativeListener) {
      nativeListener.disposed = true;
      nativeListener.release?.();
      nativeListener = null;
    }
  };
};

/**
 * 在途操作离开守卫：`isBusy` 为真时阻止路由导航、页面刷新与原生窗口关闭。
 *
 * 调用方用 `isBusy` 声明"什么算在途"，可选 `confirmLeave` 提供"确认后放行"。
 * 没有可恢复后台 owner 的在途工作（如本地库维护）不提供 confirmLeave：
 * 强制离开会丢失 owner。
 */
export const useLeaveGuard = (
  isBusy: () => boolean,
  busyMessage = DEFAULT_BUSY_MESSAGE,
  initializationFailureMessage = '窗口关闭保护初始化失败，相关操作暂不可用。请重新打开页面后重试。',
  confirmLeave?: () => boolean,
) => {
  const confirmLeaveRef = useRef(confirmLeave);
  confirmLeaveRef.current = confirmLeave;
  const busyRef = useRef(isBusy);
  busyRef.current = isBusy;
  const messageRef = useRef(busyMessage);
  messageRef.current = busyMessage;
  const [ready, setReady] = useState(!isTauri());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => registerBusyOperation(() => busyRef.current()), []);

  useBlocker({
    shouldBlockFn: () => {
      if (!busyRef.current()) return false;
      if (confirmLeaveRef.current?.()) return false;
      setMessage(messageRef.current);
      return true;
    },
    // 卸载单独处理，避免在 busy 更新后重新安装 native listener。
    enableBeforeUnload: false,
  });

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!busyRef.current()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    return registerNativeGuard({
      isBusy: () => busyRef.current(),
      getConfirmLeave: () => confirmLeaveRef.current,
      blocked: () => setMessage(messageRef.current),
      ready: () => setReady(true),
      failed: () => { setReady(false); setMessage(initializationFailureMessage); },
    });
  }, [initializationFailureMessage]);

  return { ready, message: !isBusy() && ready ? null : message };
};
