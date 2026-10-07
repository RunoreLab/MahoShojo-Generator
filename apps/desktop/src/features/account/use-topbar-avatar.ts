// 顶栏头像：userId → `avatarDataUrl` 的进程级缓存（D5.2 / DESK-ONLINE-008 r2）。
//
// - 头像属于「有身份后的后台资料刷新」：只在 `account` 存在时发起
//   `cloud_me_profile`（固定路由窄命令，native 注入会话 cookie），不进入
//   启动关键路径；失败一律回退首字母，不升级成会话结论——会话真相仍归
//   `DesktopCloudSessionStore`；
// - 按 userId 缓存而不是按「当前登录态」：换账号自然取不同键，同一用户
//   重登仍可用（头像非凭据，不存在跨账号泄漏面）；
// - `checked` 标记「成功读取过」（含「无头像」）——重挂载不重拉；读取失败
//   不标记，下次挂载重试一次（有界、由用户动作驱动）；
// - 失效由会话边界驱动（登出/新登录成功 → `invalidateTopbarAvatar`）：
//   每 userId 的世代号 +1 让在途响应自然过期，Web 侧换了头像不会把
//   同进程旧缓存留到下一次登录。

import { useEffect, useSyncExternalStore } from 'react';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { DesktopCloudAccountSummary } from '@mahoshojo/contracts/desktop-cloud';

import { DesktopCloudError, readMyProfile, type InvokeFn } from '../../platform/cloud-bridge';

const avatars = new Map<number, string>();
const checked = new Set<number>();
const inflight = new Set<number>();
// 每 userId 的世代号：invalidate 时 +1；在途请求带回发起时的世代，
// 结算时世代不一致即丢弃，防止旧响应复活刚被失效的缓存槽。
const generations = new Map<number, number>();
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

export const subscribeTopbarAvatar = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getTopbarAvatar = (userId: number | null): string | null =>
  userId === null ? null : (avatars.get(userId) ?? null);

/**
 * 失效某账号的头像缓存（登出/新登录成功等会话边界调用）。
 * 已发出的请求不中断：世代号前进一格，迟到响应结算时自然被丢弃。
 */
export const invalidateTopbarAvatar = (userId: number): void => {
  generations.set(userId, (generations.get(userId) ?? 0) + 1);
  // 两个槽都要清（|| 会短路掉第二个 delete）。
  const hadAvatar = avatars.delete(userId);
  const hadChecked = checked.delete(userId);
  if (hadAvatar || hadChecked) notify();
};

/**
 * 后台拉取一次头像（single-flight、幂等）。成功（含「无头像」）后不再
 * 自动重拉；失败保持未标记，由下一次挂载决定是否重试。
 */
export const ensureTopbarAvatar = (
  userId: number,
  invoke: InvokeFn = tauriInvoke,
  onSessionRejected?: () => void,
): void => {
  if (checked.has(userId) || inflight.has(userId)) return;
  const generation = generations.get(userId) ?? 0;
  inflight.add(userId);
  void readMyProfile(invoke)
    .then((profile) => {
      // stale-response fence 两道闸：响应携带的账号 id（native 按当前
      // 凭据填）必须与请求目标一致，且请求期间世代未被 invalidate 推进——
      // 否则是登出/换号竞态下的迟到响应，不写回也不标记 checked。
      if (profile.userId !== userId) return;
      if ((generations.get(userId) ?? 0) !== generation) return;
      checked.add(userId);
      const url = profile.avatarDataUrl;
      if (typeof url === 'string' && url.length > 0) {
        avatars.set(userId, url);
      }
    })
    .catch((cause: unknown) => {
      // 头像失败不升级：顶栏回退首字母。只有 `not-authenticated`（native 401
      // 清凭据）值得上报一次——宿主据此触发 `refresh` 让投影收束；会话结论
      // 仍由 `DesktopCloudSessionStore` 统一下，这里不另建清理路径。收敛是
      // 有界的：每次失败至多触发一次，refresh 本身是 single-flight。
      if (cause instanceof DesktopCloudError && cause.code === 'not-authenticated') {
        onSessionRejected?.();
      }
    })
    .finally(() => {
      inflight.delete(userId);
      notify();
    });
};

/** 仅供测试：清空头像缓存、世代与在途标记。 */
export const resetTopbarAvatarForTests = (): void => {
  avatars.clear();
  checked.clear();
  inflight.clear();
  generations.clear();
};

/** 顶栏头像 hook：`account` 存在即后台取一次，返回缓存的 data URL 或 null。 */
export const useTopbarAvatar = (
  account: DesktopCloudAccountSummary | null,
  options?: { readonly onSessionRejected?: () => void },
): string | null => {
  const userId = account?.userId ?? null;
  const onSessionRejected = options?.onSessionRejected;
  const avatar = useSyncExternalStore(subscribeTopbarAvatar, () =>
    getTopbarAvatar(userId),
  );
  useEffect(() => {
    if (userId !== null) ensureTopbarAvatar(userId, tauriInvoke, onSessionRejected);
  }, [userId, onSessionRejected]);
  return avatar;
};
