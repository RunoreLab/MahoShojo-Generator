import { getChallengeResourcePresentation, getChallengeWorldPreset } from '@/lib/challenge/world-registry';
import type { ChallengeNodeType, ChallengeWorldId, NodeVisibility, RunStateV1 } from '@/lib/challenge/types';
import { formatChallengeNodeTypeLabel, formatMapHintLabel } from '@/lib/challenge/display-text';
import { getSelectableNodeIdsForMap } from '@/components/challenge/hooks/useChallengeController';

type ChallengeMapPageProps = {
  worldTitle: string;
  runState: RunStateV1;
  latestNodeSummary: string;
  onEnterNode: (nodeId: string) => void;
};

const getVisibilityLabel = (input: { visibility: NodeVisibility; canEnter: boolean }): string => {
  if (input.visibility === 'resolved') return '已完成';
  if (input.visibility === 'focused') {
    return input.canEnter ? '可进入' : '前方可见';
  }
  return '未接触';
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

export function ChallengeMapPage({
  worldTitle,
  runState,
  latestNodeSummary,
  onEnterNode,
}: ChallengeMapPageProps) {
  const mapState = runState.mapState;
  const worldPreset = getChallengeWorldPreset(runState.worldPresetId as ChallengeWorldId);
  const presentation = getChallengeResourcePresentation(worldPreset.resourcePresentationId);
  const selectableNodeIds = new Set(getSelectableNodeIdsForMap(runState));

  if (!mapState) {
    return (
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_16px_48px_rgba(148,163,184,0.10)]">
        <h2 className="text-2xl font-semibold text-slate-900">挑战地图</h2>
        <p className="mt-3 text-sm text-slate-500">地图尚未生成。</p>
      </section>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]">
      <aside className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_16px_48px_rgba(148,163,184,0.10)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">地图总览</p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900">挑战地图</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{worldTitle} 的首版固定图谱已经冻结，可在可见节点之间选择推进路线。</p>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">当前状态</p>
          <p className="mt-2 text-sm text-slate-600">{formatRunStatus(runState.status)}</p>
          <p className="mt-1 text-sm text-slate-600">节点总数 {mapState.nodes.length}</p>
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
      </aside>

      <section className="rounded-[28px] border border-rose-200/60 bg-white/90 p-6 shadow-[0_18px_54px_rgba(244,114,182,0.12)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">路线概览</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">14 节点路径图</h3>
          </div>
          <p className="text-sm text-slate-500">仅可进入标记为“可进入”的节点。</p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {mapState.nodes.map((node) => {
            const canEnter = selectableNodeIds.has(node.nodeId);
            return (
              <article
                key={node.nodeId}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 transition hover:border-rose-200 hover:bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{node.nodeId}</p>
                    <p className="mt-2 text-base font-semibold text-slate-900">{formatChallengeNodeTypeLabel(node.nodeType as ChallengeNodeType)}</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">
                    {getVisibilityLabel({ visibility: node.visibility, canEnter })}
                  </span>
                </div>

                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p>层数：L{node.layer}</p>
                  <p>风险：{formatMapHintLabel(node.riskHint)}</p>
                  <p>收益：{formatMapHintLabel(node.rewardHint)}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onEnterNode(node.nodeId)}
                  disabled={!canEnter}
                  className="mt-4 w-full rounded-full px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:border disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  style={
                    canEnter
                      ? {
                          background: 'linear-gradient(135deg, #fb7185, #f97316)',
                          color: '#fff',
                        }
                      : undefined
                  }
                >
                  {canEnter ? '进入节点' : '当前不可进入'}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
