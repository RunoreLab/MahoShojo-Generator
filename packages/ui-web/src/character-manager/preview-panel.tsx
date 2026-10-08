import type { ReactNode } from 'react';

/** 完整预览独立于编辑卡片；宿主保持加载/草稿仲裁条件与可用生成能力。 */
export function CharacterManagerPreviewPanel({ children, title = '角色卡片预览' }: { children: ReactNode; title?: string }) {
  return <section className="card mt-6" aria-label={title}>
    <h3 className="text-xl font-bold text-gray-800 text-center mb-4">{title}</h3>
    {children}
  </section>;
}
