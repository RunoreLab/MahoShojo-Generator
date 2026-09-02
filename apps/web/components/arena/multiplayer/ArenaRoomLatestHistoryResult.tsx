'use client';

import { BattleResultPresentation } from '../components/BattleResultPresentation';
import type { ArenaRoomLatestCompletedHistory } from './useArenaRoomLatestCompletedHistory';

const displayTime = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('zh-CN')
    : value;
};

export function ArenaRoomLatestHistoryResult({
  history,
  onSaveImage,
}: {
  readonly history: ArenaRoomLatestCompletedHistory;
  readonly onSaveImage?: (imageUrl: string) => void;
}) {
  if (history.status !== 'ready' || !history.latest) {
    if (history.status === 'failed') {
      return (
        <section
          aria-labelledby="arena-room-latest-history-heading"
          className="rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/60"
        >
          <h3 id="arena-room-latest-history-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
            最近一场房间战报
          </h3>
          <p role="status" className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            最近一场房间战报暂时无法读取；可稍后通过“历史战报”入口查看。
          </p>
        </section>
      );
    }
    return null;
  }

  const latest = history.latest;
  const meta = `${displayTime(latest.generation.finishedAt ?? latest.generation.startedAt)} · 配置版本 ${latest.generation.configRevision}${latest.generation.collaborativeInfluence ? ' · 包含协作变更' : ''}`;

  return (
    <section
      aria-labelledby="arena-room-latest-history-heading"
      className="rounded-xl border border-fuchsia-200 bg-white/80 p-4 dark:border-fuchsia-900 dark:bg-gray-900/70"
      data-arena-room-latest-history="v1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="arena-room-latest-history-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
          最近一场房间战报
        </h3>
        <span className="rounded-full border border-fuchsia-300 px-2 py-0.5 text-xs font-medium text-fuchsia-900 dark:border-fuchsia-700 dark:text-fuchsia-100">
          历史战报
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{meta}</p>
      {latest.contentStatus === 'available' ? (
        <>
          <BattleResultPresentation
            report={{
              format: 'stream-markdown',
              content: latest.markdown,
              isStreaming: false,
              mode: latest.result?.mode,
              scenarioName: latest.result?.scenarioDisplayName,
              reporterInfo: latest.result?.reporterInfo ?? null,
              userGuidance: latest.result?.sharedGuidance ?? null,
              characterGuidances: latest.result?.characterGuidances?.map((guidance) => ({
                characterName: guidance.displayName,
                guidance: guidance.guidance,
              })) ?? null,
              aiUsage: latest.result?.ai?.usage ?? null,
              aiModel: latest.result?.ai?.model ?? null,
              narrativeHistoryReadCount: latest.result?.narrativeHistoryReadCount ?? null,
            }}
            onSaveImage={onSaveImage}
            adjudicationResults={latest.result?.adjudicationResults ?? null}
            combatantUpdates={latest.result?.combatantUpdates ?? null}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            以上是加入前的历史战报；开始新战报后此区域会切换为实时内容。
          </p>
        </>
      ) : latest.contentStatus === 'expired' ? (
        <p role="status" className="mt-2 text-sm text-amber-800 dark:text-amber-200">
          战报正文已超过有限保留期，当前无法恢复。
        </p>
      ) : (
        <p role="status" className="mt-2 text-sm text-amber-800 dark:text-amber-200">
          这场战报当时未成功归档，当前没有可恢复的正文。
        </p>
      )}
    </section>
  );
};
