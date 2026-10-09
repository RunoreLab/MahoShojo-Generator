import { useEffect, useState, type ReactNode } from 'react';
export type TavernTab = 'import' | 'export';
/** Existing page tabs, with per-instance IDs and keyboard navigation. */
export function TavernTabs({ tab, onChange, disabled, idPrefix }: { tab: TavernTab; onChange: (tab: TavernTab) => void; disabled?: boolean; idPrefix: string }) {
  return <div role="tablist" aria-label="酒馆操作" className="grid grid-cols-2 gap-2">{(['import', 'export'] as const).map((value) => <button
    key={value} id={`${idPrefix}-${value}-tab`} role="tab" aria-selected={tab === value} aria-controls={`${idPrefix}-${value}-panel`} tabIndex={tab === value ? 0 : -1}
    type="button" disabled={disabled}
    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${tab === value ? 'border-pink-300 bg-pink-100 text-pink-800' : 'border-pink-100 bg-white/70 text-gray-700 hover:bg-pink-50'}`}
    onKeyDown={(event) => {
      if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'import' : event.key === 'End' ? 'export' : value === 'import' ? 'export' : 'import';
      onChange(next); document.getElementById(`${idPrefix}-${next}-tab`)?.focus();
    }} onClick={() => onChange(value)}>{value === 'import' ? '导入' : '导出'}</button>)}</div>;
}

/** Visit lazily, then retain page-local drafts. Hidden panels never enter keyboard focus order. */
export function TavernTabPanels({ tab, idPrefix, importPanel, exportPanel }: { tab: TavernTab; idPrefix: string; importPanel: ReactNode; exportPanel: ReactNode }) {
  const [visited, setVisited] = useState({ import: tab === 'import', export: tab === 'export' });
  useEffect(() => { setVisited((previous) => previous[tab] ? previous : { ...previous, [tab]: true }); }, [tab]);
  return <>{(['import', 'export'] as const).map((value) => <div key={value} id={`${idPrefix}-${value}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-${value}-tab`} hidden={tab !== value}>
    {tab === value || visited[value] ? value === 'import' ? importPanel : exportPanel : null}
  </div>)}</>;
}
