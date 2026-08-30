import type { CharacterParameterSourceKey, CharacterParameterView } from '@/lib/creator/character-parameter-view';

type CharacterParameterSectionProps = {
  view: CharacterParameterView;
  sourceKey: CharacterParameterSourceKey;
  renderMode?: 'interactive' | 'export';
  onChangeSource: (nextSourceKey: CharacterParameterSourceKey) => void;
};

const BADGE_CLASS =
  'inline-flex items-center rounded-full border border-white/25 bg-white/[0.12] px-2.5 py-1 text-[11px] font-semibold text-white/90';

const TOGGLE_BASE_CLASS =
  'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition';

export function CharacterParameterSection({
  view,
  sourceKey,
  renderMode = 'interactive',
  onChangeSource,
}: CharacterParameterSectionProps) {
  const activeSource =
    view.sources.find((source) => source.key === sourceKey)
    ?? view.sources.find((source) => source.key === view.activeSource)
    ?? view.sources[0];

  if (!activeSource) return null;

  const shouldShowToggle = renderMode === 'interactive' && view.sources.length > 1;

  return (
    <div className="result-item" data-character-parameter-section="root">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="result-label mb-0">角色参数</div>
        {shouldShowToggle ? (
          <div className="flex items-center gap-2">
            {view.sources.map((source) => {
              const isActive = source.key === activeSource.key;
              return (
                <button
                  key={source.key}
                  type="button"
                  data-character-parameter-toggle={source.key}
                  onClick={() => onChangeSource(source.key)}
                  className={`${TOGGLE_BASE_CLASS} ${
                    isActive
                      ? 'border-white/40 bg-white/[0.22] text-white'
                      : 'border-white/18 bg-transparent text-white/[0.72] hover:border-white/[0.28] hover:text-white/[0.88]'
                  }`}
                >
                  {source.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className={BADGE_CLASS}>角色参数 · {activeSource.label}</div>
        )}
      </div>

      <div className="result-value mt-3 space-y-4 text-sm">
        {activeSource.rules.map((rule) => (
          <div
            key={`${activeSource.key}-${rule.ruleId}`}
            className="rounded-xl border border-white/14 bg-black/10 p-3"
            data-character-parameter-rule={rule.ruleId}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-white">{rule.title}</div>
              <div className="text-[11px] text-white/[0.65]">v{rule.version}</div>
            </div>

            <div className="mt-3 space-y-3">
              {rule.sections.map((section) => (
                <div key={section.key}>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/[0.72]">
                    {section.title}
                  </div>
                  {section.note ? (
                    <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-white/80">
                      {section.note}
                    </div>
                  ) : null}
                  {section.entries.length > 0 ? (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {section.entries.map((entry) => (
                        <div
                          key={entry.key}
                          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2"
                        >
                          <div className="text-[11px] text-white/[0.62]">{entry.label}</div>
                          <div className="mt-1 break-words text-sm text-white">{entry.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                rule.valid
                  ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-50'
                  : 'border-rose-300/30 bg-rose-400/10 text-rose-50'
              }`}
            >
              <div className="font-semibold">{rule.statusLabel}</div>
              {rule.issues.length > 0 ? (
                <ul className="mt-1 list-disc pl-4">
                  {rule.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
