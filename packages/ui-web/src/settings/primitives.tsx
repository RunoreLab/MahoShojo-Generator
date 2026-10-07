import type { KeyboardEvent, ReactNode } from 'react';

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

/**
 * 分段选项组——互斥单选，按 WAI-ARIA `radiogroup` 语义实现：
 * 组内只有一个 Tab 停留点（roving tabindex），方向键与 Home/End
 * 移动并选中，键盘模型与原生 radio 一致（按钮语义做不到这一点）。
 */
export const SettingsOptionButtons = <T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) => {
  const selectedIndex = options.findIndex((option) => option.value === value);
  // 无匹配值时第一项仍可 Tab 进入——roving tabindex 要求组内恰有一个停留点。
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const moveSelection = (fromIndex: number, event: KeyboardEvent<HTMLButtonElement>): void => {
    const count = options.length;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (fromIndex + 1) % count;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (fromIndex - 1 + count) % count;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = count - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    onChange(options[nextIndex]!.value);
    const target = event.currentTarget.parentElement?.children[nextIndex];
    if (target instanceof HTMLElement) target.focus();
  };

  return (
    <div className="flex gap-1 rounded-lg border border-(--app-border) p-1" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabbableIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => moveSelection(index, event)}
            className={`ui-web-settings-motion rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50 ${
              selected
                ? 'bg-(--app-accent-strong) text-white shadow-sm'
                : 'text-(--app-text-muted) enabled:hover:text-(--app-accent-strong)'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

/**
 * 开/关切换——受控开关（ARIA switch 语义），不使用原生 checkbox 以便统一样式。
 * 滑块必须显式声明水平定位：`<button>` 的 UA `text-align:center` 会把缺省
 * `left` 的绝对定位子元素静态位置推到中间，translate 之后滑块右移出轨道。
 * 关态轨道用专用 `--app-switch-track` token——`--app-border` 在亮色主题
 * 下是近透明的白色描边，当轨道底色几乎不可见；滑块同理用
 * `--app-switch-thumb`，避开全局 `.bg-white` 暗色重写被改深的问题。
 */
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
    className={`ui-web-settings-motion relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50 ${
      checked ? 'bg-(--app-accent-strong)' : 'bg-(--app-switch-track)'
    }`}
  >
    <span
      aria-hidden="true"
      className={`ui-web-settings-motion pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-(--app-switch-thumb) shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);
