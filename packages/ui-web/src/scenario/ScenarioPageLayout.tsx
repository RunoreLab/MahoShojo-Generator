import type { ReactNode } from 'react';
import { EncyclopediaLinks } from '../encyclopedia/views/EncyclopediaLinks';

export interface ScenarioPageLayoutProps {
  readonly controls: ReactNode;
  readonly results?: ReactNode;
  readonly footer?: ReactNode;
  readonly onNavigate: (href: string) => void;
  readonly resolveInternalHref?: (href: string) => string;
}

/** 箱庭物语的品牌、单列页框与结果位置；语义结果边界由宿主使用 ScenarioResultSurface 装配。 */
export function ScenarioPageLayout({ controls, results, footer, onNavigate, resolveInternalHref }: ScenarioPageLayoutProps) {
  return (
    <div data-testid="page-scenario" className="magic-background-white">
      <div className="container">
        <div className="card">
          <div className="text-center mb-4">
            <div className="flex justify-center items-center" style={{ marginBottom: '1rem' }}>
              <img src="/scenario-shadow.webp" width={360} height={40} alt="箱庭物语" />
            </div>
            <p className="subtitle mt-2">情景生成器，创建独一无二的舞台，上演属于你的故事</p>
            <EncyclopediaLinks
              items={[
                { slug: 'scenario-generator', text: '百科：箱庭物语（情景生成器）' },
                { slug: 'scenario-advanced', text: '百科：情景卡进阶（继承与长线）' },
              ]}
              onNavigate={onNavigate}
              resolveInternalHref={resolveInternalHref}
            />
          </div>
          {controls}
        </div>
        {results}
      </div>
      {footer}
    </div>
  );
}
