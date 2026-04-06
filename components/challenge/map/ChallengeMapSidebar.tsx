import type { ResourcePresentationPresetV1, RunStateV1 } from '@/lib/challenge/types';
import { ChallengeMapLegend } from '@/components/challenge/map/ChallengeMapLegend';

type ChallengeMapSidebarProps = {
  worldTitle: string;
  runState: RunStateV1;
  nodeCount: number;
  latestNodeSummary: string;
  presentation: ResourcePresentationPresetV1;
};

const formatRunStatus = (status: RunStateV1['status']): string => {
  switch (status) {
    case 'in_progress':
      return '挑战进行中';
    case 'completed':
      return '挑战成功';
    case 'failed':
      return '挑战失败';
    case 'bootstrapping':
      return '快照确认中';
    default:
      return '已离开挑战';
  }
};

export function ChallengeMapSidebar({
  worldTitle,
  runState,
  nodeCount,
  latestNodeSummary,
  presentation,
}: ChallengeMapSidebarProps) {
  return (
    <aside className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_16px_48px_rgba(148,163,184,0.10)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">地图总览</p>
      <h2 className="mt-3 text-2xl font-semibold text-slate-900">挑战地图</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{worldTitle} 的路线图已展开，请根据可进入节点规划下一步推进。</p>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-sm font-medium text-slate-900">当前状态</p>
        <p className="mt-2 text-sm text-slate-600">{formatRunStatus(runState.status)}</p>
        <p className="mt-1 text-sm text-slate-600">节点总数 {nodeCount}</p>
        <p className="mt-1 text-sm text-slate-600">已完成节点 {runState.visitedNodeCount}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-sm font-medium text-slate-900">玩家状态</p>
        <div className="mt-3 space-y-2">
          {presentation.primaryTracks.map((track) => {
            const currentTrack = runState.worldState?.tracks[track.trackId];
            return (
              <div key={track.trackId} className="flex items-center justify-between gap-3 text-sm text-slate-600">
                <span>{track.label}</span>
                <span className="font-medium text-slate-900">
                  {currentTrack ? `${currentTrack.current}${currentTrack.max === null ? '' : ` / ${currentTrack.max}`}` : '暂无'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-sm font-medium text-slate-900">最近节点结果摘要</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{latestNodeSummary || '尚未开始推进。'}</p>
      </div>

      <div className="mt-4">
        <ChallengeMapLegend />
      </div>
    </aside>
  );
}

