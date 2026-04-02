import type { CreatorTemplateId } from '@/lib/creator/templates';
import type { BuildRulePreset } from '@/lib/creator/types';

interface BuildRulePickerProps {
  template: CreatorTemplateId;
  presets: readonly BuildRulePreset[];
  selectedRuleIds: readonly string[];
  primaryRuleId: string | null;
  onToggleRule: (ruleId: string, nextSelected: boolean) => void;
  onSelectPrimary: (ruleId: string) => void;
}

export function BuildRulePicker({
  template,
  presets,
  selectedRuleIds,
  primaryRuleId,
  onToggleRule,
  onSelectPrimary,
}: BuildRulePickerProps) {
  return (
    <section className="input-group">
      <label className="input-label">车卡规则</label>
      <div className="space-y-3">
        {presets.map((preset) => {
          const selected = selectedRuleIds.includes(preset.id);
          const templateSupported = preset.supportedTemplates.includes(template);
          const canBePrimary = selected && templateSupported && preset.mainRuleEligible;

          return (
            <div
              key={preset.id}
              className={[
                'rounded-2xl border p-4 transition-colors',
                selected
                  ? 'border-pink-300 bg-pink-50/80'
                  : 'border-gray-200 bg-white',
              ].join(' ')}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-gray-900">
                      {preset.title ?? preset.id}
                    </h3>
                    <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] text-gray-500">
                      {preset.version}
                    </span>
                    <span
                      className={[
                        'rounded-full px-2 py-1 text-[11px] font-medium',
                        templateSupported
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700',
                      ].join(' ')}
                    >
                      {templateSupported ? '兼容当前模板' : '当前模板不可用'}
                    </span>
                  </div>
                  {preset.uiSummary ? (
                    <p className="mt-2 text-sm leading-6 text-gray-600">
                      {preset.uiSummary}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-gray-500">
                    投影方式：{preset.projectionPolicy} ·
                    {preset.allowStandalone ? ' 可独立使用' : ' 需要至少一套问卷'} ·
                    {preset.mainRuleEligible ? ' 可设为主规则' : ' 仅参考规则'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 lg:w-[220px]">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!templateSupported}
                      onChange={(event) =>
                        onToggleRule(preset.id, event.target.checked)
                      }
                    />
                    <span>启用此规则</span>
                  </label>
                  <label
                    className={[
                      'flex items-center gap-2 text-sm',
                      canBePrimary ? 'text-gray-700' : 'text-gray-400',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="creator-primary-rule"
                      checked={primaryRuleId === preset.id}
                      disabled={!canBePrimary}
                      onChange={() => onSelectPrimary(preset.id)}
                    />
                    <span>设为主规则</span>
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
