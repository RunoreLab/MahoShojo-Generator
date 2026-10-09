// 顶栏与资料共用：userId → 非秘密 profile 的进程级缓存（D5.2 / DESK-ONLINE-008 r2）。
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
// - 个性签名保存只合并服务端确认文本；沿用头像同一缓存和失效世代。

import { useEffect, useSyncExternalStore } from 'react';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { DesktopCloudAccountSummary, DesktopCloudMeProfile } from '@mahoshojo/contracts/desktop-cloud';

import { DesktopCloudError, readMyProfile, type InvokeFn } from '../../platform/cloud-bridge';

const profiles = new Map<number, DesktopCloudMeProfile>();
const profileErrors = new Map<number, string>();
const checked = new Set<number>();
// 在途请求按世代登记（d-1-r1）：裸 `Set<userId>` 会让旧世代在途请求挡住
// 新世代——快速重登后旧响应被世代闸丢弃、新请求又从未发出，头像会空白到
// 下一次挂载。登记世代 + token 后：同世代幂等、跨世代放行，旧请求结算只
// 清自己的槽。
const inflight = new Map<number, { generation: number; token: object }>();
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
  userId === null ? null : (profiles.get(userId)?.avatarDataUrl ?? null);

/**
 * 失效某账号的头像缓存（登出/新登录成功等会话边界调用）。
 * 已发出的请求不中断：世代号前进一格，迟到响应结算时自然被丢弃。
 */
export const invalidateTopbarAvatar = (userId: number): void => {
  generations.set(userId, (generations.get(userId) ?? 0) + 1);
  // 两个槽都要清（|| 会短路掉第二个 delete）。
  const hadAvatar = profiles.delete(userId);
  const hadError = profileErrors.delete(userId);
  const hadChecked = checked.delete(userId);
  if (hadAvatar || hadChecked || hadError) notify();
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
  if (checked.has(userId)) return;
  const generation = generations.get(userId) ?? 0;
  const current = inflight.get(userId);
  // 同世代在途即幂等；旧世代请求不挡路——等它等于无人补拉。
  if (current !== undefined && current.generation === generation) return;
  const token = {};
  inflight.set(userId, { generation, token });
  void readMyProfile(invoke)
    .then((profile) => {
      // stale-response fence 两道闸：响应携带的账号 id（native 按当前
      // 凭据填）必须与请求目标一致，且请求期间世代未被 invalidate 推进——
      // 否则是登出/换号竞态下的迟到响应，不写回也不标记 checked。
      if (profile.userId !== userId) return;
      if ((generations.get(userId) ?? 0) !== generation) return;
      checked.add(userId);
      profiles.set(userId, profile);
      profileErrors.delete(userId);
    })
    .catch((cause: unknown) => {
      // 头像失败不升级：顶栏回退首字母。只有 `not-authenticated`（native 401
      // 清凭据）值得上报一次——宿主据此触发 `refresh` 让投影收束；会话结论
      // 仍由 `DesktopCloudSessionStore` 统一下，这里不另建清理路径。收敛是
      // 有界的：每次失败至多触发一次，refresh 本身是 single-flight。
      if ((generations.get(userId) ?? 0) !== generation) return;
      profileErrors.set(userId, '资料未能载入，请重试。');
      if (cause instanceof DesktopCloudError && cause.code === 'not-authenticated') {
        onSessionRejected?.();
      }
    })
    .finally(() => {
      // token 闸：只清自己的槽——旧世代请求不得误删新请求的登记。
      if (inflight.get(userId)?.token === token) {
        inflight.delete(userId);
      }
      notify();
    });
};

/** 仅供测试：清空头像缓存、世代与在途标记。 */
export const resetTopbarAvatarForTests = (): void => {
  profiles.clear();
  profileErrors.clear();
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

/** 资料与顶栏共享同一份非秘密、按账号隔离的缓存。 */
export const getCachedMyProfile = (userId: number | null): DesktopCloudMeProfile | null =>
  userId === null ? null : profiles.get(userId) ?? null;
export const getMyProfileGeneration = (userId: number): number => generations.get(userId) ?? 0;

/** 已确认 PUT 推进读取世代，迟到 GET 不得把新签名倒退回去。 */
export const acceptSavedProfileSignature = (userId: number, signature: string, generation: number): boolean => {
  if (getMyProfileGeneration(userId) !== generation) return false;
  generations.set(userId, generation + 1);
  profiles.set(userId, { ...profiles.get(userId), userId, signature });
  checked.add(userId);
  profileErrors.delete(userId);
  notify();
  return true;
};

/** 用户显式读回；保留缓存/编辑草稿，只使旧读取失效，不发送写入。 */
export const refreshMyProfile = (userId: number, invoke: InvokeFn = tauriInvoke): void => {
  if (inflight.get(userId)?.generation === getMyProfileGeneration(userId)) return;
  generations.set(userId, getMyProfileGeneration(userId) + 1);
  checked.delete(userId);
  profileErrors.delete(userId);
  ensureTopbarAvatar(userId, invoke);
};

export const useMyProfile = (account: DesktopCloudAccountSummary | null, epoch = 0) => {
  const userId = account?.userId ?? null;
  const profile = useSyncExternalStore(subscribeTopbarAvatar, () => getCachedMyProfile(userId));
  const error = useSyncExternalStore(subscribeTopbarAvatar, () => userId === null ? null : profileErrors.get(userId) ?? null);
  useEffect(() => { if (userId !== null) ensureTopbarAvatar(userId); }, [userId, epoch]);
  return { profile, error, retry: () => { if (userId !== null) refreshMyProfile(userId); } };
};
