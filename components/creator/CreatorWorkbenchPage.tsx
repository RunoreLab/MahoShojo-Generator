import type { Key, ReactNode } from 'react';

import Footer from '@/components/Footer';

import { CreatorMainStage } from '@/components/creator/CreatorMainStage';
import { CreatorOverviewCard } from '@/components/creator/CreatorOverviewCard';
import { CreatorSidebar } from '@/components/creator/CreatorSidebar';
import { CreatorWorkbenchLayout } from '@/components/creator/CreatorWorkbenchLayout';

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
      {showFooter ? <Footer textWhite={true} /> : null}
      {overlayContent}
    </div>
  );
}
