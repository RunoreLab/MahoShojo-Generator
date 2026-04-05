import type { ChallengeEntrantSummary } from '@/components/challenge/hooks/useChallengeController';

type ChallengeEntrantSummaryCardProps = {
  summary: ChallengeEntrantSummary | null;
  onClear: () => void;
  onRevealAdvancedEditor: () => void;
  onLoadDemoCard: () => void;
};

export function ChallengeEntrantSummaryCard({
  summary,
  onClear,
  onRevealAdvancedEditor,
  onLoadDemoCard,
}: ChallengeEntrantSummaryCardProps) {
  if (!summary) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5 text-sm text-slate-600">
        <p className="font-medium text-slate-900">还没有选中挑战者</p>
        <p className="mt-2 leading-6">可以先从在线角色库挑一张卡，也可以直接载入试玩示例开始测试 challenge 流程。</p>
        <button
          type="button"
          onClick={onLoadDemoCard}
          className="mt-4 rounded-full border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-600 transition hover:bg-rose-100"
        >
          载入试玩示例
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50/60 px-4 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{summary.displayName}</p>
          <p className="mt-2 text-sm text-slate-600">
            {summary.templateLabel} · {summary.sourceModeLabel}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {summary.bootstrapStatusMessage}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            summary.isReadyForBootstrap ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}
        >
          {summary.isReadyForBootstrap ? '可用于 challenge bootstrap' : '待补全'}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRevealAdvancedEditor}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:border-rose-300 hover:text-rose-600"
        >
          展开高级 JSON 编辑
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
        >
          清空当前角色
        </button>
      </div>
    </div>
  );
}
