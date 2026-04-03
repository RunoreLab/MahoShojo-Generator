import type { BuildRulePreset, BuildRuleRuntimeResult } from '@/lib/creator/types';
import {
  CREATOR_INPUT_CLASS,
  CREATOR_PANEL_SURFACE_CLASS,
  CREATOR_SUBPANEL_SURFACE_CLASS,
  joinCreatorClassNames,
} from '@/components/creator/surfaceStyles';

type BuildRulePanelProps = {
  preset: BuildRulePreset;
  inputs: Record<string, unknown>;
  runtimeResult?: BuildRuleRuntimeResult | null;
  onChange: (nextInputs: Record<string, unknown>) => void;
  disabled?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getStringArrayValue = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const getNumberGroupValue = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const getNumericDefaultValue = (block: Record<string, unknown>, field: Record<string, unknown>): number => {
  if (typeof field.defaultValue === 'number' && Number.isFinite(field.defaultValue)) {
    return Math.trunc(field.defaultValue);
  }
  return block.type === 'point-buy' ? 40 : 0;
};

export function BuildRulePanel({
  preset,
  inputs,
  runtimeResult = null,
  onChange,
  disabled = false,
}: BuildRulePanelProps) {
  const blocks = Array.isArray(preset.blocks) ? preset.blocks.filter(isRecord) : [];
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
  const specialtyRemainingPoints =
    specialtyPointsUsed !== null && specialtyPointsLimit !== null
      ? specialtyPointsLimit - specialtyPointsUsed
      : null;

  const updateGroupField = (blockId: string, fieldId: string, nextValue: number) => {
    const currentGroup = getNumberGroupValue(inputs[blockId]);
    onChange({
      ...inputs,
      [blockId]: {
        ...currentGroup,
        [fieldId]: nextValue,
      },
    });
  };

  const updateSelectField = (blockId: string, nextValue: string) => {
    onChange({
      ...inputs,
      [blockId]: nextValue,
    });
  };

  const toggleMultiSelectItem = (
    blockId: string,
    itemId: string,
    itemCost: number,
    budgeted: boolean
  ) => {
    const currentItems = getStringArrayValue(inputs[blockId]);
    const checked = currentItems.includes(itemId);
    const wouldExceedBudget =
      budgeted
      && !checked
      && specialtyPointsUsed !== null
      && specialtyPointsLimit !== null
      && specialtyPointsUsed + itemCost > specialtyPointsLimit;

    if (wouldExceedBudget) {
      return;
    }

    onChange({
      ...inputs,
      [blockId]: checked ? currentItems.filter((item) => item !== itemId) : [...currentItems, itemId],
    });
  };

  const renderSelectBlock = (block: Record<string, unknown>) => {
    const blockId = typeof block.id === 'string' ? block.id : '';
    const blockLabel = typeof block.label === 'string' ? block.label : blockId;
    const options = Array.isArray(block.options) ? block.options.filter(isRecord) : [];
    const fallbackValue =
      typeof block.defaultValue === 'string'
        ? block.defaultValue
        : (typeof options[0]?.value === 'string' ? options[0].value : '');
    const value = typeof inputs[blockId] === 'string' ? inputs[blockId] as string : fallbackValue;

    return (
      <div
        key={blockId}
        data-creator-surface="subpanel"
        className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'mb-4 p-4')}
      >
        <h4 className="text-sm font-semibold text-slate-900">{blockLabel}</h4>
        {typeof block.description === 'string' ? (
          <p className="mt-1 text-xs leading-5 text-slate-600">{block.description}</p>
        ) : null}
        <select
          data-creator-control="field"
          className={joinCreatorClassNames(CREATOR_INPUT_CLASS, 'mt-3')}
          value={value}
          disabled={disabled}
          onChange={(event) => updateSelectField(blockId, event.target.value)}
        >
          {options.map((option) => {
            const optionValue = typeof option.value === 'string' ? option.value : '';
            const optionLabel = typeof option.label === 'string' ? option.label : optionValue;
            return (
              <option key={optionValue} value={optionValue}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      </div>
    );
  };

  const renderNumericBlock = (block: Record<string, unknown>) => {
    const blockId = typeof block.id === 'string' ? block.id : '';
    const blockLabel = typeof block.label === 'string' ? block.label : blockId;
    const fields = Array.isArray(block.fields) ? block.fields.filter(isRecord) : [];
    const groupValue = getNumberGroupValue(inputs[blockId]);
    const isArenaPointBuy = block.type === 'point-buy' && blockId === 'coreAttributes';

    return (
      <div
        key={blockId}
        data-creator-surface="subpanel"
        className={`mb-4 rounded-2xl border p-4 ${
          isArenaPointBuy && attributeOverBudget
            ? 'border-rose-300 bg-rose-50/60'
            : 'border-[var(--app-border)] bg-[var(--app-surface-80)]'
        }`}
        data-core-attributes-budget-state={isArenaPointBuy ? (attributeOverBudget ? 'over-budget' : 'within-budget') : undefined}
      >
        <h4 className="text-sm font-semibold text-slate-900">{blockLabel}</h4>
        {typeof block.description === 'string' ? (
          <p className="mt-1 text-xs leading-5 text-slate-600">{block.description}</p>
        ) : null}
        {isArenaPointBuy && attributePointsUsed !== null ? (
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
        <div className={`mt-3 grid gap-3 ${block.type === 'number-group' ? 'md:grid-cols-2' : ''}`}>
          {fields.map((field) => {
            const fieldId = typeof field.id === 'string' ? field.id : '';
            const label = typeof field.label === 'string' ? field.label : fieldId;
            const description = typeof field.description === 'string' ? field.description : '';
            const defaultValue = getNumericDefaultValue(block, field);
            const value = typeof groupValue[fieldId] === 'number' ? groupValue[fieldId] as number : defaultValue;
            const min =
              block.type === 'point-buy'
                ? (typeof block.minPerStat === 'number' ? block.minPerStat : 10)
                : (typeof field.min === 'number' ? field.min : undefined);
            const max =
              block.type === 'point-buy'
                ? (typeof block.maxPerStat === 'number' ? block.maxPerStat : 80)
                : (typeof field.max === 'number' ? field.max : undefined);

            return (
              <label
                key={fieldId}
                data-creator-surface="subpanel"
                className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'p-3')}
              >
                <span className="block text-sm font-semibold text-slate-900">{label}</span>
                {description ? <span className="mt-1 block text-xs leading-5 text-slate-600">{description}</span> : null}
                <input
                  data-creator-control="field"
                  type="number"
                  min={min}
                  max={max}
                  disabled={disabled}
                  aria-invalid={isArenaPointBuy ? attributeOverBudget : undefined}
                  value={value}
                  onChange={(event) => updateGroupField(blockId, fieldId, Number(event.target.value))}
                  className={joinCreatorClassNames(CREATOR_INPUT_CLASS, 'mt-3')}
                />
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMultiSelectBlock = (block: Record<string, unknown>) => {
    const blockId = typeof block.id === 'string' ? block.id : '';
    const blockLabel = typeof block.label === 'string' ? block.label : blockId;
    const selectedItems = getStringArrayValue(inputs[blockId]);
    const isBudgetedSpecialties = blockId === 'specialties';
    const groups = Array.isArray(block.groups) ? block.groups.filter(isRecord) : [];

    return (
      <div
        key={blockId}
        data-creator-surface="subpanel"
        className={`mb-4 rounded-2xl border p-4 ${
          isBudgetedSpecialties && specialtyOverBudget
            ? 'border-rose-300 bg-rose-50/60'
            : 'border-[var(--app-border)] bg-[var(--app-surface-80)]'
        }`}
      >
        <h4 className="text-sm font-semibold text-slate-900">{blockLabel}</h4>
        {typeof block.description === 'string' ? (
          <p className="mt-1 text-xs leading-5 text-slate-600">{block.description}</p>
        ) : null}
        {isBudgetedSpecialties && specialtyPointsUsed !== null ? (
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
          {groups.map((group) => {
            const groupId = typeof group.id === 'string' ? group.id : '';
            const groupLabel = typeof group.label === 'string' ? group.label : groupId;
            const items = Array.isArray(group.items) ? group.items.filter(isRecord) : [];

            return (
              <div key={groupId}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{groupLabel}</div>
                <div className="mt-2 grid gap-2">
                  {items.map((item) => {
                    const itemId = typeof item.id === 'string' ? item.id : '';
                    const label = typeof item.label === 'string' ? item.label : itemId;
                    const description = typeof item.description === 'string' ? item.description : '';
                    const cost = typeof item.cost === 'number' ? item.cost : 0;
                    const checked = selectedItems.includes(itemId);
                    const disabledByBudget =
                      isBudgetedSpecialties
                      && !checked
                      && specialtyPointsUsed !== null
                      && specialtyPointsLimit !== null
                      && specialtyPointsUsed + cost > specialtyPointsLimit;

                    return (
                      <label
                        key={itemId}
                        data-creator-surface="subpanel"
                        data-specialty-id={isBudgetedSpecialties ? itemId : undefined}
                        data-specialty-budget-state={isBudgetedSpecialties ? (disabledByBudget ? 'insufficient' : 'available') : undefined}
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          checked
                            ? 'border-violet-300 bg-[var(--app-surface-80)] ring-1 ring-violet-400/25'
                            : disabledByBudget
                              ? 'border-[var(--app-border)] bg-[var(--app-surface-70)] text-slate-400'
                              : 'border-[var(--app-border)] bg-[var(--app-surface-95)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className={`font-medium ${disabledByBudget ? 'text-slate-500' : 'text-slate-900'}`}>{label}</span>
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            {isBudgetedSpecialties ? <span>{cost} 点</span> : null}
                            {disabledByBudget ? <span className="text-rose-600">点数不足</span> : null}
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled || disabledByBudget}
                              onChange={() => toggleMultiSelectItem(blockId, itemId, cost, isBudgetedSpecialties)}
                            />
                          </div>
                        </div>
                        {description ? <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p> : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSectionBlock = (block: Record<string, unknown>) => {
    if (typeof block.description !== 'string') return null;
    return (
      <div key={typeof block.id === 'string' ? block.id : 'section'} className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs leading-6 text-amber-900">
        <div className="font-semibold">{typeof block.label === 'string' ? block.label : '规则说明'}</div>
        <p className="mt-1">{block.description}</p>
      </div>
    );
  };

  return (
    <section
      data-creator-surface="panel"
      className={CREATOR_PANEL_SURFACE_CLASS}
    >
      <div className="mb-4">
        <h3 className="text-base font-semibold text-violet-900">{preset.title}</h3>
        {preset.description ? <p className="mt-1 text-xs leading-5 text-slate-600">{preset.description}</p> : null}
      </div>

      {blocks.map((block) => {
        switch (block.type) {
          case 'select':
            return renderSelectBlock(block);
          case 'point-buy':
          case 'stat-array':
          case 'number-group':
            return renderNumericBlock(block);
          case 'multi-select':
            return renderMultiSelectBlock(block);
          case 'section':
            return renderSectionBlock(block);
          default:
            return null;
        }
      })}
    </section>
  );
}
