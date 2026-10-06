import type { ReactNode } from 'react';

import { ThemeImage } from '../media/ThemeImage';

export interface CharacterManagerPageHeaderProps {
  /** 亮色主题 logo；默认 `/character-manager.svg`。 */
  readonly lightSrc?: string;
  /** 暗色主题 logo；默认 `/character-manager-white.svg`。 */
  readonly darkSrc?: string;
  readonly alt?: string;
  readonly subtitle?: ReactNode;
  /** 副标题下方的整宽提示条（Web：账号迁移期警告）。 */
  readonly notice?: ReactNode;
  /** 账户面板等宿主内容——保持与 Web 相同的 `text-center mb-4` 分区内位置。 */
  readonly children?: ReactNode;
}

/**
 * 角色管理页头部区段：产品 logo、副标题、宿主提示与账户区插槽。
 * 与 Web `CharacterManagerPage` 的 `text-center mb-4` 块一一对应。
 */
export function CharacterManagerPageHeader({
  lightSrc = '/character-manager.svg',
  darkSrc = '/character-manager-white.svg',
  alt = '角色数据管理',
  subtitle = '在这里查看、编辑和维护你的角色档案',
  notice,
  children,
}: CharacterManagerPageHeaderProps) {
  return (
    <div className="text-center mb-4">
      <div className="flex justify-center items-center mt-4" style={{ marginBottom: '1rem' }}>
        <ThemeImage lightSrc={lightSrc} darkSrc={darkSrc} width={320} height={40} alt={alt} />
      </div>
      <p className="subtitle mt-2">{subtitle}</p>
      {notice}
      {children}
    </div>
  );
}
