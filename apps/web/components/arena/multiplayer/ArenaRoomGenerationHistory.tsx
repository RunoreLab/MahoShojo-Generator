'use client';

import { useEffect, useState } from 'react';

import type {
  ArenaRoomGenerationHistoryItem,
  ArenaRoomGenerationHistoryViewResponse,
} from '@mahoshojo/contracts/arena-room';

import { buttonClassName } from '@/components/shared/ui/Button';

import { BattleResultPresentation } from '../components/BattleResultPresentation';
import type { ArenaRoomGenerationHistoryReader } from './useArenaRoom';
import {
  arenaRoomCollaborativeTag,
  arenaRoomHistoryExpiredNotice,
  arenaRoomHistoryNotArchivedNotice,
} from './presentation/room-copy';

const stateLabel: Record<ArenaRoomGenerationHistoryItem['state'], string> = {
  starting: '启动中',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const displayTime = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('zh-CN')
    : value;
};

const errorMessage = (error: unknown): string => (
  error instanceof Error && error.message.trim()
    ? error.message
    : '历史战报暂时无法读取，请稍后重试'
);

export function ArenaRoomGenerationHistory({
  reader,
  onSaveImage,
}: {
  readonly reader: ArenaRoomGenerationHistoryReader;
  readonly onSaveImage?: (imageUrl: string) => void;
}) {
  const [items, setItems] = useState<readonly ArenaRoomGenerationHistoryItem[]>([]);
  const [selected, setSelected] = useState<ArenaRoomGenerationHistoryViewResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingGenerationId, setLoadingGenerationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = async (): Promise<void> => {
    setLoadingList(true);
    setError(null);
    try {
      const history = await reader.list();
      setItems(history.items);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    setError(null);
    void reader.list().then((history) => {
      if (!cancelled) setItems(history.items);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(errorMessage(reason));
    }).finally(() => {
      if (!cancelled) setLoadingList(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reader]);

  const read = async (generationId: string): Promise<void> => {
    if (loadingGenerationId) return;
    setLoadingGenerationId(generationId);
    setSelected(null);
    setError(null);
    try {
      setSelected(await reader.read(generationId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingGenerationId(null);
    }
  };

  return (
    <section aria-labelledby="arena-room-generation-history-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="arena-room-generation-history-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
            本房间历史战报
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            历史战报仅保留一段时间；房间结束后或记录过期后无法再查看。
          </p>
        </div>
        <button type="button" className={buttonClassName()} disabled={loadingList} onClick={() => { void loadList(); }}>
          {loadingList ? '正在刷新…' : '刷新列表'}
        </button>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {loadingList && items.length === 0 ? (
        <p role="status" className="mt-3 text-sm text-gray-600 dark:text-gray-400">正在读取房间历史…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">当前房间还没有战报记录。</p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1" aria-label="房间历史战报列表">
          {items.map((item) => (
            <li key={item.generationId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white/70 p-3 dark:border-gray-700 dark:bg-gray-950/30">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-950 dark:text-gray-100">
                  {stateLabel[item.state]}
                  {item.collaborativeInfluence ? ` · ${arenaRoomCollaborativeTag}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {displayTime(item.finishedAt ?? item.startedAt)}
                </p>
              </div>
              <button
                type="button"
                className={buttonClassName()}
                disabled={loadingGenerationId !== null}
                onClick={() => { void read(item.generationId); }}
              >
                {loadingGenerationId === item.generationId ? '正在读取…' : '查看战报'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-950 dark:text-gray-100">
              {selected.contentStatus === 'available' ? '历史战报' : stateLabel[selected.generation.state]}
            </p>
            <button type="button" className={buttonClassName()} onClick={() => setSelected(null)}>收起战报</button>
          </div>
          {selected.contentStatus === 'available' ? (
            <BattleResultPresentation
              report={{
                format: 'stream-markdown',
                content: selected.markdown,
                isStreaming: false,
                mode: selected.result?.mode,
                scenarioName: selected.result?.scenarioDisplayName,
                reporterInfo: selected.result?.reporterInfo ?? null,
                userGuidance: selected.result?.sharedGuidance ?? null,
                characterGuidances: selected.result?.characterGuidances?.map((guidance) => ({
                  characterName: guidance.displayName,
                  guidance: guidance.guidance,
                })) ?? null,
                aiUsage: selected.result?.ai?.usage ?? null,
                aiModel: selected.result?.ai?.model ?? null,
                narrativeHistoryReadCount: selected.result?.narrativeHistoryReadCount ?? null,
              }}
              onSaveImage={onSaveImage}
              adjudicationResults={selected.result?.adjudicationResults ?? null}
              combatantUpdates={selected.result?.combatantUpdates ?? null}
            />
          ) : selected.contentStatus === 'expired' ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">{arenaRoomHistoryExpiredNotice}</p>
          ) : selected.contentStatus === 'not-archived' ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">{arenaRoomHistoryNotArchivedNotice}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
