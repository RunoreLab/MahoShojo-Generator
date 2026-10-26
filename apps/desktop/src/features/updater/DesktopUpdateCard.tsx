import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { BaseModal } from '@mahoshojo/ui-web/modal';
import { SettingsCard } from '@mahoshojo/ui-web/settings';

import { hasBusyOperations } from '../../app/busy-operations';
import { useLeaveGuard } from '../../app/useLeaveGuard';
import { getDesktopConfigStore } from '../config/use-desktop-config';
import { desktopUpdater, normalizeDesktopUpdateError, type DesktopUpdateCheck, type DesktopUpdateProgress, type DesktopUpdaterClient } from '../../platform/desktop-updater';

const BUTTON_CLASS = 'inline-flex items-center justify-center gap-2 rounded-md border border-(--app-border-strong) bg-(--app-surface) px-3 py-2 text-sm font-medium text-(--app-text) hover:underline disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2';
type Phase = 'idle' | 'checking' | 'downloading' | 'installing' | 'installed';
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function DesktopUpdateCard({ client = desktopUpdater }: { client?: DesktopUpdaterClient }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<DesktopUpdateCheck | null>(null);
  const [progress, setProgress] = useState<DesktopUpdateProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const guard = useLeaveGuard(() => busyRef.current, '更新正在进行，请等待安装完成，或先取消下载。');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const check = async () => {
    setPhase('checking');
    setMessage(null);
    setResult(null);
    try {
      const next = await client.check();
      if (mounted.current) {
        setResult(next);
        if (!next.available) setMessage('当前已是最新版本。');
      }
    } catch (error) {
      if (mounted.current) setMessage(normalizeDesktopUpdateError(error, 'check-failed').message);
    } finally { if (mounted.current) setPhase('idle'); }
  };

  const install = async () => {
    if (!result?.available || busyRef.current) return;
    if (hasBusyOperations() || getDesktopConfigStore().getSnapshot().saving) {
      setConfirming(false);
      setMessage('仍有生成、保存或维护操作在进行，请等待完成后再安装更新。');
      return;
    }
    busyRef.current = true;
    setConfirming(false);
    setPhase('downloading');
    setProgress(null);
    setMessage(null);
    try {
      await client.install(result.available.version, (next) => {
        if (!mounted.current) return;
        setProgress(next);
        setPhase(next.phase);
      });
      if (mounted.current) {
        setPhase('installed');
        setMessage('安装程序已启动，请按安装提示完成更新。');
      }
    } catch (error) {
      if (mounted.current) {
        const failure = normalizeDesktopUpdateError(error, 'install-failed');
        setMessage(failure.code === 'cancelled' ? '已取消下载，当前版本保持不变。' : failure.message);
        if (failure.code === 'not-checked') setResult(null);
        setPhase('idle');
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setCancelling(false);
    }
  };

  const cancel = async () => {
    if (cancelling || phase !== 'downloading') return;
    setCancelling(true);
    try {
      if (!await client.cancel() && mounted.current) {
        setMessage('下载已结束或安装已启动，正在等待更新结果。');
      }
    } catch (error) {
      if (mounted.current) setMessage(normalizeDesktopUpdateError(error, 'download-failed').message);
    } finally { if (mounted.current) setCancelling(false); }
  };

  const running = phase === 'downloading' || phase === 'installing';
  return (
    <SettingsCard title="应用更新" description="手动检查官方更新。下载包会验证签名，安装前请保存作品。">
      {result && <p className="text-sm text-(--app-text-muted)">当前版本：{result.currentVersion}</p>}
      {result?.available && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-medium text-(--app-text)">发现新版本：{result.available.version}</p>
          {result.available.notes && <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-(--app-text-muted)">{result.available.notes}</p>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={BUTTON_CLASS} disabled={phase !== 'idle'} onClick={() => { void check(); }}>
          <RefreshCw size={16} aria-hidden="true" />{phase === 'checking' ? '正在检查…' : '检查更新'}
        </button>
        {result?.available && !running && phase !== 'installed' && (
          <button type="button" className={BUTTON_CLASS} disabled={!guard.ready || phase !== 'idle'} onClick={() => setConfirming(true)}>
            <Download size={16} aria-hidden="true" />下载并安装
          </button>
        )}
      </div>
      {!running && (message || guard.message) && <p role="status" className="mt-3 text-sm text-(--app-text-muted)">{message || guard.message}</p>}
      <BaseModal isOpen={confirming || running} title="安装桌面版更新" maxWidthClassName="max-w-xl" closeOnBackdrop={!running}
        closeButtonAriaLabel={running ? (phase === 'downloading' ? '取消下载' : '正在安装，请等待') : '关闭对话框'}
        closeButtonContent={phase === 'installing' ? <RefreshCw size={16} aria-hidden="true" /> : undefined}
        onClose={() => { if (!running) setConfirming(false); else if (phase === 'downloading') void cancel(); }} footer={
        <div className="flex flex-wrap justify-end gap-2">
          {running ? phase === 'downloading' ? (
            <button type="button" className={BUTTON_CLASS} disabled={cancelling} onClick={() => { void cancel(); }}>
              <X size={16} aria-hidden="true" />{cancelling ? '正在取消…' : '取消下载'}
            </button>
          ) : <p className="text-sm text-(--app-text-muted)">正在安装，请等待应用关闭。</p> : <>
            <button type="button" className={BUTTON_CLASS} onClick={() => setConfirming(false)}><X size={16} aria-hidden="true" />暂不安装</button>
            <button type="button" className={BUTTON_CLASS} onClick={() => { void install(); }}><Download size={16} aria-hidden="true" />已保存，开始更新</button>
          </>}
        </div>
      }>
        <p className="text-sm leading-relaxed text-(--app-text)">更新到 {result?.available?.version}。安装时应用将关闭，请先保存当前作品并完成生成、备份或恢复操作。下载期间可以取消，开始安装后请等待完成。</p>
        {running && (
        <div className="mt-3 space-y-2" aria-live="polite">
          <p className="text-sm text-(--app-text)">{phase === 'installing' ? '已验证更新包，正在启动安装程序…' : '正在下载更新…'}</p>
          {phase === 'downloading' && <>
            <progress aria-label="更新下载进度" className="w-full" max={progress?.totalBytes || undefined} value={progress?.totalBytes ? Math.min(progress.downloadedBytes, progress.totalBytes) : undefined} />
            {progress && <p className="text-xs text-(--app-text-muted)">{formatBytes(progress.downloadedBytes)}{progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ''}</p>}
          </>}
        </div>
        )}
        {running && (message || guard.message) && <p role="status" className="mt-3 text-sm text-(--app-text-muted)">{message || guard.message}</p>}
      </BaseModal>
    </SettingsCard>
  );
}
