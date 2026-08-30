import type { ChallengeNodeType } from '@/lib/challenge/types';
import { formatChallengeNodeTypeLabel } from '@/lib/challenge/display-text';

const NODE_TYPES: ChallengeNodeType[] = ['battle', 'elite', 'event', 'rest', 'shop', 'boss'];

const TYPE_MARKS: Record<ChallengeNodeType, string> = {
  battle: '战',
  elite: '英',
  event: '事',
  rest: '休',
  shop: '店',
  boss: '首',
};

const STATUS_ITEMS = [
  { label: '可选节点', className: 'border-rose-400 bg-rose-100 text-rose-700' },
  { label: '已完成', className: 'border-amber-400 bg-amber-100 text-amber-700' },
  { label: '前方可见', className: 'border-slate-300 bg-white text-slate-600' },
  { label: '未接触', className: 'border-slate-200 bg-slate-100 text-slate-400' },
];

export function ChallengeMapLegend() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
      <p className="text-sm font-medium text-slate-900">地图图例</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        {NODE_TYPES.map((nodeType) => (
          <div key={nodeType} className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-600">
              {TYPE_MARKS[nodeType]}
            </span>
            <span>{formatChallengeNodeTypeLabel(nodeType)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_ITEMS.map((item) => (
          <span key={item.label} className={`rounded-full border px-2.5 py-1 text-xs ${item.className}`}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
