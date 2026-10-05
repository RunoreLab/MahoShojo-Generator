// canonical 实现在 @mahoshojo/ui-web/character-card；本文件是 Web 宿主包装。
import React, { useMemo } from 'react';

import {
  GeneralCharacterCard as SharedGeneralCharacterCard,
  type GeneralCharacterCardProps as SharedGeneralCharacterCardProps,
} from '@mahoshojo/ui-web/character-card';
import { WEB_SNAPDOM_MEDIA } from '@mahoshojo/ui-web/client';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';
import { buildCharacterParameterView } from '@/lib/creator/character-parameter-view';

export type { GeneralCharacterDetails } from '@mahoshojo/ui-web/character-card';

type GeneralCharacterCardProps = Omit<SharedGeneralCharacterCardProps, 'Markdown' | 'generatedByBadge' | 'captureMediaAdapter' | 'parameterView'>;

const GeneralCharacterCard: React.FC<GeneralCharacterCardProps> = ({ general, ...rest }) => {
  const parameterView = useMemo(
    () =>
      buildCharacterParameterView({
        creationInputs: general?.creationInputs,
        buildState: general?.buildState,
      }),
    [general]
  );

  return (
    <SharedGeneralCharacterCard
      general={general}
      parameterView={parameterView}
      Markdown={MarkdownBlock}
      generatedByBadge={<GeneratedByUserBadge variant="dark" className="mt-3" />}
      captureMediaAdapter={WEB_SNAPDOM_MEDIA}
      {...rest}
    />
  );
};

export default GeneralCharacterCard;
