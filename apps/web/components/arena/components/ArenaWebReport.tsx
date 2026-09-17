'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { FileText, PanelsTopLeft } from 'lucide-react';
import { SegmentedControl, type SegmentedOption } from '@/components/shared/SegmentedControl';
import { BaseModal } from '@/components/shared/BaseModal';
import { stripAllStreamMetaComments } from '@/lib/arena/stream-meta';
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
  useEffect(() => {
    if (ready && !accepted && !asked) {
      setAsked(true);
      setConfirming(true);
    }
  }, [ready, accepted, asked]);
  const showingWeb = ready && accepted && displayMode === 'web';
  const handleDisplayModeChange = (nextMode: ArenaWebDisplayMode) => {
    if (nextMode === 'ordinary') {
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
    if (!ready) return;
    // BOM 确保缺少 charset 声明的生成文档在本地打开时仍按 UTF-8 解码。
    const blob = new Blob(['\uFEFF', stripAllStreamMetaComments(content)], { type: 'text/html;charset=utf-8' });
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
      {children(showingWeb ? (
        <iframe key={reload} title="AI Web 战报" sandbox="allow-scripts" referrerPolicy="no-referrer"
          srcDoc={stripAllStreamMetaComments(content)} className="h-[75vh] min-h-[360px] w-full rounded-lg border-0 bg-white" />
      ) : undefined, <>
        {showingWeb ? <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all"
          aria-label="重新加载 Web 战报"
          title="重新加载 Web 战报"
        >
          ↻ 重新加载
        </button> : null}
        <button
          type="button"
          disabled={!ready}
          onClick={downloadHtml}
          className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all disabled:cursor-not-allowed disabled:opacity-60"
        >
          🌐 下载 HTML
        </button>
      </>)}
      <WebReportConsentDialog open={ready && confirming && !accepted} onCancel={() => { setConfirming(false); setDisplayMode('ordinary'); }} onAccept={(remember) => {
        accept(remember);
        setConfirming(false);
        setDisplayMode('web');
      }} />
    </>
  );
}
