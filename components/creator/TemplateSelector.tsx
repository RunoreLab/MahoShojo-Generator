import type { CreatorTemplateId } from '@/lib/creator/templates';

export interface CreatorTemplateOption {
  id: CreatorTemplateId;
  label: string;
  description: string;
  streamable?: boolean;
}

interface TemplateSelectorProps {
  options: readonly CreatorTemplateOption[];
  value: CreatorTemplateId;
  onChange: (templateId: CreatorTemplateId) => void;
}

export function TemplateSelector({
  options,
  value,
  onChange,
}: TemplateSelectorProps) {
  return (
    <section className="input-group">
      <label className="input-label">输出模板</label>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={[
                'rounded-2xl border px-4 py-4 text-left transition-all',
                selected
                  ? 'border-pink-400 bg-pink-50 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-pink-200 hover:bg-pink-50/60',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-semibold text-gray-900">
                  {option.label}
                </span>
                <span
                  className={[
                    'rounded-full px-2 py-1 text-[11px] font-medium',
                    option.streamable
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-600',
                  ].join(' ')}
                >
                  {option.streamable ? '支持流式' : '仅非流式'}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                {option.description}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
