'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDown, FileText, Maximize, Minimize, PanelsTopLeft } from 'lucide-react';
import type { NewsReport } from '@/components/BattleReportCard';
import { SegmentedControl, type SegmentedOption } from '@/components/shared/SegmentedControl';
import { BaseModal } from '@/components/shared/BaseModal';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { resolveWebDisplayTitle } from '@/lib/arena/battle-report-display-title';
import { normalizeArenaWebOutput } from '@/lib/arena/web-output';
import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import {
  deleteWebPackageArchiveCache,
  hydrateWebPackageSessionFromCache,
  importLocalWebPackageArchive,
} from '@/lib/web-package/cache';
import styles from './ArenaWebReport.module.css';
import type { WebPackageArtifact, WebPackageRef } from '@mahoshojo/contracts/web-package';
import {
  BUILTIN_WEB_PACKAGE_PRESETS,
  findBuiltinWebPackagePreset,
  formatWebPackageFallback,
  isBuiltinWebPackageRef,
  listStagedLocalWebPackages,
  packWebPackageZip,
  renderWebPackage,
  resolveWebPackage,
  unstageLocalWebPackage,
} from '@mahoshojo/web-package';

const CONSENT_KEY = 'arena.web-report-consent.v1';
// 仅附加到预览；低优先级 layer 允许作品自身的滚动条设计覆盖默认样式。
// Chromium 的透明原生轨道会露出 iframe 底色，自定义轨道需继承作品背景。
const PREVIEW_SCROLLBAR_STYLE = `<style data-arena-web-scrollbars>
@layer arena-web-scrollbars {
  @media (forced-colors: none) {
    @supports selector(::-webkit-scrollbar) {
      :where(*)::-webkit-scrollbar {
        width: 8px;
        height: 8px;
        background: inherit;
      }
      :where(*)::-webkit-scrollbar-thumb {
        background: #737373;
        border-radius: 999px;
      }
      :where(*)::-webkit-scrollbar-corner {
        background: inherit;
      }
    }
    @supports not selector(::-webkit-scrollbar) {
      :where(*) {
        scrollbar-width: thin;
        scrollbar-color: #737373 transparent;
      }
    }
  }
}
</style>`;
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
        Web 战报会运行生成的网页或 Web 包中的 HTML、CSS 和 JavaScript，并可能加载第三方脚本、样式、图片或其他网络资源。
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

type WebReportMetadata = {
  aiModel?: NewsReport['aiModel'];
  aiUsage?: NewsReport['aiUsage'] | null;
};

