import type { ReactNode } from 'react';

export interface ScenarioResultSurfaceProps {
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * 情景结果的语义表面：复用共源 card 的背景、边框、阴影、圆角与响应式内边距。
 *
 * 在每个真实结果/编辑器边界使用一次，不包裹 ScenarioPageLayout 的整个 results
 * 插槽；结构化结果、通用卡编辑器、推理与导航仍由宿主分别装配。
 */
export function ScenarioResultSurface({ label, children }: ScenarioResultSurfaceProps) {
  return (
    <section aria-label={label} data-testid="scenario-result-surface" className="card mt-6">
      {children}
    </section>
  );
}
