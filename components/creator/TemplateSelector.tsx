import { CREATOR_TEMPLATE_OPTIONS, isCreatorStreamTemplate, type CreatorTemplateId } from '@/lib/creator/templates';

type TemplateSelectorProps = {
  value: CreatorTemplateId;
  onChange: (nextValue: CreatorTemplateId) => void;
  disabled?: boolean;
};

export function TemplateSelector({ value, onChange, disabled = false }: TemplateSelectorProps) {
  return (
    <section className="rounded-2xl border border-sky-100 bg-white/85 p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-sky-900">输出模板</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          先决定本次要生成哪种卡片。模板决定结果结构，也决定是否支持流式输出。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {CREATOR_TEMPLATE_OPTIONS.map((option) => {
          const isActive = option.id === value;
          const isStreamable = isCreatorStreamTemplate(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                isActive
                  ? 'border-sky-500 bg-sky-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/50'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">{option.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    isStreamable ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {isStreamable ? '支持流式' : '仅非流式'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{option.description}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
