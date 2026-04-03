export const joinCreatorClassNames = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(' ');

export const CREATOR_PANEL_SURFACE_CLASS = joinCreatorClassNames(
  'rounded-2xl border border-[var(--app-border-strong)] bg-[var(--app-surface-90)] p-4 shadow-sm'
);

export const CREATOR_SUBPANEL_SURFACE_CLASS = joinCreatorClassNames(
  'rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-80)]'
);

export const CREATOR_SUBPANEL_ACTIVE_CLASS = joinCreatorClassNames(
  CREATOR_SUBPANEL_SURFACE_CLASS,
  'ring-1 ring-violet-400/25'
);

export const CREATOR_INPUT_CLASS = joinCreatorClassNames(
  'w-full rounded-xl border border-[var(--app-input-border)] bg-[var(--app-input-bg)]',
  'px-3 py-2 text-sm text-[color:var(--app-text)] outline-none transition',
  'placeholder:text-[color:var(--app-text-subtle)]'
);
