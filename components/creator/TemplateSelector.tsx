import { CREATOR_TEMPLATE_OPTIONS, isCreatorStreamTemplate, type CreatorTemplateId } from '@/lib/creator/templates';
import {
  CREATOR_PANEL_SURFACE_CLASS,
  CREATOR_SUBPANEL_ACTIVE_CLASS,
  CREATOR_SUBPANEL_SURFACE_CLASS,
  joinCreatorClassNames,
} from '@/components/creator/surfaceStyles';

type TemplateSelectorProps = {
  value: CreatorTemplateId;
  onChange: (nextValue: CreatorTemplateId) => void;
  disabled?: boolean;
};

export function TemplateSelector({ value, onChange, disabled = false }: TemplateSelectorProps) {
  return (
    <section
      data-creator-surface="panel"
      className={CREATOR_PANEL_SURFACE_CLASS}
    >
      <div className="mb-3">
        <h3 className="text-base font-semibold text-sky-900">输出模板</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          先决定本次要生成哪种卡片。模板决定结果结构，也决定是否支持流式输出。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {CREATOR_TEMPLATE_OPTIONS.map((option) => {
          const isActive = option.id === value;
          const isStreamable = isCreatorStreamTemplate(option.id);
          return (
            <button
              key={option.id}
              type="button"
              data-creator-surface="subpanel"
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={joinCreatorClassNames(
                isActive ? CREATOR_SUBPANEL_ACTIVE_CLASS : CREATOR_SUBPANEL_SURFACE_CLASS,
                isActive ? 'border-sky-400' : 'hover:border-sky-300 hover:bg-[var(--app-surface-95)]',
                'px-4 py-3 text-left transition',
                disabled && 'cursor-not-allowed opacity-60'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">{option.label}</span>
                <span
                  className={joinCreatorClassNames(
                    'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                    isStreamable
                      ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                      : 'border-[var(--app-border)] bg-[var(--app-surface-70)] text-[color:var(--app-text-subtle)]'
                  )}
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