function ArenaWebDocument({ htmlDocument, prelude, epilogue, reload, immersive, aiModel, aiUsage, onToggleImmersive }: WebReportMetadata & {
  htmlDocument: string;
  prelude: string;
  epilogue: string;
  reload: number;
  immersive: boolean;
  onToggleImmersive: (viewer: HTMLDivElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const previewDocument = useMemo(() => htmlDocument + PREVIEW_SCROLLBAR_STYLE, [htmlDocument]);
  const viewerRef = useRef<HTMLDivElement>(null);
  const immersiveButtonRef = useRef<HTMLButtonElement>(null);
  const focusOnExpandRef = useRef(false);
  const model = aiModel?.trim();
  const hasTokens = [aiUsage?.promptTokens, aiUsage?.reasoningTokens, aiUsage?.completionTokens]
    .some((value) => typeof value === 'number' && Number.isFinite(value));
  const formatToken = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';

  useEffect(() => {
    setExpanded(true);
  }, [htmlDocument, reload, immersive]);

  useEffect(() => {
    if (!expanded || hovered || keyboardFocus) return;
    const timer = window.setTimeout(() => {
      immersiveButtonRef.current?.blur();
      setExpanded(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [expanded, hovered, keyboardFocus, htmlDocument, reload, immersive]);

  useEffect(() => {
    if (expanded && focusOnExpandRef.current) {
      focusOnExpandRef.current = false;
      immersiveButtonRef.current?.focus({ preventScroll: true });
    }
  }, [expanded]);

  // 两种模式保持同一组 DOM 层级，只切换布局 class，避免 iframe browsing context 被重建。
  return (
    <>
      <div
        ref={viewerRef}
        role={immersive ? 'dialog' : undefined}
        aria-modal={immersive ? true : undefined}
        aria-label={immersive ? '沉浸式 Web 战报' : undefined}
        data-testid={immersive ? 'arena-web-immersive' : undefined}
        className={`${styles.viewer} ${immersive ? styles.immersive : ''}`}
      >
        <header
          className={styles.header}
          data-testid="arena-web-header"
          aria-hidden={!expanded}
          inert={!expanded}
        >
          <div
            className={styles.controls}
            onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true); }}
            onPointerLeave={() => setHovered(false)}
            onPointerDownCapture={() => setKeyboardFocus(false)}
            onKeyDownCapture={() => setKeyboardFocus(true)}
            onFocusCapture={(event) => {
              const focusVisible = event.target.matches(':focus-visible');
              setKeyboardFocus((current) => current || focusVisible);
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
            }}
          >
            <div className={styles.identity}>
              <img src="/arena-white.svg" alt="魔法少女竞技场" width={140} height={45} className={styles.logo} />
              {model || hasTokens ? <div className={styles.metadata}>
                {model ? <span className={styles.model}>模型：{model}{hasTokens ? ' · ' : ''}</span> : null}
                {hasTokens ? <>
                  <span className={styles.token}>tokens：输入 {formatToken(aiUsage?.promptTokens)}</span>
                  <span className={styles.token}>｜推理 {formatToken(aiUsage?.reasoningTokens)}</span>
                  <span className={styles.token}>｜输出 {formatToken(aiUsage?.completionTokens)}</span>
                </> : null}
              </div> : null}
            </div>
            <button
              ref={immersiveButtonRef}
              type="button"
              onClick={() => onToggleImmersive(viewerRef.current)}
              className={styles.immersiveButton}
            >
              {immersive ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
              {immersive ? '退出沉浸' : '沉浸体验'}
            </button>
          </div>
        </header>
        <button
          type="button"
          className={styles.expandButton}
          hidden={expanded}
          aria-label="展开 Web 战报工具栏"
          aria-expanded={expanded}
          onClick={(event) => {
            focusOnExpandRef.current = event.detail === 0;
            setKeyboardFocus(event.detail === 0);
            setExpanded(true);
          }}
        >
          <ChevronDown size={20} aria-hidden="true" />
        </button>
        <iframe
          key={reload}
          title="AI Web 战报"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={previewDocument}
          data-testid="arena-web-document"
          className={styles.frame}
        />
      </div>
      {prelude || epilogue ? <div className="px-4 pt-4" hidden={immersive}>
        <ArenaWebNotes prelude={prelude} epilogue={epilogue} />
      </div> : null}
    </>
  );
}

export function ArenaReportFormatSelector({ value, onChange, disabled = false, roomId, webPackageRef, onWebPackageChange }: {
  value: 'markdown' | 'web';
  onChange: (format: 'markdown' | 'web') => void;
  disabled?: boolean;
  roomId?: string;
  webPackageRef?: WebPackageRef | null;
  onWebPackageChange?: (ref: WebPackageRef | null) => void;
}) {
  const { accepted, accept } = useWebConsent(roomId);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [localPackages, setLocalPackages] = useState<readonly { ref: WebPackageRef; name: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedPreset = findBuiltinWebPackagePreset(webPackageRef);
  const selectedLocal = webPackageRef && !selectedPreset
    ? localPackages.find((item) => item.ref.digest === webPackageRef.digest)
    : undefined;
  useEffect(() => {
    let active = true;
    void hydrateWebPackageSessionFromCache().then(() => {
      if (!active) return;
      setLocalPackages(listStagedLocalWebPackages().map((pkg) => ({ ref: pkg.ref, name: pkg.manifest.name })));
    });
    return () => { active = false; };
  }, []);
  const refreshLocalPackages = () => {
    setLocalPackages(listStagedLocalWebPackages().map((pkg) => ({ ref: pkg.ref, name: pkg.manifest.name })));
  };
  const downloadPresetZip = async (refToDownload: WebPackageRef) => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const base = await resolveWebPackage(refToDownload);
      const archive = await packWebPackageZip(base);
      downloadBlob(new Blob([archive], { type: 'application/zip' }), buildSafeFileName(`${base.manifest.id}@${base.manifest.version}`, 'zip', 'mahoshojo-web-package'));
    } catch {
      setDownloadError('Web 包下载失败，请稍后重试。');
    } finally {
      setDownloading(false);
    }
  };
  const handleImportFile = async (file: File | null | undefined) => {
    if (!file || importing || !onWebPackageChange) return;
    setImporting(true);
    setImportError(null);
    try {
      const archive = new Uint8Array(await file.arrayBuffer());
      const pkg = await importLocalWebPackageArchive(archive);
      refreshLocalPackages();
      onWebPackageChange(pkg.ref);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Web 包导入失败');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  const handleRemoveLocal = async () => {
    if (!webPackageRef || isBuiltinWebPackageRef(webPackageRef) || !onWebPackageChange) return;
    unstageLocalWebPackage(webPackageRef);
    void deleteWebPackageArchiveCache(webPackageRef.digest);
    refreshLocalPackages();
    onWebPackageChange(null);
  };
  return (
    <div className="input-group">
      <SegmentedControl label="战报格式" value={value} options={FORMAT_OPTIONS} disabled={disabled} onChange={(format) => {
        if (format === 'web' && !accepted) setConfirming(true);
        else onChange(format);
      }} />
      {value === 'web' && onWebPackageChange ? <div className="mt-3 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium">Web 包</span>
          <select
            value={webPackageRef ? webPackageRef.digest : ''}
            disabled={disabled}
            onChange={(event) => {
              const digest = event.target.value;
              if (!digest) {
                onWebPackageChange(null);
                return;
              }
              const preset = BUILTIN_WEB_PACKAGE_PRESETS.find((item) => item.packageRef.digest === digest);
              if (preset) {
                onWebPackageChange(preset.packageRef);
                return;
              }
              const local = localPackages.find((item) => item.ref.digest === digest);
              if (local) onWebPackageChange(local.ref);
            }}
            className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">自由生成网页</option>
            {BUILTIN_WEB_PACKAGE_PRESETS.map((preset) => (
              <option key={preset.packageRef.digest} value={preset.packageRef.digest}>{preset.title}</option>
            ))}
            {localPackages.map((item) => (
              <option key={item.ref.digest} value={item.ref.digest}>本地：{item.name}</option>
            ))}
            {webPackageRef && !selectedPreset && !selectedLocal ? <option value={webPackageRef.digest}>不可用的 Web 包（请重新选择）</option> : null}
          </select>
        </label>
        <span className="mt-1 block text-xs text-gray-500">
          {selectedPreset?.description
            ?? (selectedLocal ? `已加载本地 Web 包（${selectedLocal.name} · ${selectedLocal.ref.id}@${selectedLocal.ref.version}）。缓存可能因清理站点数据或存储配额而消失，可重新导入。` : '视觉小说使用内置阅读器，AI 只生成本场故事；完成后可切换安全文本显示。')}
        </span>
        {selectedPreset ? <button
          type="button"
          disabled={disabled || downloading}
          onClick={() => void downloadPresetZip(selectedPreset.packageRef)}
          className="mt-2 min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          {downloading ? '正在准备 ZIP…' : '下载 Web 包 ZIP'}
        </button> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            disabled={disabled || importing}
            onChange={(event) => void handleImportFile(event.target.files?.[0])}
            aria-label="导入本地 Web 包 ZIP"
          />
          <button
            type="button"
            disabled={disabled || importing}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            {importing ? '正在导入…' : '导入本地 ZIP'}
          </button>
          {selectedLocal ? <button
            type="button"
            disabled={disabled}
            onClick={() => void handleRemoveLocal()}
            className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            移除本地包
          </button> : null}
        </div>
        {importError ? <span className="mt-1 block text-xs text-red-600 dark:text-red-400" role="status">{importError}</span> : null}
        {downloadError ? <span className="mt-1 block text-xs text-red-600 dark:text-red-400" role="status">{downloadError}</span> : null}
      </div> : null}
      <WebReportConsentDialog open={confirming && !disabled} onCancel={() => setConfirming(false)} onAccept={(remember) => {
        accept(remember);
        setConfirming(false);
        onChange('web');
      }} />
    </div>
  );
}

/** 仅 authoritative final 可以执行；暂停、失败或断开连接都不意味着完成。 */
export function ArenaWebReport({ content, ready, roomId, aiModel, aiUsage, displayTitle, webPackage, children }: WebReportMetadata & {
  content: string;
  ready: boolean;
  roomId?: string;
  /** 上游解析好的显示标题；缺省时按同一 resolver 从内容尽力解析。 */
  displayTitle?: string | null;
  webPackage?: WebPackageArtifact | null;
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
  const [packageResolution, setPackageResolution] = useState<{ artifact: WebPackageArtifact; content: string; html?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!webPackage || !ready) return;
    let active = true;
    void renderWebPackage({ ...webPackage, generatedContent: content }).then((location) => {
      if (active) setPackageResolution({ artifact: webPackage, content, html: location.html });
    }).catch(() => {
      if (active) setPackageResolution({ artifact: webPackage, content, error: 'Web 包不可用或故事数据校验失败，已保留安全文本。' });
    });
    return () => { active = false; };
  }, [content, ready, webPackage]);
  const matchingResolution = packageResolution?.artifact === webPackage && packageResolution?.content === content ? packageResolution : null;
  const webDocument = webPackage ? (matchingResolution?.html ?? null) : normalizedOutput.document;
  const packageFallback = useMemo(() => webPackage
    ? formatWebPackageFallback({ ...webPackage, generatedContent: content })
    : '', [content, webPackage]);
  const resolvedDisplayTitle = useMemo(
    () => displayTitle?.trim() || resolveWebDisplayTitle({ html: content }),
    [displayTitle, content],
  );
  useEffect(() => {
    if (ready && webDocument && !accepted && !asked) {
      setAsked(true);
      setConfirming(true);
    }
  }, [ready, webDocument, accepted, asked]);
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
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [immersive]);
  useEffect(() => () => {
    if (nativeFullscreenRequestedRef.current && document.fullscreenElement && document.exitFullscreen) {
      nativeFullscreenRequestedRef.current = false;
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);
  const showingWeb = ready && accepted && displayMode === 'web' && webDocument !== null;
  const enterImmersive = useCallback((viewer: HTMLDivElement | null) => {
    setImmersive(true);
    if (!viewer || typeof viewer.requestFullscreen !== 'function') return;

    nativeFullscreenRequestedRef.current = true;
    // 让作品容器进入浏览器顶层，避免宿主页/弹窗的滚动结构继续参与全屏交互。
    void viewer.requestFullscreen().catch(() => {
      nativeFullscreenRequestedRef.current = false;
    });
  }, []);
  const exitImmersive = useCallback(() => {
    setImmersive(false);
    if (!nativeFullscreenRequestedRef.current) return;

    nativeFullscreenRequestedRef.current = false;
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    if (!immersive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // 历史战报可能位于弹窗中，Escape 优先退出作品，避免外层弹窗关闭并销毁 iframe。
      event.stopPropagation();
      // 原生 fullscreen 由浏览器处理 Escape，避免阻止其退出默认行为。
      if (nativeFullscreenRequestedRef.current && document.fullscreenElement) return;
      event.preventDefault();
      exitImmersive();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [exitImmersive, immersive]);
  useEffect(() => {
    if (immersive && !showingWeb) exitImmersive();
  }, [exitImmersive, immersive, showingWeb]);
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
    if (!webDocument) return;
    setConfirming(true);
  };
  const downloadHtml = () => {
    if (!ready || !webDocument) return;
    // BOM 确保缺少 charset 声明的生成文档在本地打开时仍按 UTF-8 解码。
    const blob = new Blob(['\uFEFF', webDocument], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, buildSafeFileName(`魔法少女速报_${resolvedDisplayTitle}`, 'html', '魔法少女速报'));
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
        {webPackage ? (matchingResolution?.error ?? '正在校验 Web 包与故事数据…') : '这份输出没有包含完整的 HTML 文档，已切换为普通显示；其中的脚本不会被执行。'}
      </p> : null}
      {children(showingWeb ? (
        <ArenaWebDocument
          htmlDocument={webDocument}
          prelude={webPackage ? '' : normalizedOutput.prelude}
          epilogue={webPackage ? '' : normalizedOutput.epilogue}
          reload={reload}
          immersive={immersive}
          aiModel={aiModel}
          aiUsage={aiUsage}
          onToggleImmersive={immersive ? exitImmersive : enterImmersive}
        />
      ) : webPackage ? <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 text-sm" aria-label="Web 包故事数据（安全文本）">{packageFallback}</pre> : undefined, <>
        {showingWeb && !immersive ? <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all"
          aria-label="重新加载 Web 战报"
          title="重新加载 Web 战报"
        >
          ↻ 重新加载
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
