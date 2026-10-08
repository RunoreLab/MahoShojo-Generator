import type { ReactNode } from 'react';

export interface LocalLibraryPageLayoutProps {
  readonly children: ReactNode;
  readonly notes?: ReactNode;
}

/** 本地库共同页框；备份、原生维护与浏览器存储状态通过 children/notes 注入。 */
export function LocalLibraryPageLayout({ children, notes }: LocalLibraryPageLayoutProps) {
  return (
    <section data-testid="page-local-library" className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">本地库</h1>
        <p className="text-sm text-(--app-text-muted)">本机保存的数据卡与 Web 包。它们只存在于这台设备，不会跨设备同步，也不需要登录。</p>
        {notes}
      </header>
      {children}
    </section>
  );
}
