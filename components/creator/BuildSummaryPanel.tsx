import type { BuildRuleRuntimeResult } from '@/lib/creator/types';
import {
  CREATOR_PANEL_SURFACE_CLASS,
  CREATOR_SUBPANEL_SURFACE_CLASS,
  joinCreatorClassNames,
} from '@/components/creator/surfaceStyles';

type BuildSummaryPanelProps = {
  runtimeResult: BuildRuleRuntimeResult;
};

type SummaryItem = {
  key: string;
  label: string;
  value: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatSignedNumber = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value > 0 ? `+${Math.trunc(value)}` : `${Math.trunc(value)}`;
};

const translateSpellcastingKind = (value: unknown): string => {
  switch (value) {
    case 'full':
      return '完整施法';
    case 'half':
      return '半施法';
    case 'pact':
      return '契约施法';
    case 'none':
      return '无施法';
    default:
      return typeof value === 'string' && value.trim() ? value.trim() : '-';
  }
};

const buildSummaryItems = (runtimeResult: BuildRuleRuntimeResult): SummaryItem[] => {
  const derived = isRecord(runtimeResult.derived) ? runtimeResult.derived : {};

  if (runtimeResult.ruleId === 'dnd-5e-lite') {
    const abilityModifiers = isRecord(derived.abilityModifiers) ? derived.abilityModifiers : {};
    return [
      {
        key: 'proficiencyBonus',
        label: '熟练加值',
        value: formatSignedNumber(derived.proficiencyBonus),
      },
      {
        key: 'hitDie',
        label: '命中骰',
        value: typeof derived.hitDie === 'string' ? derived.hitDie : '-',
      },
      {
        key: 'spellcastingKind',
        label: '施法类型',
        value: translateSpellcastingKind(derived.spellcastingKind),
      },
      {
        key: 'abilityModifiers',
        label: '能力调整值',
        value: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']
          .map((abilityKey) => `${abilityKey} ${formatSignedNumber(abilityModifiers[abilityKey])}`)
          .join(' / '),
      },
    ];
  }

  if (runtimeResult.ruleId === 'coc-7e-lite') {
    return [
      { key: 'SAN', label: 'SAN', value: `${derived.SAN ?? '-'}` },
      { key: 'HP', label: 'HP', value: `${derived.HP ?? '-'}` },
      { key: 'MP', label: 'MP', value: `${derived.MP ?? '-'}` },
      { key: 'Build', label: 'Build', value: `${derived.Build ?? '-'}` },
      { key: 'DamageBonus', label: 'Damage Bonus', value: `${derived.DamageBonus ?? '-'}` },
    ];
  }

  return [
    { key: 'HP', label: 'HP', value: `${derived.HP ?? '-'}` },
    { key: 'MP', label: 'MP', value: `${derived.MP ?? '-'}` },
    { key: 'Radiance', label: 'Radiance', value: `${derived.Radiance ?? '-'}` },
  ];
};

export function BuildSummaryPanel({ runtimeResult }: BuildSummaryPanelProps) {
  const budget = runtimeResult.validationSummary.budget;
  const issues = runtimeResult.validationSummary.issues;
  const summaryItems = buildSummaryItems(runtimeResult);
  const shouldShowBudget =
    !!budget
    && (
      budget.attributePointsUsed > 0
      || budget.specialtyPointsUsed > 0
      || budget.attributePointsLimit !== null
      || budget.specialtyPointsLimit !== null
    );

  return (
    <section
      data-creator-surface="panel"
      className={CREATOR_PANEL_SURFACE_CLASS}
    >
      <div className="mb-3">
        <h3 className="text-base font-semibold text-emerald-900">规则摘要</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">这里展示规则运行时计算出的预算统计、派生值与校验结论。</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {summaryItems.map((item) => (
          <div key={item.key} data-creator-surface="subpanel" className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'p-3')}>
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 break-words">{item.value}</div>
          </div>
        ))}
      </div>

      {shouldShowBudget ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div
            data-creator-surface="subpanel"
            className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'bg-[var(--creator-subpanel-emphasis-bg)] p-3 text-sm text-slate-700')}
          >
            <div className="font-medium text-slate-900">属性点</div>
            <div className="mt-1">
              {budget.attributePointsUsed} / {budget.attributePointsLimit ?? '无限'}
            </div>
          </div>
          <div
            data-creator-surface="subpanel"
            className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'bg-[var(--creator-subpanel-emphasis-bg)] p-3 text-sm text-slate-700')}
          >
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
