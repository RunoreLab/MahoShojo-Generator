import type { BuildRulePreset, BuildRuleRuntimeResult } from '@/lib/creator/types';

type BuildRulePanelProps = {
  preset: BuildRulePreset;
  inputs: Record<string, unknown>;
  runtimeResult?: BuildRuleRuntimeResult | null;
  onChange: (nextInputs: Record<string, unknown>) => void;
  disabled?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function BuildRulePanel({
  preset,
  inputs,
  runtimeResult = null,
  onChange,
  disabled = false,
}: BuildRulePanelProps) {
  const blocks = Array.isArray(preset.blocks) ? preset.blocks : [];
  const powerLevelBlock = blocks.find((block) => block.id === 'powerLevel');
  const coreAttributesBlock = blocks.find((block) => block.id === 'coreAttributes');
  const specialtiesBlock = blocks.find((block) => block.id === 'specialties');
  const ruleNoticeBlock = blocks.find((block) => block.id === 'ruleNotice');

  const coreAttributes = isRecord(inputs.coreAttributes) ? inputs.coreAttributes : {};
  const selectedSpecialties = Array.isArray(inputs.specialties)
    ? inputs.specialties.filter((item): item is string => typeof item === 'string')
    : [];
  const powerLevel = typeof inputs.powerLevel === 'string' ? inputs.powerLevel : 'seed';
  const budget = runtimeResult?.validationSummary.budget ?? null;
  const issues = runtimeResult?.validationSummary.issues ?? [];
  const attributeBudgetIssue = issues.find((issue) => issue.includes('属性点超出预算')) ?? null;
  const specialtyBudgetIssue = issues.find((issue) => issue.includes('专长点超出预算')) ?? null;
  const attributePointsUsed = budget?.attributePointsUsed ?? null;
  const attributePointsLimit = budget?.attributePointsLimit ?? null;
  const specialtyPointsUsed = budget?.specialtyPointsUsed ?? null;
  const specialtyPointsLimit = budget?.specialtyPointsLimit ?? null;
  const attributeOverBudget =
    attributePointsUsed !== null && attributePointsLimit !== null && attributePointsUsed > attributePointsLimit;
  const specialtyOverBudget =
    specialtyPointsUsed !== null && specialtyPointsLimit !== null && specialtyPointsUsed > specialtyPointsLimit;

  const specialtyCostById = new Map<string, number>();
  if (specialtiesBlock && Array.isArray(specialtiesBlock.groups)) {
    specialtiesBlock.groups.filter(isRecord).forEach((group: Record<string, unknown>) => {
      if (!Array.isArray(group.items)) return;
      group.items.filter(isRecord).forEach((item: Record<string, unknown>) => {
        const itemId = typeof item.id === 'string' ? item.id : '';
        if (!itemId) return;
        specialtyCostById.set(itemId, typeof item.cost === 'number' ? item.cost : 0);
      });
    });
  }

  const specialtyRemainingPoints =
    specialtyPointsUsed !== null && specialtyPointsLimit !== null
      ? specialtyPointsLimit - specialtyPointsUsed
      : null;

  const updateCoreAttribute = (fieldId: string, nextValue: number) => {
    onChange({
      ...inputs,
      coreAttributes: {
        ...coreAttributes,
        [fieldId]: nextValue,
      },
    });
  };

  const toggleSpecialty = (specialtyId: string) => {
    const checked = selectedSpecialties.includes(specialtyId);
    const specialtyCost = specialtyCostById.get(specialtyId) ?? 0;
    const wouldExceedBudget =
      !checked
      && specialtyPointsUsed !== null
      && specialtyPointsLimit !== null
      && specialtyPointsUsed + specialtyCost > specialtyPointsLimit;
    if (wouldExceedBudget) {
      return;
    }

    const nextSpecialties = selectedSpecialties.includes(specialtyId)
      ? selectedSpecialties.filter((item) => item !== specialtyId)
      : [...selectedSpecialties, specialtyId];
    onChange({
      ...inputs,
      specialties: nextSpecialties,
    });
  };

  return (
    <section className="rounded-2xl border border-violet-100 bg-white/85 p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-violet-900">{preset.title}</h3>
        {preset.description ? <p className="mt-1 text-xs leading-5 text-slate-600">{preset.description}</p> : null}
      </div>

      {powerLevelBlock ? (
        <div className="mb-4 rounded-2xl border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-900">{powerLevelBlock.label ?? '力量层级'}</h4>
          {powerLevelBlock.description ? (
            <p className="mt-1 text-xs leading-5 text-slate-600">{powerLevelBlock.description}</p>
          ) : null}
          <select
            className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            value={powerLevel}
            disabled={disabled}
            onChange={(event) => onChange({ ...inputs, powerLevel: event.target.value })}
          >
            {Array.isArray(powerLevelBlock.options)
              ? powerLevelBlock.options
                  .filter(isRecord)
                  .map((option: Record<string, unknown>) => {
                    const value = typeof option.value === 'string' ? option.value : '';
                    const label = typeof option.label === 'string' ? option.label : value;
                    return (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    );
                  })
              : null}
          </select>
        </div>
      ) : null}

      {coreAttributesBlock ? (
        <div
          className={`mb-4 rounded-2xl border p-4 ${
            attributeOverBudget ? 'border-rose-300 bg-rose-50/60' : 'border-slate-200'
          }`}
          data-core-attributes-budget-state={attributeOverBudget ? 'over-budget' : 'within-budget'}
        >
          <h4 className="text-sm font-semibold text-slate-900">{coreAttributesBlock.label ?? '核心属性'}</h4>
          {coreAttributesBlock.description ? (
            <p className="mt-1 text-xs leading-5 text-slate-600">{coreAttributesBlock.description}</p>
          ) : null}
          {attributePointsUsed !== null ? (
            <div
              className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
                attributeOverBudget
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              <div className="font-medium">
                属性点：{attributePointsUsed} / {attributePointsLimit ?? '无限'}
              </div>
              {attributeOverBudget && attributePointsLimit !== null ? (
                <p className="mt-1">
                  {attributeBudgetIssue ?? '属性点超出预算'}，已超出 {attributePointsUsed - attributePointsLimit} 点上限。
                </p>
              ) : (
                <p className="mt-1">当前分配已即时同步到预算统计。</p>
              )}
            </div>
          ) : null}
          <div className="mt-3 grid gap-3">
            {Array.isArray(coreAttributesBlock.fields)
              ? coreAttributesBlock.fields.filter(isRecord).map((field: Record<string, unknown>) => {
                  const fieldId = typeof field.id === 'string' ? field.id : '';
                  const label = typeof field.label === 'string' ? field.label : fieldId;
                  const description = typeof field.description === 'string' ? field.description : '';
                  const value = typeof coreAttributes[fieldId] === 'number' ? (coreAttributes[fieldId] as number) : 40;
                  return (
                    <label key={fieldId} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <span className="block text-sm font-semibold text-slate-900">{label}</span>
                      {description ? <span className="mt-1 block text-xs leading-5 text-slate-600">{description}</span> : null}
                      <input
                        type="number"
                        min={typeof coreAttributesBlock.minPerStat === 'number' ? coreAttributesBlock.minPerStat : 10}
                        max={typeof coreAttributesBlock.maxPerStat === 'number' ? coreAttributesBlock.maxPerStat : 80}
                        disabled={disabled}
                        aria-invalid={attributeOverBudget}
                        value={value}
                        onChange={(event) => updateCoreAttribute(fieldId, Number(event.target.value))}
                        className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                  );
                })
              : null}
          </div>
        </div>
      ) : null}

      {specialtiesBlock ? (
        <div
          className={`mb-4 rounded-2xl border p-4 ${
            specialtyOverBudget ? 'border-rose-300 bg-rose-50/60' : 'border-slate-200'
          }`}
        >
          <h4 className="text-sm font-semibold text-slate-900">{specialtiesBlock.label ?? '基础能力专长'}</h4>
          {specialtiesBlock.description ? (
            <p className="mt-1 text-xs leading-5 text-slate-600">{specialtiesBlock.description}</p>
          ) : null}
          {specialtyPointsUsed !== null ? (
            <div
              className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
                specialtyOverBudget
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              <div className="font-medium">
                专长点：{specialtyPointsUsed} / {specialtyPointsLimit ?? '无限'}
              </div>
              {specialtyOverBudget ? (
                <p className="mt-1">{specialtyBudgetIssue ?? '专长点超出预算'}</p>
              ) : specialtyRemainingPoints !== null ? (
                <p className="mt-1">剩余 {Math.max(0, specialtyRemainingPoints)} 点，可直接选择预算内专长。</p>
              ) : (
                <p className="mt-1">当前规则不限制专长总预算。</p>
              )}
            </div>
          ) : null}
          <div className="mt-3 space-y-4">
            {Array.isArray(specialtiesBlock.groups)
              ? specialtiesBlock.groups.filter(isRecord).map((group: Record<string, unknown>) => {
                  const groupId = typeof group.id === 'string' ? group.id : '';
                  const groupLabel = typeof group.label === 'string' ? group.label : groupId;
                  return (
                    <div key={groupId}>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{groupLabel}</div>
                      <div className="mt-2 grid gap-2">
                        {Array.isArray(group.items)
                          ? group.items.filter(isRecord).map((item: Record<string, unknown>) => {
                              const itemId = typeof item.id === 'string' ? item.id : '';
                              const label = typeof item.label === 'string' ? item.label : itemId;
                              const description = typeof item.description === 'string' ? item.description : '';
                              const cost = typeof item.cost === 'number' ? item.cost : 0;
                              const checked = selectedSpecialties.includes(itemId);
                              const disabledByBudget =
                                !checked
                                && specialtyPointsUsed !== null
                                && specialtyPointsLimit !== null
                                && specialtyPointsUsed + cost > specialtyPointsLimit;
                              return (
                                <label
                                  key={itemId}
                                  data-specialty-id={itemId}
                                  data-specialty-budget-state={disabledByBudget ? 'insufficient' : 'available'}
                                  className={`rounded-xl border px-3 py-2 text-sm ${
                                    checked
                                      ? 'border-violet-300 bg-violet-50'
                                      : disabledByBudget
                                        ? 'border-slate-200 bg-slate-100 text-slate-400'
                                        : 'border-slate-200 bg-white'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className={`font-medium ${disabledByBudget ? 'text-slate-500' : 'text-slate-900'}`}>{label}</span>
                                    <div className="flex items-center gap-2 text-xs text-slate-600">
                                      <span>{cost} 点</span>
                                      {disabledByBudget ? <span className="text-rose-600">点数不足</span> : null}
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={disabled || disabledByBudget}
                                        onChange={() => toggleSpecialty(itemId)}
                                      />
                                    </div>
                                  </div>
                                  {description ? <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p> : null}
                                </label>
                              );
                            })
                          : null}
                      </div>
                    </div>
                  );
                })
              : null}
          </div>
        </div>
      ) : null}

      {ruleNoticeBlock && ruleNoticeBlock.description ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs leading-6 text-amber-900">
          <div className="font-semibold">{ruleNoticeBlock.label ?? '规则说明'}</div>
          <p className="mt-1">{ruleNoticeBlock.description}</p>
        </div>
      ) : null}
    </section>
  );
}
