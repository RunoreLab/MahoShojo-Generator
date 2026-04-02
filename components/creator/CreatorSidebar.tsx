import type { ReactNode } from 'react';

import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

type CreatorSidebarProps = {
  layoutMode: 'desktop' | 'mobile';
  stage: 'intro' | 'questionnaire' | 'result';
  overview: ReactNode;
  configuration: ReactNode;
  buildRules?: ReactNode;
  advanced: ReactNode;
};

const MOBILE_OPEN_BY_STAGE = {
  intro: {
    overview: true,
    configuration: true,
    buildRules: false,
    advanced: true,
  },
  questionnaire: {
    overview: true,
    configuration: false,
    buildRules: false,
    advanced: false,
  },
  result: {
    overview: true,
    configuration: false,
    buildRules: false,
    advanced: false,
  },
} as const;

export function CreatorSidebar({
  layoutMode,
  stage,
  overview,
  configuration,
  buildRules,
  advanced,
}: CreatorSidebarProps) {
  const isMobile = layoutMode === 'mobile';
  const defaults = MOBILE_OPEN_BY_STAGE[stage];

  return (
    <div className="space-y-4" data-creator-sidebar-stage={stage}>
      <div data-group="overview" data-default-open={String(isMobile ? defaults.overview : true)}>
        <CollapsibleSection title="创作概况" defaultOpen={isMobile ? defaults.overview : true} keepMounted>
          {overview}
        </CollapsibleSection>
      </div>
      <div data-group="configuration" data-default-open={String(isMobile ? defaults.configuration : true)}>
        <CollapsibleSection title="创作配置" defaultOpen={isMobile ? defaults.configuration : true} keepMounted>
          {configuration}
        </CollapsibleSection>
      </div>
      {buildRules ? (
        <div data-group="build-rules" data-default-open={String(isMobile ? defaults.buildRules : true)}>
          <CollapsibleSection title="车卡规则" defaultOpen={isMobile ? defaults.buildRules : true} keepMounted>
            {buildRules}
          </CollapsibleSection>
        </div>
      ) : null}
      <div data-group="advanced" data-default-open={String(isMobile ? defaults.advanced : false)}>
        <CollapsibleSection title="高级生成" defaultOpen={isMobile ? defaults.advanced : false} keepMounted>
          {advanced}
        </CollapsibleSection>
      </div>
    </div>
  );
}
