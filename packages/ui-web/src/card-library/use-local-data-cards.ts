import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';

import { mapLocalCardRecordToRow, type LocalDataCardRow } from './rows';

export interface LocalDataCardPageState {
  rows: LocalDataCardRow[];
  records: LocalCardRecordV1[];
  /** 库内总条目数（不受搜索影响），用于 tab 徽标。 */
  libraryTotal: number;
  /** 当前搜索命中的条目数。 */
  total: number;
  status: 'idle' | 'loading' | 'success' | 'error';
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const PAGE_LIMIT = 100;

const readAll = async (
  repository: Pick<CardRepository, 'list'>,
  cardTypes: OnlineDataCardType[] | undefined,
): Promise<LocalCardRecordV1[]> => {
  const items: LocalCardRecordV1[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.list({ limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}), ...(cardTypes ? { cardTypes } : {}) });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
};

/**
 * 本地库数据卡列表。
 *
 * 本地库是设备数据而不是分页的服务端资源：一次读全量后在客户端做搜索与分页，
 * 这样"未登录也能用""断网也能用"才成立。库规模由用户自己的导入量决定。
 */
export const useLocalDataCards = (
  repository: Pick<CardRepository, 'list'>,
  enabled: boolean,
  cardTypes: OnlineDataCardType[] | undefined,
  search: string,
): LocalDataCardPageState => {
  const [records, setRecords] = useState<LocalCardRecordV1[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const latest = useRef(0);
  const typeKey = JSON.stringify(cardTypes ?? null);

  useEffect(() => {
    if (!enabled) return;
    const request = ++latest.current;
    setStatus('loading');
    setError(null);
    void readAll(repository, JSON.parse(typeKey) as OnlineDataCardType[] | undefined).then((items) => {
      if (request !== latest.current) return;
      setRecords(items);
      setStatus('success');
    }).catch((cause: unknown) => {
      if (request !== latest.current) return;
      setRecords([]);
      setStatus('error');
      setError(cause instanceof Error ? cause.message : '本地库读取失败，请重试。');
    });
    return () => {
      latest.current += 1;
    };
  }, [repository, enabled, typeKey, refresh]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const mapped = records.map(mapLocalCardRecordToRow);
    if (!keyword) return mapped;
    return mapped.filter((row) => `${row.name} ${row.description}`.toLowerCase().includes(keyword));
  }, [records, search]);

  return {
    rows,
    records,
    libraryTotal: records.length,
    total: rows.length,
    status,
    loading: status === 'loading',
    error,
    reload: useCallback(() => setRefresh((value) => value + 1), []),
  };
};
