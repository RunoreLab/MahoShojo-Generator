import type { ReactNode } from 'react';

/**
 * 设置页的受控展示原语（DESK-SET-001：复用显式组件和受控 props，
 * 不建动态 schema 表单引擎）。
 *
 * 样式走共享 `--app-*` token + Tailwind 任意值写法——两端同一套观感，
 * 不需要每端各写一份主题（与 DetailsSavePreferencesPanel 的 app-token
 * 主题同一来源）。
 */

export const SettingsCard = ({
  title,
  description,
  children,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 标题行右侧的动作区（如「重置」按钮）。 */
  actions?: ReactNode;
}) => (
  <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-medium text-(--app-text)">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-(--app-text-subtle)">{description}</p>
        ) : null}
      </div>
      {actions}
    </div>
    {children ? <div className="mt-3">{children}</div> : null}
  </section>
);

/** 字段行：左侧标签与说明，右侧控件。窄屏时控件落回标签下方。 */
export const SettingsFieldRow = ({
  label,
  description,
  control,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
}) => (
  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
    <div className="min-w-0">
      <div className="text-sm text-(--app-text)">{label}</div>
      {description ? (
        <div className="mt-0.5 text-xs text-(--app-text-subtle)">{description}</div>
      ) : null}
    </div>
    <div className="shrink-0">{control}</div>
  </div>
);

/** 分段选项按钮组——受控，宿主决定每个值的语义。 */
export const SettingsOptionButtons = <T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) => (
  <div className="flex gap-1 rounded-lg border border-(--app-border) p-1" role="group" aria-label={ariaLabel}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={option.value === value}
        onClick={() => onChange(option.value)}
        className={
          option.value === value
            ? 'rounded-md bg-(--app-accent-strong) px-3 py-1.5 text-xs font-medium text-white shadow-sm'
            : 'rounded-md px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition hover:text-(--app-accent-strong)'
        }
      >
        {option.label}
      </button>
    ))}
  </div>
);

/** 开/关切换——受控复选框语义，不使用原生 checkbox 以便统一样式。 */
export const SettingsToggle = ({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${
      checked ? 'bg-(--app-accent-strong)' : 'bg-(--app-border)'
    }`}
  >
    <span
      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-5.5' : 'translate-x-0.5'
      }`}
    />
  </button>
);
