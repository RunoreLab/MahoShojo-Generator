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
 * 同一会话内 generation 进入权威终态（refreshKey 变化）后重新拉取
 * summary 刷新计数，不受 enabled 门禁限制；新会话的首次加载仍遵守门禁。
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
    if (loadedSessionKeyRef.current !== input.sessionKey) {
      if (!input.enabled) return;
      loadedSessionKeyRef.current = input.sessionKey;
      loadedRefreshKeyRef.current = refreshKey;
    } else if (loadedRefreshKeyRef.current === refreshKey) {
      return;
    } else {
      loadedRefreshKeyRef.current = refreshKey;
    }
    const generation = ++loadGenerationRef.current;
    setState({ status: 'loading', latest: null, completedCount: 0 });
    void (async () => {
      try {
        const history = await input.reader.list();
        if (loadGenerationRef.current !== generation) return;
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
          completedCount: history.items.length,
        });
      } catch {
        if (loadGenerationRef.current !== generation) return;
        setState({ status: 'failed', latest: null, completedCount: 0 });
      }
    })();
  }, [input.enabled, input.reader, input.refreshKey, input.sessionKey]);

  return state;
};
