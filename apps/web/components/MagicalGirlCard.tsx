// components/MagicalGirlCard.tsx
// canonical 实现在 @mahoshojo/ui-web/character-card；本文件是 Web 宿主包装：
// 注入 Web 的 MarkdownBlock（百科链接/媒体策略）、GeneratedByUserBadge、
// WEB_SNAPDOM_MEDIA 截图媒体策略，并用 buildCharacterParameterView 计算参数区。
import React, { useMemo } from 'react';

import {
  MagicalGirlCard as SharedMagicalGirlCard,
  type MagicalGirlCardProps as SharedMagicalGirlCardProps,
} from '@mahoshojo/ui-web/character-card';
import { WEB_SNAPDOM_MEDIA } from '@mahoshojo/ui-web/client';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';
import { buildCharacterParameterView } from '@/lib/creator/character-parameter-view';

type MagicalGirlCardProps = Omit<SharedMagicalGirlCardProps, 'Markdown' | 'generatedByBadge' | 'captureMediaAdapter' | 'parameterView'>;

const MagicalGirlCard: React.FC<MagicalGirlCardProps> = ({ magicalGirl, ...rest }) => {
  const parameterView = useMemo(
    () =>
      buildCharacterParameterView({
        creationInputs: magicalGirl?.creationInputs,
        buildState: magicalGirl?.buildState,
      }),
    [magicalGirl]
  );

  return (
    <SharedMagicalGirlCard
      magicalGirl={magicalGirl}
      parameterView={parameterView}
      Markdown={MarkdownBlock}
      generatedByBadge={<GeneratedByUserBadge variant="dark" className="mt-3" />}
      captureMediaAdapter={WEB_SNAPDOM_MEDIA}
      {...rest}
    />
  );
};

export default MagicalGirlCard;
