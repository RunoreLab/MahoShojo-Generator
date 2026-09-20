'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FileText, PanelsTopLeft } from 'lucide-react';
import { SegmentedControl, type SegmentedOption } from '@/components/shared/SegmentedControl';
import { BaseModal } from '@/components/shared/BaseModal';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { normalizeArenaWebOutput } from '@/lib/arena/web-output';
import { downloadBlob } from '@/lib/client/blobUrl';

const CONSENT_KEY = 'arena.web-report-consent.v1';
const FORMAT_OPTIONS: readonly SegmentedOption<'markdown' | 'web'>[] = [
  { value: 'markdown', label: 'Markdown', icon: <FileText />, description: '以正文为主的战报，支持标题、表格与公式，适合阅读和保存图片。' },
  { value: 'web', label: 'Web（实验性）', icon: <PanelsTopLeft />, description: '生成带自定义排版、动画或交互的网页；完成后经本地确认展示，可能加载第三方资源。' },
];
type ArenaWebDisplayMode = 'ordinary' | 'web';
const DISPLAY_OPTIONS: readonly SegmentedOption<ArenaWebDisplayMode>[] = [
  { value: 'ordinary', label: '普通显示', icon: <FileText />, description: '使用普通战报卡片展示正文，适合阅读、保存图片和下载战斗记录。' },
  { value: 'web', label: 'Web 显示', icon: <PanelsTopLeft />, description: '在浏览器隔离框架中展示生成的网页战报，保留自定义排版和交互。' },
];
const sessionConsents = new Set<string>();
const consentListeners = new Set<() => void>();
const consentKey = (roomId?: string) => roomId ? `${CONSENT_KEY}.room.${roomId}` : CONSENT_KEY;

function hasConsent(key: string): boolean {
  if (sessionConsents.has(key)) return true;
  try { return window.localStorage.getItem(key) === 'accepted'; } catch { return false; }
}

