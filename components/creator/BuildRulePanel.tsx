import type { BuildRuleRuntimeResult } from '@/lib/creator/build-rule-runtime';
import { normalizeBuildRuleBlockKey } from '@/lib/creator/build-rules';
import type { BuildRulePreset } from '@/lib/creator/types';

const CORE_ATTRIBUTE_KEYS = [
  'STR',
  'CON',
  'AGI',
  'MAG',
  'WILL',
  'PER',
  'CHM',
] as const;

const POWER_LEVEL_OPTIONS = [
  { value: 'seed', label: 'Seed' },
  { value: 'bloom', label: 'Bloom' },
  { value: 'nova', label: 'Nova' },
] as const;

const SPECIALTY_OPTIONS = [
  'magic-burst',
  'warding',
  'mobility',
  'support',
] as const;

type BuildRulePanelProps = {
  preset: BuildRulePreset;
  value: Record<string, unknown>;
  runtimeResult?: BuildRuleRuntimeResult | null;
  onChange: (nextValue: Record<string, unknown>) => void;
};

const readRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

export function BuildRulePanel({
  preset,
  value,
  runtimeResult,
  onChange,
}: BuildRulePanelProps) {
  const updateField = (fieldKey: string, nextValue: unknown) => {
    onChange({
      ...value,
      [fieldKey]: nextValue,
    });
  };

  return (
    <section className="rounded-3xl border border-pink-200 bg-white/90 p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          规则输入 · {preset.title ?? preset.id}
        </h3>
        {preset.aiPromptHint ? (
          <p className="mt-2 text-sm leading-6 text-gray-600">
            AI 提示：{preset.aiPromptHint}
          </p>
        ) : null}
      </div>

      <div className="space-y-5">
        {preset.blocks.map((block) => {
          const logicalKey = normalizeBuildRuleBlockKey(block.id);

          if (block.type === 'section') {
            return (
              <div
                key={block.id}
                className="rounded-2xl border border-dashed border-pink-200 bg-pink-50/60 p-4 text-sm text-gray-600"
              >
                <div className="font-medium text-gray-900">{block.label ?? logicalKey}</div>
                {block.description ? (
                  <p className="mt-2 leading-6">{block.description}</p>
                ) : null}
              </div>
            );
          }

          if (block.type === 'select' && logicalKey === 'powerLevel') {
            const currentValue =
              typeof value.powerLevel === 'string' ? value.powerLevel : 'seed';
            return (
              <div key={block.id} className="space-y-2">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {block.label ?? 'Power Level'}
                  </div>
                  {block.description ? (
                    <p className="text-sm text-gray-500">{block.description}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {POWER_LEVEL_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateField('powerLevel', option.value)}
                      className={[
                        'rounded-full border px-3 py-1.5 text-sm transition-colors',
                        currentValue === option.value
                          ? 'border-pink-400 bg-pink-500 text-white'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-pink-300',
                      ].join(' ')}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          if (block.type === 'point-buy' && logicalKey === 'coreAttributes') {
            const attributes = readRecord(value.coreAttributes);
            return (
              <div key={block.id} className="space-y-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {block.label ?? '核心属性'}
                  </div>
                  {block.description ? (
                    <p className="text-sm text-gray-500">{block.description}</p>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {CORE_ATTRIBUTE_KEYS.map((attributeKey) => (
                    <label
                      key={attributeKey}
                      className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3"
                    >
                      <div className="text-xs font-semibold text-gray-500">
                        {attributeKey}
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={readNumber(attributes[attributeKey], 10)}
                        onChange={(event) => {
                          const nextAttributes = {
                            ...attributes,
                            [attributeKey]: Number(event.target.value || 0),
                          };
                          updateField('coreAttributes', nextAttributes);
                        }}
                        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          }

          if (block.type === 'multi-select' && logicalKey === 'specialties') {
            const selectedValues = new Set(readStringArray(value.specialties));
            return (
              <div key={block.id} className="space-y-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {block.label ?? '专精'}
                  </div>
                  {block.description ? (
                    <p className="text-sm text-gray-500">{block.description}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {SPECIALTY_OPTIONS.map((option) => {
                    const checked = selectedValues.has(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          const nextValues = checked
                            ? [...selectedValues].filter((value) => value !== option)
                            : [...selectedValues, option];
                          updateField('specialties', nextValues);
                        }}
                        className={[
                          'rounded-full border px-3 py-1.5 text-sm transition-colors',
                          checked
                            ? 'border-cyan-500 bg-cyan-500 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-cyan-300',
                        ].join(' ')}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }

          if (block.type === 'derived') {
            const entries = Object.entries(runtimeResult?.derived ?? {});
            return (
              <div
                key={block.id}
                className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4"
              >
                <div className="text-sm font-medium text-gray-900">
                  {block.label ?? '派生值'}
                </div>
                {block.description ? (
                  <p className="mt-1 text-sm text-gray-500">{block.description}</p>
                ) : null}
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {entries.length > 0 ? (
                    entries.map(([key, rawValue]) => (
                      <div
                        key={key}
                        className="rounded-2xl bg-white px-3 py-3 text-center shadow-sm"
                      >
                        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400">
                          {key}
                        </div>
                        <div className="mt-1 text-lg font-semibold text-cyan-700">
                          {String(rawValue)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-gray-500">暂无派生值</div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={block.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-900">
                {block.label ?? logicalKey}
              </div>
              {block.description ? (
                <p className="mt-1 text-sm text-gray-500">{block.description}</p>
              ) : null}
              <div className="mt-3 rounded-2xl bg-gray-50 px-3 py-3 text-sm text-gray-500">
                该 block 类型暂未定义专用编辑器，将作为只读占位显示。
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
