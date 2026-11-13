import { Minus, Plus, RotateCcw } from 'lucide-react';
import { DESKTOP_ZOOM_PERCENT_OPTIONS, isDesktopZoomPercent } from '@mahoshojo/contracts/desktop-config';
import { SettingsCard, SettingsFieldRow } from '@mahoshojo/ui-web/settings';
import { useDesktopZoom } from './use-desktop-zoom';

const BUTTON_CLASS = 'inline-flex items-center gap-1 rounded-md border border-(--app-border) px-3 py-2 text-sm text-(--app-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:opacity-50';

const actualZoomLabel = (percent: number | null, uncertain: boolean): string => {
  if (percent === null) return '倍率尚未确认';
  return uncertain ? `倍率尚未确认（上次确认 ${percent}%）` : `当前生效 ${percent}%`;
};

export function DesktopZoomSettingsCard() {
  const { controller, state } = useDesktopZoom();
  return <SettingsCard title="显示" description="此项仅影响桌面端主窗口的文字、控件和布局，与阅读字号叠加。">
    <SettingsFieldRow label="整体缩放" description="Ctrl + 加号／减号或 Ctrl + 鼠标滚轮调整，Ctrl + 0 恢复 100%。"
      control={<div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <button type="button" className={BUTTON_CLASS} disabled={state.requestedPercent === 80} onClick={() => controller.step(-1)}><Minus className="h-4 w-4" aria-hidden="true" />缩小</button>
        <select aria-label="整体缩放倍率" value={state.requestedPercent} className="rounded-md border border-(--app-input-border) bg-(--app-input-bg) px-2 py-2 text-sm text-(--app-text) focus-visible:outline-2 focus-visible:outline-(--app-accent-strong)"
          onChange={(event) => { const percent = Number(event.target.value); if (isDesktopZoomPercent(percent)) controller.setPercent(percent); }}>
          {DESKTOP_ZOOM_PERCENT_OPTIONS.map((percent) => <option key={percent} value={percent}>{percent}%</option>)}
        </select>
        <button type="button" className={BUTTON_CLASS} disabled={state.requestedPercent === 200} onClick={() => controller.step(1)}><Plus className="h-4 w-4" aria-hidden="true" />放大</button>
        <button type="button" className={BUTTON_CLASS} onClick={controller.reset}><RotateCcw className="h-4 w-4" aria-hidden="true" />恢复 100%</button>
      </div>} />
    <p className="text-xs text-(--app-text-muted)" role="status">{actualZoomLabel(state.actualPercent, state.applyError !== null)} · 配置倍率 {state.configuredPercent}%{state.saving ? ' · 正在保存' : ''}{state.applying ? ' · 正在应用' : ''}</p>
    {state.temporary ? <p className="mt-2 text-sm text-(--app-text)">当前倍率仅在本次运行中生效，尚未保存。<button type="button" className="ml-2 underline" onClick={() => controller.setPercent(state.requestedPercent)}>尝试保存当前倍率</button></p> : null}
    {state.applyError ? <p role="alert" className="mt-2 break-words text-sm text-(--app-accent-strong)">缩放未能应用：{state.applyError}。<button type="button" className="ml-2 underline" onClick={controller.retry}>重试应用</button></p> : null}
    {state.saveError ? <p role="alert" className="mt-2 break-words text-sm text-(--app-accent-strong)">缩放未保存：{state.saveError}</p> : null}
  </SettingsCard>;
}

/** 快捷键在任意产品页可用，失败也必须在原页可见。 */
export function DesktopZoomFeedback() {
  const { controller, state } = useDesktopZoom();
  if (!state.applyError && !state.saveError && !state.temporary) return null;
  return <div className="sticky top-0 z-20 break-words border-b border-(--app-border) bg-(--app-surface) px-4 py-2 text-sm text-(--app-text)" role="alert">
    页面缩放：{actualZoomLabel(state.actualPercent, state.applyError !== null)}。
    {state.temporary ? '当前倍率仅在本次运行中生效，尚未保存。' : null}
    {state.saveError ? `缩放未保存：${state.saveError}。` : null}
    {state.applyError ? <>缩放应用失败：{state.applyError}。<button type="button" className="ml-2 underline" onClick={controller.retry}>重试应用</button></> : null}
  </div>;
}
