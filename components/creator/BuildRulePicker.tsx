import type { BuildRulePresetIndex } from '@/lib/creator/types';

type BuildRulePickerProps = {
  presets: BuildRulePresetIndex;
  selectedRuleIds: string[];
  primaryRuleId: string | null;
  onToggleRule: (ruleId: string) => void;
  onSelectPrimaryRule: (ruleId: string) => void;
  disabled?: boolean;
};

export function BuildRulePicker({
  presets,
  selectedRuleIds,
  primaryRuleId,
  onToggleRule,
  onSelectPrimaryRule,
  disabled = false,
}: BuildRulePickerProps) {
  return (
    <section className="rounded-2xl border border-violet-100 bg-white/85 p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-violet-900">车卡规则</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          规则块用于承载点数、预算、专长和派生值等结构化事实。第一阶段支持多规则框架，但先以内置预设为主。
        </p>
      </div>
      <div className="space-y-3">
        {presets.map((preset) => {
          const isSelected = selectedRuleIds.includes(preset.id);
          const isPrimary = primaryRuleId === preset.id;
          return (
            <div
              key={preset.id}
              className={`rounded-2xl border px-4 py-3 ${
                isSelected ? 'border-violet-300 bg-violet-50/70' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{preset.title}</div>
                  {preset.description ? (
                    <p className="mt-1 text-xs leading-5 text-slate-600">{preset.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleRule(preset.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    isSelected ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700'
                  } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {isSelected ? '已启用' : '启用规则'}
                </button>
              </div>
              {isSelected ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                  <span className="font-medium text-violet-700">主规则</span>
                  <input
                    type="radio"
                    checked={isPrimary}
                    disabled={disabled}
                    onChange={() => onSelectPrimaryRule(preset.id)}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
