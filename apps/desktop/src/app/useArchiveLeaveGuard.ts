import { useEffect, useRef, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const DEFAULT_BUSY_MESSAGE = '归档操作仍在进行，请等待完成后再离开或关闭窗口。';

/** 本地库维护尚无可恢复的后台 owner：在途只能留在当前页面，不提供会丢失 owner 的强制继续。 */
export const useArchiveLeaveGuard = (
  isBusy: () => boolean,
  busyMessage = DEFAULT_BUSY_MESSAGE,
  initializationFailureMessage = '窗口关闭保护初始化失败，本地库维护操作暂不可用。请重新打开页面后重试。',
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
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested((event) => {
      // Tauri 会在每个未 preventDefault 的回调后自行 destroy；晚到的旧 listener
      // 不得绕过 StrictMode 重挂后新 listener 的在途保护。
      if (disposed) {
        event.preventDefault();
        return;
      }
      if (!busyRef.current()) return;
      if (confirmLeaveRef.current?.()) return;
      event.preventDefault();
      setMessage(messageRef.current);
    }).then((release) => {
      // StrictMode 或导航可能早于异步注册返回；晚到的 handle 也必须释放。
      if (disposed) release();
      else {
        unlisten = release;
        setReady(true);
      }
    }).catch(() => {
      if (!disposed) setMessage(initializationFailureMessage);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [initializationFailureMessage]);

  return { ready, message: !isBusy() && ready ? null : message };
};
