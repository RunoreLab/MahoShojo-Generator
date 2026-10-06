import { useState } from 'react';

import { CANSHOU_LORE } from '@mahoshojo/domain/canshou-lore';

/**
 * 残兽设定说明折叠面板：展示 `CANSHOU_LORE` 全文。
 *
 * 自 Web `CanshouPage` 结果区段上移（D5.1-G1）：主题按宿主注入，
 * Web 保持浅色 `card` 观感，Desktop 走 app-token 主题。
 */

export interface CanshouLorePanelTheme {
  panel: string;
  toggleButton: string;
  body: string;
}

/** Web `/canshou` 现行浅色 card 主题（原样保留页面观感）。 */
export const CANSHOU_LORE_PANEL_WEB_THEME: CanshouLorePanelTheme = {
  panel: 'card',
  toggleButton: 'text-lg font-medium text-gray-800 w-full text-left',
  body: 'mt-4 text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-100 p-4 rounded-lg',
};

/** Desktop app-token 主题。 */
export const CANSHOU_LORE_PANEL_APP_THEME: CanshouLorePanelTheme = {
  panel: 'card',
  toggleButton: 'text-lg font-medium text-(--app-text) w-full text-left',
  body: 'mt-4 text-sm text-(--app-text) whitespace-pre-wrap font-mono bg-(--app-surface) p-4 rounded-lg',
};

export interface CanshouLorePanelProps {
  theme?: CanshouLorePanelTheme;
  /** 设定全文；缺省为 domain 内置 `CANSHOU_LORE`。 */
  loreText?: string;
  title?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CanshouLorePanel({
  theme = CANSHOU_LORE_PANEL_WEB_THEME,
  loreText = CANSHOU_LORE,
  title = '残兽设定说明',
  open: openProp,
  onOpenChange,
}: CanshouLorePanelProps) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  return (
    <div className={theme.panel}>
      <button type="button" onClick={() => setOpen(!open)} className={theme.toggleButton}>
        {open ? '▼ ' : '▶ '}{title}
      </button>
      {open && <div className={theme.body}>{loreText}</div>}
    </div>
  );
}
