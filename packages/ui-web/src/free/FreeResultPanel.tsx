import type { ReactNode } from 'react';

/** 只共享结果展示容器；卡片解析、保存目标和副作用由宿主保留。 */
export function FreeResultPanel({ title, children, label }: { title: ReactNode; children: ReactNode; label?: string }) {
  const Container = label ? 'section' : 'div';
  return (
    <Container className="card !max-w-none" aria-label={label}>
      <h2 className="text-2xl font-bold text-center mb-4">{title}</h2>
      {children}
    </Container>
  );
}

/** 保存动作与容量提示的共同排版，不猜测云端/本地保存能力或限额。 */
export function FreeResultActions({ children, sizeIndicator }: { children: ReactNode; sizeIndicator: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-3 justify-center">{children}</div>
      {sizeIndicator}
    </div>
  );
}

export function FreeJsonResult({ data }: { data: unknown }) {
  return <div className="rounded-lg bg-gray-100 p-4 border border-gray-200 font-mono text-xs overflow-x-auto"><pre>{JSON.stringify(data, null, 2)}</pre></div>;
}
