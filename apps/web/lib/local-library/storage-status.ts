'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * LIB-003：本地库必须展示是否拿到持久化存储、剩余空间估计，并提醒清除站点数据会删除本地库。
 *
 * 浏览器可能拒绝或不支持 `persist()`。这不影响本地库可用性，只影响 UI 上的风险提示强度。
 */

export interface LocalLibraryStorageStatus {
  /** `navigator.storage.persisted()` 的结果；`null` 表示浏览器不支持或尚未读取。 */
  persisted: boolean | null;
  /** 是否已主动请求过持久化；未请求过时 UI 仍可提供「申请持久存储」动作。 */
  requestedPersist: boolean;
  usage: number | null;
  quota: number | null;
  /** 环境不支持 StorageManager 时无法评估，风险提示必须更保守。 */
  supported: boolean;
  busy: boolean;
  requestPersist: () => Promise<void>;
  refresh: () => Promise<void>;
}

const isStorageManagerAvailable = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.estimate === 'function';

const isPersistApiAvailable = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function';

export const useLocalLibraryStorageStatus = (): LocalLibraryStorageStatus => {
  const supported = isStorageManagerAvailable();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [requestedPersist, setRequestedPersist] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const [estimate, isPersisted] = await Promise.all([
        navigator.storage.estimate(),
        isPersistApiAvailable() ? navigator.storage.persisted() : Promise.resolve(null),
      ]);
      setUsage(typeof estimate.usage === 'number' ? estimate.usage : null);
      setQuota(typeof estimate.quota === 'number' ? estimate.quota : null);
      setPersisted(isPersisted);
    } catch {
      // 估算失败不是致命问题：UI 退回到「无法评估」的保守文案。
      setUsage(null);
      setQuota(null);
    } finally {
      setBusy(false);
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestPersist = useCallback(async () => {
    setRequestedPersist(true);
    if (!isPersistApiAvailable()) {
      setPersisted(null);
      return;
    }
    setBusy(true);
    try {
      setPersisted(await navigator.storage.persist());
    } catch {
      setPersisted(null);
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [refresh]);

  return { persisted, requestedPersist, usage, quota, supported, busy, requestPersist, refresh };
};

export const formatLocalLibraryQuota = (usage: number | null, quota: number | null): string => {
  if (usage === null || quota === null) return '空间占用未知';
  const toMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${toMb(usage)} / ${toMb(quota)}`;
};
