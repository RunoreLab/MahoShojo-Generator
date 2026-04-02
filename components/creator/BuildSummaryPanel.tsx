import type { BuildRuleRuntimeResult } from '@/lib/creator/types';

type BuildSummaryPanelProps = {
  runtimeResult: BuildRuleRuntimeResult;
};

export function BuildSummaryPanel({ runtimeResult }: BuildSummaryPanelProps) {
  const budget = runtimeResult.validationSummary.budget;
  const issues = runtimeResult.validationSummary.issues;

  return (
    <section className="rounded-2xl border border-emerald-100 bg-white/85 p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-emerald-900">规则摘要</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">这里展示规则运行时计算出的预算统计、派生值与校验结论。</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="text-xs text-slate-500">HP</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{runtimeResult.derived.HP ?? '-'}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="text-xs text-slate-500">MP</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{runtimeResult.derived.MP ?? '-'}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="text-xs text-slate-500">Radiance</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{runtimeResult.derived.Radiance ?? '-'}</div>
        </div>
      </div>

      {budget ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <div className="font-medium text-slate-900">属性点</div>
            <div className="mt-1">
              {budget.attributePointsUsed} / {budget.attributePointsLimit ?? '无限'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <div className="font-medium text-slate-900">专长点</div>
            <div className="mt-1">
              {budget.specialtyPointsUsed} / {budget.specialtyPointsLimit ?? '无限'}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`mt-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${
          runtimeResult.validationSummary.valid
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-rose-200 bg-rose-50 text-rose-800'
        }`}
      >
        <div className="font-semibold">{runtimeResult.validationSummary.valid ? '规则校验通过' : '规则校验未通过'}</div>
        {issues.length > 0 ? (
          <ul className="mt-2 list-disc pl-5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2">当前输入未发现规则问题。</p>
        )}
      </div>
    </section>
  );
}
