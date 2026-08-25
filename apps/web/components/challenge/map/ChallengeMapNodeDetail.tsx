import type { ChallengeMapLayoutNode } from '@/lib/challenge/map-layout';
import type { ChallengeNodeType } from '@/lib/challenge/types';
import { formatChallengeNodeTypeLabel, formatMapHintLabel } from '@/lib/challenge/display-text';

const STATE_LABELS: Record<ChallengeMapLayoutNode['state'], string> = {
  available: '当前可选',
  completed: '已完成',
  focused: '前方可见',
  hidden: '未接触',
};

type ChallengeMapNodeDetailProps = {
  layoutNode: ChallengeMapLayoutNode | null;
  onEnterNode: (nodeId: string) => void;
};

export function ChallengeMapNodeDetail({
  layoutNode,
  onEnterNode,
}: ChallengeMapNodeDetailProps) {
  if (!layoutNode) {
    return (
      <aside className="rounded-3xl border border-slate-200 bg-white/90 p-5">
        <p className="text-sm font-medium text-slate-900">节点情报</p>
        <p className="mt-2 text-sm text-slate-500">请选择一个节点查看详情。</p>
      </aside>
    );
  }

  const node = layoutNode.node;
  const nodeType = node.nodeType as ChallengeNodeType;

  return (
    <aside className="rounded-3xl border border-rose-100 bg-white/90 p-5 shadow-[0_16px_36px_rgba(244,114,182,0.10)]">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500">节点情报</p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{node.nodeId}</p>
          <h4 className="mt-1 text-xl font-semibold text-slate-900">{formatChallengeNodeTypeLabel(nodeType)}</h4>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
          {STATE_LABELS[layoutNode.state]}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <dt className="text-xs text-slate-500">层数</dt>
          <dd className="mt-1 font-medium text-slate-900">L{node.layer}</dd>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <dt className="text-xs text-slate-500">风险评估</dt>
          <dd className="mt-1 font-medium text-slate-900">{formatMapHintLabel(node.riskHint)}</dd>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <dt className="text-xs text-slate-500">潜在收益</dt>
          <dd className="mt-1 font-medium text-slate-900">{formatMapHintLabel(node.rewardHint)}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => onEnterNode(node.nodeId)}
        disabled={!layoutNode.canEnter}
        className="mt-5 w-full rounded-full px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:border disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        style={
          layoutNode.canEnter
            ? {
                background: 'linear-gradient(135deg, #fb7185, #f97316)',
                color: '#fff',
              }
            : undefined
        }
      >
        {layoutNode.canEnter ? '进入节点' : '当前不可进入'}
      </button>
    </aside>
  );
}
