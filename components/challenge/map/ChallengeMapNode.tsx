import type { ChallengeMapLayoutNode, ChallengeMapLayoutNodeState } from '@/lib/challenge/map-layout';
import type { ChallengeNodeType } from '@/lib/challenge/types';
import { formatChallengeNodeTypeLabel } from '@/lib/challenge/display-text';

const TYPE_MARKS: Record<ChallengeNodeType, string> = {
  battle: '战',
  elite: '英',
  event: '事',
  rest: '休',
  shop: '店',
  boss: '首',
};

const STATE_CLASS_NAMES: Record<ChallengeMapLayoutNodeState, string> = {
  available: 'border-rose-400 bg-gradient-to-br from-rose-100 to-orange-100 text-rose-700 shadow-[0_0_24px_rgba(251,113,133,0.38)]',
  completed: 'border-amber-400 bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700 shadow-[0_0_18px_rgba(245,158,11,0.22)]',
  focused: 'border-slate-300 bg-white text-slate-600 shadow-[0_12px_28px_rgba(148,163,184,0.16)]',
  hidden: 'border-slate-200 bg-slate-100/70 text-slate-400',
};

const STATE_LABELS: Record<ChallengeMapLayoutNodeState, string> = {
  available: '可进入',
  completed: '已完成',
  focused: '前方可见',
  hidden: '未接触',
};

type ChallengeMapNodeProps = {
  layoutNode: ChallengeMapLayoutNode;
  isSelected: boolean;
  left: number;
  top: number;
  onSelect: (nodeId: string) => void;
};

export function ChallengeMapNode({
  layoutNode,
  isSelected,
  left,
  top,
  onSelect,
}: ChallengeMapNodeProps) {
  const nodeType = layoutNode.node.nodeType as ChallengeNodeType;

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => onSelect(layoutNode.nodeId)}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-[24px] border px-3 py-2 text-center transition hover:-translate-y-[54%] focus:outline-none focus:ring-2 focus:ring-rose-300 ${STATE_CLASS_NAMES[layoutNode.state]} ${isSelected ? 'ring-2 ring-rose-300 ring-offset-2' : ''}`}
      style={{ left, top }}
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-white/75 text-base font-semibold">
        {TYPE_MARKS[nodeType]}
      </span>
      <span className="text-[11px] font-medium">{formatChallengeNodeTypeLabel(nodeType)}</span>
      <span className="rounded-full bg-white/75 px-2 py-0.5 text-[10px]">{STATE_LABELS[layoutNode.state]}</span>
      <span className="sr-only">{layoutNode.nodeId}</span>
    </button>
  );
}

