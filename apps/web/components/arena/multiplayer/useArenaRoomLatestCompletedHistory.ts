'use client';

import { useEffect, useRef, useState } from 'react';

import type { ArenaRoomGenerationHistoryViewResponse } from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomGenerationHistoryReader } from './useArenaRoom';

export type ArenaRoomLatestCompletedHistory = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'failed';
  latest: ArenaRoomGenerationHistoryViewResponse | null;
  completedCount: number;
}>;

const initialLatestHistory: ArenaRoomLatestCompletedHistory = {
  status: 'idle',
  latest: null,
  completedCount: 0,
};

/**
 * Join 体验（SPEC 9.3）：会话激活且没有可展示的实时战报时，异步读取
 * 最近一场 completed 战报；读取失败只影响该区域，绝不阻塞加入或编辑。
 *
 * 计数与正文读取解耦：
 * - 新会话首次加载执行 list + read latest；
 * - 同一会话内 generation 进入权威终态（refreshKey 变化，调用方只对
 *   completed 触发）后仅 list 刷新 completedCount，不重新下载正文，
 *   也不清空既有 latest；
 * - list 成功而 read 失败时保留已取得的 completedCount，
 *   不因正文读取失败把正确计数清零。
 */
export const useArenaRoomLatestCompletedHistory = (input: {
  readonly reader: ArenaRoomGenerationHistoryReader;
  readonly sessionKey: string | null;
  readonly refreshKey?: string;
  readonly enabled: boolean;
}): ArenaRoomLatestCompletedHistory => {
  const [state, setState] = useState<ArenaRoomLatestCompletedHistory>(initialLatestHistory);
  const loadGenerationRef = useRef(0);
  const loadedSessionKeyRef = useRef<string | null>(null);
  const loadedRefreshKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!input.sessionKey) {
      loadedSessionKeyRef.current = null;
      loadedRefreshKeyRef.current = null;
      loadGenerationRef.current += 1;
      setState(initialLatestHistory);
      return;
    }
    const refreshKey = input.refreshKey ?? '';
    const isNewSession = loadedSessionKeyRef.current !== input.sessionKey;
    // refreshKey 回到空串表示离开终态（如新一轮生成开始），不是计数事件。
    const isCountRefresh = !isNewSession
      && refreshKey !== ''
      && loadedRefreshKeyRef.current !== refreshKey;
    if (isNewSession) {
      if (!input.enabled) return;
      loadedSessionKeyRef.current = input.sessionKey;
    } else if (!isCountRefresh) {
      return;
    }
    if (refreshKey !== '') loadedRefreshKeyRef.current = refreshKey;
    const generation = ++loadGenerationRef.current;
    if (!isNewSession) {
      // 计数刷新：仅 list，成功前保留既有 latest 与计数，失败不打扰用户。
      void (async () => {
        try {
          const history = await input.reader.list();
          if (loadGenerationRef.current !== generation) return;
          setState((previous) => ({
            status: 'ready',
            latest: previous.latest,
            completedCount: history.items.length,
          }));
        } catch {
          // 计数刷新失败保持现状；用户仍可通过“历史战报”入口手动查看。
        }
      })();
      return;
    }
    setState({ status: 'loading', latest: null, completedCount: 0 });
    void (async () => {
      let listedCount: number | null = null;
      try {
        const history = await input.reader.list();
        if (loadGenerationRef.current !== generation) return;
        listedCount = history.items.length;
        const latestItem = history.items[0] ?? null;
        if (!latestItem) {
          setState({ status: 'ready', latest: null, completedCount: 0 });
          return;
        }
        const view = await input.reader.read(latestItem.generationId);
        if (loadGenerationRef.current !== generation) return;
        setState({
          status: 'ready',
          latest: view,
          completedCount: listedCount,
        });
      } catch {
        if (loadGenerationRef.current !== generation) return;
        // list 已成功时保留正确计数，仅将最近战报区域标记为失败。
        setState({
          status: 'failed',
          latest: null,
          completedCount: listedCount ?? 0,
        });
      }
    })();
  }, [input.enabled, input.reader, input.refreshKey, input.sessionKey]);

  return state;
};
