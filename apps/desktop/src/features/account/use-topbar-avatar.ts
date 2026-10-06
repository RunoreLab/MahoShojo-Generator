// 顶栏头像：userId → `avatarDataUrl` 的进程级缓存（D5.2 / DESK-ONLINE-008 r2）。
//
// - 头像属于「有身份后的后台资料刷新」：只在 `account` 存在时发起
//   `cloud_me_profile`（固定路由窄命令，native 注入会话 cookie），不进入
//   启动关键路径；失败一律回退首字母，不升级成会话结论——会话真相仍归
//   `DesktopCloudSessionStore`；
// - 按 userId 缓存而不是按「当前登录态」：换账号自然取不同键，同一用户
//   重登仍可用（头像非凭据，不存在跨账号泄漏面）；
// - `checked` 标记「成功读取过」（含「无头像」）——重挂载不重拉；读取失败
//   不标记，下次挂载重试一次（有界、由用户动作驱动）。

import { useEffect, useSyncExternalStore } from 'react';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { DesktopCloudAccountSummary } from '@mahoshojo/contracts/desktop-cloud';

import { readMyProfile, type InvokeFn } from '../../platform/cloud-bridge';

const avatars = new Map<number, string>();
const checked = new Set<number>();
const inflight = new Set<number>();
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

export const subscribeTopbarAvatar = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getTopbarAvatar = (userId: number | null): string | null =>
  userId === null ? null : (avatars.get(userId) ?? null);

/**
 * 后台拉取一次头像（single-flight、幂等）。成功（含「无头像」）后不再
 * 自动重拉；失败保持未标记，由下一次挂载决定是否重试。
 */
export const ensureTopbarAvatar = (
  userId: number,
  invoke: InvokeFn = tauriInvoke,
): void => {
  if (checked.has(userId) || inflight.has(userId)) return;
  inflight.add(userId);
  void readMyProfile(invoke)
    .then((profile) => {
      checked.add(userId);
      const url = profile.avatarDataUrl;
      if (typeof url === 'string' && url.length > 0) {
        avatars.set(userId, url);
      }
    })
    .catch(() => {
      // 头像失败不升级：顶栏回退首字母；not-authenticated 的会话结论由
      // 下一次 refresh/auth_status 统一收口，这里不另建清理路径。
    })
    .finally(() => {
      inflight.delete(userId);
      notify();
    });
};

/** 仅供测试：清空头像缓存与在途标记。 */
export const resetTopbarAvatarForTests = (): void => {
  avatars.clear();
  checked.clear();
  inflight.clear();
};

/** 顶栏头像 hook：`account` 存在即后台取一次，返回缓存的 data URL 或 null。 */
export const useTopbarAvatar = (
  account: DesktopCloudAccountSummary | null,
): string | null => {
  const userId = account?.userId ?? null;
  const avatar = useSyncExternalStore(subscribeTopbarAvatar, () =>
    getTopbarAvatar(userId),
  );
  useEffect(() => {
    if (userId !== null) ensureTopbarAvatar(userId);
  }, [userId]);
  return avatar;
};
