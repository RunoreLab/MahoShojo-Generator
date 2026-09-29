'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';

import { getLocalWebPackageRepository } from './web-package-repository';

export interface LocalWebPackagesState {
  records: LocalWebPackageRecordV1[];
  status: 'idle' | 'loading' | 'success' | 'error';
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * 本地库中的 Web 包列表。
 *
 * 一次读全量后在客户端做搜索与分页：本地库是设备数据而不是服务端资源，
 * 「未登录可用、断网可用」正是它存在的理由。
 */
export const useLocalWebPackages = (enabled: boolean): LocalWebPackagesState => {
  const [records, setRecords] = useState<LocalWebPackageRecordV1[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setStatus('loading');
    setError(null);
    void (async () => {
      const repository = getLocalWebPackageRepository();
      const items: LocalWebPackageRecordV1[] = [];
      let cursor: string | undefined;
      do {
        const page = await repository.list({ limit: 100, ...(cursor ? { cursor } : {}) });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return items;
    })().then((items) => {
      if (!active) return;
      setRecords(items);
      setStatus('success');
    }).catch((cause: unknown) => {
      if (!active) return;
      setRecords([]);
      setStatus('error');
      setError(cause instanceof Error ? cause.message : '本地库读取失败，请重试。');
    });
    return () => { active = false; };
  }, [enabled, refresh]);

  return useMemo(
    () => ({ records, status, loading: status === 'loading', error, reload }),
    [records, status, error, reload],
  );
};
