import type { ReactNode } from 'react';

import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

type CreatorSidebarProps = {
  layoutMode: 'desktop' | 'mobile';
  stage: 'intro' | 'questionnaire' | 'result';
  overview: ReactNode;
  configuration: ReactNode;
  questionnaire: ReactNode;
  advanced: ReactNode;
};

const MOBILE_OPEN_BY_STAGE = {
  intro: {
    overview: true,
    configuration: true,
    questionnaire: false,
    advanced: false,
  },
  questionnaire: {
    overview: true,
    configuration: false,
    questionnaire: true,
    advanced: false,
  },
  result: {
    overview: true,
    configuration: false,
    questionnaire: false,
    advanced: false,
  },
} as const;

export function CreatorSidebar({
  layoutMode,
  stage,
  overview,
  configuration,
  questionnaire,
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
      <div data-group="questionnaire" data-default-open={String(isMobile ? defaults.questionnaire : true)}>
        <CollapsibleSection title="问卷与作答" defaultOpen={isMobile ? defaults.questionnaire : true} keepMounted>
          {questionnaire}
        </CollapsibleSection>
      </div>
      <div data-group="advanced" data-default-open={String(isMobile ? defaults.advanced : false)}>
        <CollapsibleSection title="高级生成" defaultOpen={isMobile ? defaults.advanced : false} keepMounted>
          {advanced}
        </CollapsibleSection>
      </div>
    </div>
  );
}
