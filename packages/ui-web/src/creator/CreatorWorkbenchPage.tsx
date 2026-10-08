import type { Key, ReactNode } from 'react';

import { CreatorMainStage } from './CreatorMainStage';
import { CreatorOverviewCard } from './CreatorOverviewCard';
import { CreatorSidebar } from './CreatorSidebar';
import { CreatorWorkbenchLayout } from './CreatorWorkbenchLayout';

type CreatorWorkbenchPageProps = {
  layoutMode: 'desktop' | 'mobile';
  sidebarResetKey?: Key;
  sidebarStage: 'intro' | 'questionnaire' | 'result';
  mainStage: 'status' | 'intro' | 'questionnaire' | 'result';
  overviewStageLabel: string;
  progressLabel: string;
  templateLabel: string;
  primaryRuleLabel: string;
  nativeHint: string;
  configuration: ReactNode;
  buildRules?: ReactNode;
  advanced: ReactNode;
  mainTopContent?: ReactNode;
  mainTitle?: string;
  mainContent: ReactNode;
  showFooter?: boolean;
  /** 页脚由宿主注入（Web 传 Footer，Desktop 传壳层页脚）；缺省不渲染。 */
  footer?: ReactNode;
  overlayContent?: ReactNode;
};

export function CreatorWorkbenchPage({
  layoutMode,
  sidebarResetKey,
  sidebarStage,
  mainStage,
  overviewStageLabel,
  progressLabel,
  templateLabel,
  primaryRuleLabel,
  nativeHint,
  configuration,
  buildRules,
  advanced,
  mainTopContent,
  mainTitle,
  mainContent,
  showFooter = false,
  footer,
  overlayContent,
}: CreatorWorkbenchPageProps) {
  return (
    <div className="magic-background">
      <CreatorWorkbenchLayout
        layoutMode={layoutMode}
        sidebar={(
          <CreatorSidebar
            key={sidebarResetKey}
            layoutMode={layoutMode}
            stage={sidebarStage}
            overview={(
              <CreatorOverviewCard
                stageLabel={overviewStageLabel}
                progressLabel={progressLabel}
                templateLabel={templateLabel}
                primaryRuleLabel={primaryRuleLabel}
                nativeHint={nativeHint}
              />
            )}
            configuration={configuration}
            buildRules={buildRules}
            advanced={advanced}
          />
        )}
        main={<CreatorMainStage stage={mainStage} title={mainTitle} topContent={mainTopContent} content={mainContent} />}
      />
      {showFooter ? footer : null}
      {overlayContent}
    </div>
  );
}
