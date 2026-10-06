import type { CSSProperties, ReactNode } from 'react';

/**
 * `/details` 结果区的保存方式偏好面板（DESK-PARITY-004）。
 *
 * 两组二选一：设定长图保存方式（一键下载 / 长按保存弹窗）与
 * 设定文件保存方式（直接下载 JSON / 复制原始数据）。每种模式的「推荐」
 * 徽标由宿主按设备类型解析后注入——Web 按 UA 探测，Desktop 固定
 * 桌面口径。模式取值与持久化都归宿主管，组件只是受控视图。
 */

export type DetailsImageSaveMode = 'download' | 'modal';
export type DetailsJsonSaveMode = 'download' | 'text';

export interface DetailsSavePreferencesTheme {
  panel: string;
  groupTitle: string;
  groupMeta: string;
  optionsRow: string;
  optionButton: string;
  optionButtonActive: string;
  recommendedBadge: string;
  hintText: string;
  footerText: string;
}

/** Web `/details` 现行 indigo/slate 主题（原样保留页面观感）。 */
export const DETAILS_SAVE_PREFERENCES_THEME: DetailsSavePreferencesTheme = {
  panel: 'card',
  groupTitle: 'font-medium text-gray-800',
  groupMeta: 'text-xs text-gray-500',
  optionsRow: 'flex flex-col sm:flex-row gap-2 mt-2',
  optionButton: 'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600',
  optionButtonActive: 'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm',
  recommendedBadge: 'ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 text-[10px] font-semibold text-indigo-600',
  hintText: 'mt-2 text-xs text-gray-500',
  footerText: 'text-xs text-gray-400 text-center',
};

/** Desktop app-token 主题。 */
export const APP_SAVE_PREFERENCES_THEME: DetailsSavePreferencesTheme = {
  panel: 'card',
  groupTitle: 'font-medium text-(--app-text)',
  groupMeta: 'text-xs text-(--app-text-subtle)',
  optionsRow: 'flex flex-col sm:flex-row gap-2 mt-2',
  optionButton: 'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition border-(--app-border) text-(--app-text-muted) hover:border-(--app-accent-strong) hover:text-(--app-accent-strong)',
  optionButtonActive: 'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition border-(--app-accent-strong) bg-(--app-surface-80) text-(--app-accent-strong) shadow-sm',
  recommendedBadge: 'ml-2 inline-flex items-center rounded-full bg-(--app-surface-80) px-2 text-[10px] font-semibold text-(--app-accent-strong)',
  hintText: 'mt-2 text-xs text-(--app-text-subtle)',
  footerText: 'text-xs text-(--app-text-subtle) text-center',
};

export interface DetailsSavePreferencesPanelProps {
  theme?: DetailsSavePreferencesTheme;
  imageSaveMode: DetailsImageSaveMode;
  jsonSaveMode: DetailsJsonSaveMode;
  recommendedImageMode: DetailsImageSaveMode;
  recommendedJsonMode: DetailsJsonSaveMode;
  onImageSaveModeChange: (mode: DetailsImageSaveMode) => void;
  onJsonSaveModeChange: (mode: DetailsJsonSaveMode) => void;
  /** 缺省时显示 Web 口径的默认提示。 */
  imageHint?: ReactNode;
  jsonHint?: ReactNode;
  footerNote?: ReactNode;
  style?: CSSProperties;
}

function PreferenceOption({
  active,
  recommended,
  onClick,
  children,
  theme,
}: {
  active: boolean;
  recommended: boolean;
  onClick: () => void;
  children: ReactNode;
  theme: DetailsSavePreferencesTheme;
}) {
  return (
    <button
      type="button"
      className={active ? theme.optionButtonActive : theme.optionButton}
      onClick={onClick}
    >
      {children}
      {recommended && <span className={theme.recommendedBadge}>推荐</span>}
    </button>
  );
}

export function DetailsSavePreferencesPanel({
  theme = DETAILS_SAVE_PREFERENCES_THEME,
  imageSaveMode,
  jsonSaveMode,
  recommendedImageMode,
  recommendedJsonMode,
  onImageSaveModeChange,
  onJsonSaveModeChange,
  imageHint,
  jsonHint,
  footerNote,
  style,
}: DetailsSavePreferencesPanelProps) {
  return (
    <div className={theme.panel} style={{ marginTop: '1rem', ...style }}>
      <div className="space-y-5 text-left">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className={theme.groupTitle}>设定长图保存方式</span>
            <span className={theme.groupMeta}>
              推荐：{recommendedImageMode === 'download' ? '一键下载' : '长按保存弹窗'}
            </span>
          </div>
          <div className={theme.optionsRow}>
            <PreferenceOption
              active={imageSaveMode === 'download'}
              recommended={recommendedImageMode === 'download'}
              onClick={() => onImageSaveModeChange('download')}
              theme={theme}
            >
              一键下载长图
            </PreferenceOption>
            <PreferenceOption
              active={imageSaveMode === 'modal'}
              recommended={recommendedImageMode === 'modal'}
              onClick={() => onImageSaveModeChange('modal')}
              theme={theme}
            >
              长按保存弹窗
            </PreferenceOption>
          </div>
          <p className={theme.hintText}>
            {imageHint ?? '若当前浏览器不支持下载，可切换为长按模式，系统会弹出预览供保存。'}
          </p>
        </div>
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className={theme.groupTitle}>设定文件保存方式</span>
            <span className={theme.groupMeta}>
              推荐：{recommendedJsonMode === 'download' ? '直接下载 JSON' : '复制原始数据'}
            </span>
          </div>
          <div className={theme.optionsRow}>
            <PreferenceOption
              active={jsonSaveMode === 'download'}
              recommended={recommendedJsonMode === 'download'}
              onClick={() => onJsonSaveModeChange('download')}
              theme={theme}
            >
              直接下载 JSON
            </PreferenceOption>
            <PreferenceOption
              active={jsonSaveMode === 'text'}
              recommended={recommendedJsonMode === 'text'}
              onClick={() => onJsonSaveModeChange('text')}
              theme={theme}
            >
              复制原始数据
            </PreferenceOption>
          </div>
          <p className={theme.hintText}>
            {jsonHint ?? '两种方式可随时切换，移动端也可尝试直接下载，桌面端亦能复制备用。'}
          </p>
        </div>
        <p className={theme.footerText}>
          {footerNote ?? '提示：偏好设置已保存到浏览器，刷新后仍会保留；切换不会丢失生成结果。'}
        </p>
      </div>
    </div>
  );
}
