import type { BuildRuleRuntimeResult } from '@/lib/creator/build-rule-runtime';
import type { BuildRulePreset } from '@/lib/creator/types';

import type { CreatorTemplateId } from '@/lib/creator/templates';

interface BuildSummaryPanelProps {
  template: CreatorTemplateId;
  primaryRuleId: string | null;
  presetLookup: Record<string, BuildRulePreset>;
  buildRules: readonly BuildRuleRuntimeResult[];
}

export function BuildSummaryPanel({
  template,
  primaryRuleId,
  presetLookup,
  buildRules,
}: BuildSummaryPanelProps) {
  return (
    <section className="input-group">
      <label className="input-label">规则摘要</label>
      <div className="rounded-3xl border border-gray-200 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="rounded-full bg-gray-100 px-2 py-1">
            当前模板：{template}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-1">
            主规则：{primaryRuleId ?? '未选择'}
          </span>
        </div>

        {buildRules.length === 0 ? (
          <p className="mt-4 text-sm leading-6 text-gray-500">
            还没有启用任何车卡规则。你可以只用自由文本生成，也可以先选规则再把派生值与固定事实注入 prompt。
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {buildRules.map((rule) => {
              const preset = presetLookup[rule.ruleId];
              return (
                <article
                  key={rule.ruleId}
                  className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {preset?.title ?? rule.ruleId}
                    </h3>
                    <span
                      className={[
                        'rounded-full px-2 py-1 text-[11px] font-medium',
                        rule.validationSummary.valid
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700',
                      ].join(' ')}
                    >
                      {rule.validationSummary.valid ? '校验通过' : '需要修正'}
                    </span>
                    {primaryRuleId === rule.ruleId ? (
                      <span className="rounded-full bg-pink-100 px-2 py-1 text-[11px] text-pink-700">
                        主规则
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {Object.entries(rule.derived).map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-2xl bg-white px-3 py-3 text-center shadow-sm"
                      >
                        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400">
                          {key}
                        </div>
                        <div className="mt-1 text-lg font-semibold text-gray-900">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {rule.validationSummary.issues.length > 0 ? (
                    <ul className="mt-3 space-y-2 text-sm text-amber-700">
                      {rule.validationSummary.issues.map((issue, index) => (
                        <li key={`${issue.blockKey}-${issue.code}-${index}`}>
                          {issue.blockKey} · {issue.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
