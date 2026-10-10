'use client';

import { useState, type ReactNode } from 'react';
import { FileText, PanelsTopLeft } from 'lucide-react';
import type { WebPackageRiskProfile } from '@mahoshojo/web-package/security';
import { SegmentedControl, type SegmentedOption } from '../details-controls/SegmentedControl';
import { WebPackageRiskSummary } from './WebPackageRiskSummary';
import { WEB_REPORT_SURFACE_BACKGROUND } from './report-surface';

const FORMAT_OPTIONS: readonly SegmentedOption<'markdown' | 'web'>[] = [
  { value: 'markdown', label: 'Markdown', icon: <FileText />, description: '以正文为主的战报，支持标题、表格与公式，适合阅读和保存图片。' },
  { value: 'web', label: 'Web（实验性）', icon: <PanelsTopLeft />, description: '生成带自定义排版、动画或交互的网页；生成与运行分别控制，运行时可能加载第三方资源。' },
];

export type ArenaReportFormatSelectorViewProps = Readonly<{
  value: 'markdown' | 'web';
  onChange(format: 'markdown' | 'web'): void;
  disabled?: boolean;
  children?: ReactNode;
  /** Web host keeps its existing consent wording and policy. This view never grants execution. */
  webDescription?: string;
}>;

export function ArenaReportFormatSelectorView({ value, onChange, disabled, children, webDescription }: ArenaReportFormatSelectorViewProps) {
  const options = webDescription ? FORMAT_OPTIONS.map((option) => option.value === 'web' ? { ...option, description: webDescription } : option) : FORMAT_OPTIONS;
  return <div className="input-group">
    <SegmentedControl label="战报格式" value={value} options={options} disabled={disabled} onChange={onChange} />
    {value === 'web' && children ? <div className="mt-3 text-sm">{children}</div> : null}
  </div>;
}

export type ArenaWebNotesProps = Readonly<{
  prelude: string;
  epilogue: string;
  /** Missing renderer is escaped text. A Markdown host must own media/navigation policy. */
  renderNote?(content: string): ReactNode;
}>;

export function ArenaWebNotes({ prelude, epilogue, renderNote }: ArenaWebNotesProps) {
  const [expanded, setExpanded] = useState(false);
  const notes = [prelude ? { label: '前言', content: prelude } : null, epilogue ? { label: '后记', content: epilogue } : null]
    .filter((note): note is { label: string; content: string } => note !== null);
  if (notes.length === 0) return null;
  return <section className="rounded-lg border border-white/10 bg-black/20 text-white/90" data-testid="arena-web-notes">
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <span>💬 AI 附言（{notes.length} 段）</span>
      <span aria-hidden="true" className="text-white/60">{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded ? <div className="space-y-3 border-t border-white/10 px-3 py-3">{notes.map((note) => <div key={note.label}>
      <div className="mb-1 text-xs font-semibold tracking-wide text-white/60">AI {note.label}</div>
      {renderNote ? renderNote(note.content) : <pre className="whitespace-pre-wrap break-words text-sm">{note.content}</pre>}
    </div>)}</div> : null}
  </section>;
}

export function ArenaWebSourceView({ source, label = 'Web 战报源码（安全文本）' }: Readonly<{ source: string; label?: string }>) {
  return <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 text-sm" aria-label={label}>{source}</pre>;
}

export type ArenaWebReportAction = Readonly<{
  id: string;
  label: string;
  onClick(): void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}>;

/** The host owns synchronous locks, scope fencing, errors and every download/save/run effect. */
export function ArenaWebReportActions({ actions }: Readonly<{ actions: readonly ArenaWebReportAction[] }>) {
  return <>{actions.map((action) => <button key={action.id} type="button" disabled={action.disabled} onClick={action.onClick} title={action.title} aria-label={action.ariaLabel}
    className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all disabled:cursor-not-allowed disabled:opacity-60">
    {action.label}
  </button>)}</>;
}

export type ArenaWebExecutionCapability =
  | Readonly<{ available: false; reason: string; label?: string }>
  | Readonly<{ available: true; onRun(): void; disabled?: boolean; label?: string; notice?: string }>;

export type ArenaWebResultViewProps = Readonly<{
  source: string;
  ready: boolean;
  title?: string;
  sourceLabel?: string;
  prelude?: string;
  epilogue?: string;
  status?: ReactNode;
  riskProfile?: WebPackageRiskProfile | null;
  actions?: readonly ArenaWebReportAction[];
  execution?: ArenaWebExecutionCapability;
}>;

/** Safe result chrome: never interprets output as DOM, loads resources, or supplies a renderer. */
export function ArenaWebResultView({ source, ready, title, sourceLabel, prelude = '', epilogue = '', status, riskProfile, actions = [], execution }: ArenaWebResultViewProps) {
  const capability = execution ?? { available: false as const, reason: '隔离运行待验：D4 门禁尚未完成，目前仅可查看安全文本、保存与导出。' };
  const runAction: ArenaWebReportAction = {
    id: 'run-web-report', label: capability.label ?? '运行 Web 战报',
    disabled: !ready || !capability.available || capability.disabled,
    onClick: () => { if (ready && capability.available && !capability.disabled) capability.onRun(); },
  };
  return <section data-testid="arena-web-result" className="result-card before:hidden" style={{ background: WEB_REPORT_SURFACE_BACKGROUND }}>
    <div className="result-content space-y-3">
      {title ? <h3 className="text-lg font-semibold">{title}</h3> : null}
      {status ? <div role="status" className="text-sm">{status}</div> : null}
      {!ready ? <p role="status" className="text-sm">当前为未完成输出，仅保留安全文本；不会运行或创建成功包实例。</p> : null}
      {riskProfile ? <WebPackageRiskSummary profile={riskProfile} surface="on-dark" /> : null}
      <ArenaWebSourceView source={source} label={sourceLabel} />
      <ArenaWebNotes prelude={prelude} epilogue={epilogue} />
      <p className="text-xs text-white/90">导出的 HTML、CSS 或 JavaScript 在外部打开时不受应用隔离保护，可能加载外部资源、发送信息或造成卡顿；交互进度不会自动保存。</p>
      <p role="status" className="text-xs text-white/90">{capability.available ? capability.notice : capability.reason}</p>
      <div className="buttons-container flex flex-wrap gap-2"><ArenaWebReportActions actions={[...actions, runAction]} /></div>
    </div>
  </section>;
}
