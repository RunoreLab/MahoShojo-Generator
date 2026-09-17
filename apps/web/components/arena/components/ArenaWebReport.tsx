'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BaseModal } from '@/components/shared/BaseModal';
import { stripAllStreamMetaComments } from '@/lib/arena/stream-meta';

const CONSENT_KEY = 'arena.web-report-consent.v1';
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
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-medium">战报格式</legend>
      <div className="flex flex-wrap gap-2">
        {(['markdown', 'web'] as const).map((format) => (
          <button key={format} type="button" aria-pressed={value === format}
            className={`rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${value === format ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-gray-300'}`}
            onClick={() => {
              if (format === 'web' && !accepted) setConfirming(true);
              else onChange(format);
            }}>
            {format === 'web' ? 'Web（实验性）' : 'Markdown'}
          </button>
        ))}
      </div>
      <WebReportConsentDialog open={confirming && !disabled} onCancel={() => setConfirming(false)} onAccept={(remember) => {
        accept(remember);
        setConfirming(false);
        onChange('web');
      }} />
    </fieldset>
  );
}

/** 仅 authoritative final 可以执行；暂停、失败或断开连接都不意味着完成。 */
export function ArenaWebReport({ content, ready, roomId, children }: {
  content: string;
  ready: boolean;
  roomId?: string;
  children: (webContent: ReactNode | undefined) => ReactNode;
}) {
  const { accepted, accept } = useWebConsent(roomId);
  const [ordinary, setOrdinary] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [asked, setAsked] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (ready && !accepted && !asked) {
      setAsked(true);
      setConfirming(true);
    }
  }, [ready, accepted, asked]);
  const showingWeb = ready && accepted && !ordinary;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" aria-pressed={!showingWeb} onClick={() => { setOrdinary(true); setConfirming(false); }} className="rounded-lg border px-3 py-2">普通显示</button>
        <button type="button" aria-pressed={showingWeb} disabled={!ready} onClick={() => {
          if (accepted) setOrdinary(false);
          else setConfirming(true);
        }} className="rounded-lg border px-3 py-2 disabled:opacity-50">Web 显示</button>
        {showingWeb ? <button type="button" onClick={() => setReload((value) => value + 1)} className="rounded-lg border px-3 py-2">重新加载 Web</button> : null}
        {!ready ? <span className="text-gray-500">生成完整战报后可使用 Web 显示。</span> : null}
      </div>
      {children(showingWeb ? (
        <iframe key={reload} title="AI Web 战报" sandbox="allow-scripts" referrerPolicy="no-referrer"
          srcDoc={stripAllStreamMetaComments(content)} className="h-[75vh] min-h-[360px] w-full rounded-lg border-0 bg-white" />
      ) : undefined)}
      <WebReportConsentDialog open={ready && confirming && !accepted} onCancel={() => { setConfirming(false); setOrdinary(true); }} onAccept={(remember) => {
        accept(remember);
        setConfirming(false);
        setOrdinary(false);
      }} />
    </>
  );
}
