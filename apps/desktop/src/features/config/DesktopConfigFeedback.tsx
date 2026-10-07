import type { DesktopConfigValues } from '@mahoshojo/contracts/desktop-config';

import { useDesktopConfig } from './use-desktop-config';

/**
 * 人工配置的写入反馈横幅（D5.1-N1-r1）。
 *
 * config.json 字段已分布在多个设置分组（外观的 Esc 菜单、在线的公告/外链、
 * 数据的公开缓存）——`saveError` 与冲突草稿是**整份文件级**的状态，不再
 * 归属于某一个分组卡。这里作为设置页的共同位置统一投影：sticky 横幅在
 * 长页面滚动时保持可见，不渲染时没有布局成本。
 */

/** 冲突草稿里的字段名投影——与各设置控件同一组标签（含外观组的 Esc 菜单、数据组的缓存策略）。 */
const FIELD_LABELS: Record<keyof DesktopConfigValues, string> = {
  announcementsCheckPolicy: '公告检查',
  confirmContentLinks: '内容外链确认',
  escapeMenuEnabled: 'Esc 快捷菜单',
  publicCacheCaptureEnabled: '缓存公开资料',
  publicCacheMaxBytes: '缓存大小上限',
  publicCacheWhenFull: '缓存满额策略',
};

export const DesktopConfigFeedback = () => {
  const { state, editable, reapplyConflictedDraft, discardConflictedDraft } = useDesktopConfig();
  const busy = state.saving || state.status === 'loading';
  const conflicted = state.conflictedFields ?? [];

  if (state.saveError === null && conflicted.length === 0) return null;

  return (
    <div className="sticky top-2 z-20 mx-auto w-full max-w-3xl px-4 pt-4">
      <div
        role="alert"
        data-testid="config-feedback"
        className="rounded-md border border-(--app-border) bg-(--app-surface) p-3 shadow-md"
      >
        {state.saveError ? (
          <p className="text-xs text-(--app-accent-strong)">{state.saveError}</p>
        ) : null}
        {conflicted.length > 0 ? (
          <div data-testid="config-conflicted-draft">
            <p className="text-xs text-(--app-text)">
              配置文件已在应用外被修改，以下修改未写入：
              {conflicted.map((field) => FIELD_LABELS[field]).join('、')}。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!editable || busy}
                onClick={reapplyConflictedDraft}
              >
                基于最新内容重新应用
              </button>
              <button
                type="button"
                className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={discardConflictedDraft}
              >
                放弃修改
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
