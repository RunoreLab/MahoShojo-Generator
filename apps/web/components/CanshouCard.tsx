// components/CanshouCard.tsx
// canonical 实现在 @mahoshojo/ui-web/character-card；本文件是 Web 宿主包装。
import React, { useMemo } from 'react';

import {
  CanshouCard as SharedCanshouCard,
  type CanshouCardProps as SharedCanshouCardProps,
} from '@mahoshojo/ui-web/character-card';
import { WEB_SNAPDOM_MEDIA } from '@mahoshojo/ui-web/client';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';
import { buildCharacterParameterView } from '@/lib/creator/character-parameter-view';

export type { CanshouDetails } from '@mahoshojo/ui-web/character-card';

type CanshouCardProps = Omit<SharedCanshouCardProps, 'Markdown' | 'generatedByBadge' | 'captureMediaAdapter' | 'parameterView'>;

const CanshouCard: React.FC<CanshouCardProps> = ({ canshou, ...rest }) => {
  const parameterView = useMemo(
    () =>
      buildCharacterParameterView({
        creationInputs: canshou?.creationInputs,
        buildState: canshou?.buildState,
      }),
    [canshou]
  );

  return (
    <SharedCanshouCard
      canshou={canshou}
      parameterView={parameterView}
      Markdown={MarkdownBlock}
      generatedByBadge={<GeneratedByUserBadge variant="dark" className="mt-3" />}
      captureMediaAdapter={WEB_SNAPDOM_MEDIA}
      {...rest}
    />
  );
};

export default CanshouCard;