function subscribeConsent(listener: () => void) {
  consentListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    consentListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function useWebConsent(roomId?: string) {
  const key = consentKey(roomId);
  const accepted = useSyncExternalStore(subscribeConsent, () => hasConsent(key), () => false);
  const accept = (remember: boolean) => {
    sessionConsents.add(key);
    if (remember) {
      try { window.localStorage.setItem(key, 'accepted'); } catch { /* 当前页面仍然有效。 */ }
    }
    consentListeners.forEach((listener) => listener());
  };
  return { accepted, accept };
}

function WebReportConsentDialog({ open, onCancel, onAccept }: {
  open: boolean;
  onCancel: () => void;
  onAccept: (remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  return (
    <BaseModal isOpen={open} title="启用 Web 战报" onClose={onCancel} maxWidthClassName="max-w-lg">
      <p className="text-sm leading-6">
        Web 战报会运行 AI 生成的 HTML、CSS 和 JavaScript，并可能加载第三方脚本、样式、图片或其他网络资源。
        生成页面可能出现显示异常、页面卡顿或外部资源失效，第三方资源也可能接收到相关网络请求或页面发送的信息。
        请仅在了解这些风险后启用。
      </p>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        此浏览器不再提示（多人房间分别确认）
      </label>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">取消</button>
        <button type="button" onClick={() => onAccept(remember)} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white">继续使用 Web</button>
      </div>
    </BaseModal>
  );
}

function ArenaWebNotes({ prelude, epilogue }: {
  prelude: string;
  epilogue: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const notes = [
    prelude ? { label: '前言', content: prelude } : null,
    epilogue ? { label: '后记', content: epilogue } : null,
  ].filter((note): note is { label: string; content: string } => note !== null);

  if (notes.length === 0) return null;

  return (
    <section className="rounded-lg border border-white/10 bg-black/20 text-white/90" data-testid="arena-web-notes">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>💬 AI 附言（{notes.length} 段）</span>
        <span aria-hidden="true" className="text-white/60">{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded ? <div className="space-y-3 border-t border-white/10 px-3 py-3">
        {notes.map((note) => (
          <div key={note.label}>
            <div className="mb-1 text-xs font-semibold tracking-wide text-white/60">AI {note.label}</div>
            <MarkdownBlock content={note.content} variant="dark" mode="article" />
          </div>
        ))}
      </div> : null}
    </section>
  );
}

function ArenaWebDocument({ htmlDocument, prelude, epilogue, reload, immersive, onReload, onDownload, onExitImmersive }: {
  htmlDocument: string;
  prelude: string;
  epilogue: string;
  reload: number;
  immersive: boolean;
  onReload: () => void;
  onDownload: () => void;
  onExitImmersive: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const exitButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (immersive) exitButtonRef.current?.focus();
  }, [immersive]);

  const frame = (
    <iframe
      key={reload}
      title="AI Web 战报"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={htmlDocument}
      data-testid="arena-web-document"
      className={immersive
        ? 'min-h-[360px] min-w-0 flex-1 rounded-lg border-0 bg-white'
        : 'mt-3 h-[75dvh] min-h-[360px] w-full rounded-lg border-0 bg-white'}
    />
  );

  if (!immersive) {
    return <>
      <ArenaWebNotes prelude={prelude} epilogue={epilogue} />
      {frame}
    </>;
  }

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="沉浸式 Web 战报"
      data-testid="arena-web-immersive"
      className="fixed inset-0 z-[60] flex min-h-[100dvh] flex-col bg-slate-950 text-white"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-3 py-3 backdrop-blur sm:px-5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold sm:text-base">AI Web 战报</div>
          <div className="text-xs text-white/55">沉浸显示 · iframe 仍保持隔离运行</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={onReload}
            className="min-h-10 rounded-lg bg-white/10 px-3 py-2 transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300"
          >
            ↻ 重新加载
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="min-h-10 rounded-lg bg-white/10 px-3 py-2 transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300"
          >
            🌐 下载 HTML
          </button>
          <button
            ref={exitButtonRef}
            type="button"
            onClick={onExitImmersive}
            className="min-h-10 rounded-lg bg-pink-500/80 px-3 py-2 font-semibold transition-colors hover:bg-pink-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-300"
          >
            × 退出沉浸
          </button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 sm:p-4">
        <ArenaWebNotes prelude={prelude} epilogue={epilogue} />
        {frame}
      </main>
    </div>,
    document.body,
  );
}

export function ArenaReportFormatSelector({ value, onChange, disabled = false, roomId }: {
  value: 'markdown' | 'web';
  onChange: (format: 'markdown' | 'web') => void;
  disabled?: boolean;
  roomId?: string;
}) {
  const { accepted, accept } = useWebConsent(roomId);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="input-group">
      <SegmentedControl label="战报格式" value={value} options={FORMAT_OPTIONS} disabled={disabled} onChange={(format) => {
        if (format === 'web' && !accepted) setConfirming(true);
        else onChange(format);
      }} />
      <WebReportConsentDialog open={confirming && !disabled} onCancel={() => setConfirming(false)} onAccept={(remember) => {
        accept(remember);
        setConfirming(false);
        onChange('web');
      }} />
    </div>
  );
}

/** 仅 authoritative final 可以执行；暂停、失败或断开连接都不意味着完成。 */
export function ArenaWebReport({ content, ready, roomId, children }: {
  content: string;
  ready: boolean;
  roomId?: string;
  children: (webContent: ReactNode | undefined, actions: ReactNode) => ReactNode;
}) {
  const { accepted, accept } = useWebConsent(roomId);
  const [displayMode, setDisplayMode] = useState<ArenaWebDisplayMode>('web');
  const [confirming, setConfirming] = useState(false);
  const [asked, setAsked] = useState(false);
  const [reload, setReload] = useState(0);
  const [immersive, setImmersive] = useState(false);
  const nativeFullscreenRequestedRef = useRef(false);
  const normalizedOutput = useMemo(() => normalizeArenaWebOutput(content), [content]);
  const webDocument = normalizedOutput.document;
  useEffect(() => {
    if (ready && !accepted && !asked) {
      setAsked(true);
      setConfirming(true);
    }
  }, [ready, accepted, asked]);
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && nativeFullscreenRequestedRef.current) {
        nativeFullscreenRequestedRef.current = false;
        setImmersive(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
  useEffect(() => {
    if (!immersive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [immersive]);
  useEffect(() => () => {
    if (nativeFullscreenRequestedRef.current && document.fullscreenElement && document.exitFullscreen) {
      nativeFullscreenRequestedRef.current = false;
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);
  const showingWeb = ready && accepted && displayMode === 'web' && webDocument !== null;
  const enterImmersive = () => {
    setImmersive(true);
    const requestFullscreen = document.documentElement.requestFullscreen;
    if (typeof requestFullscreen !== 'function') return;

    nativeFullscreenRequestedRef.current = true;
    void requestFullscreen.call(document.documentElement).catch(() => {
      nativeFullscreenRequestedRef.current = false;
    });
  };
  const exitImmersive = () => {
    setImmersive(false);
    if (!nativeFullscreenRequestedRef.current) return;

    nativeFullscreenRequestedRef.current = false;
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => undefined);
    }
  };
  const handleDisplayModeChange = (nextMode: ArenaWebDisplayMode) => {
    if (nextMode === 'ordinary') {
      if (immersive) exitImmersive();
      setDisplayMode('ordinary');
      setConfirming(false);
      return;
    }
    if (accepted) {
      setDisplayMode('web');
      return;
    }
    setConfirming(true);
  };
  const downloadHtml = () => {
    if (!ready || !webDocument) return;
    // BOM 确保缺少 charset 声明的生成文档在本地打开时仍按 UTF-8 解码。
    const blob = new Blob(['\uFEFF', webDocument], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `魔法少女速报_${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <SegmentedControl
          label="显示方式"
          value={showingWeb ? 'web' : 'ordinary'}
          options={DISPLAY_OPTIONS}
          disabled={!ready}
          onChange={handleDisplayModeChange}
        />
        {!ready ? <span className="pb-1 text-gray-500">生成完整战报后可使用 Web 显示。</span> : null}
      </div>
      {ready ? <p className="mb-3 text-xs text-gray-500">
        下载的 HTML 在浏览器直接打开时不再受本站沙箱保护；外部资源仍可能需要联网，页面内的交互进度不会保存。
        {showingWeb ? '如需保存图片，可使用浏览器截图，或切换普通显示保存普通战报图片。' : null}
      </p> : null}
      {ready && !webDocument ? <p className="mb-3 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-300/30 dark:bg-amber-950/30 dark:text-amber-100" role="status">
        这份输出没有包含完整的 HTML 文档，已切换为普通显示；其中的脚本不会被执行。
      </p> : null}
      {children(showingWeb ? (
        <ArenaWebDocument
          htmlDocument={webDocument}
          prelude={normalizedOutput.prelude}
          epilogue={normalizedOutput.epilogue}
          reload={reload}
          immersive={immersive}
          onReload={() => setReload((value) => value + 1)}
          onDownload={downloadHtml}
          onExitImmersive={exitImmersive}
        />
      ) : undefined, <>
        {showingWeb && !immersive ? <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all"
          aria-label="重新加载 Web 战报"
          title="重新加载 Web 战报"
        >
          ↻ 重新加载
        </button> : null}
        {showingWeb && !immersive ? <button
          type="button"
          onClick={enterImmersive}
          className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all"
          aria-label="沉浸显示 Web 战报"
          title="沉浸显示 Web 战报"
        >
          ⛶ 沉浸显示
        </button> : null}
        {!immersive ? <button
          type="button"
          disabled={!ready || !webDocument}
          onClick={downloadHtml}
          className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all disabled:cursor-not-allowed disabled:opacity-60"
        >
          🌐 下载 HTML
        </button> : null}
      </>)}
      <WebReportConsentDialog open={ready && confirming && !accepted} onCancel={() => { setConfirming(false); setDisplayMode('ordinary'); }} onAccept={(remember) => {
        accept(remember);
        setConfirming(false);
        setDisplayMode('web');
      }} />
    </>
  );
}
