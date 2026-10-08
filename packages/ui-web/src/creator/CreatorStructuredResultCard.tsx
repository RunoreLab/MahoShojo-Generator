import {
  CanshouCard,
  MagicalGirlCard,
  type CharacterCardPortraitAsset,
} from '../character-card';
import type { CreatorTemplateId } from '@mahoshojo/domain/creator/templates';

import { buildCharacterParameterView } from './character-parameter-view';

type CreatorStructuredResultCardProps = {
  template: CreatorTemplateId;
  result: any;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  saveButtonLabel?: string;
  portraitAsset?: CharacterCardPortraitAsset | null;
};

const MAGICAL_GIRL_GRADIENT = 'linear-gradient(135deg, #9775fa 0%, #b197fc 100%)';

/**
 * 创作工房结构化结果卡（D5.1-G3 上移共源）。
 * 角色参数视图由本组件依据结果中的 creationInputs/buildState 就地计算，
 * 不再依赖宿主包装层；其余宿主差异（Markdown/媒体适配等）由卡片自身缺省处理。
 */
export function CreatorStructuredResultCard({
  template,
  result,
  onSaveImage,
  imageSaveMode = 'auto',
  saveButtonLabel,
  portraitAsset = null,
}: CreatorStructuredResultCardProps) {
  const parameterView = buildCharacterParameterView({
    creationInputs: result?.creationInputs,
    buildState: result?.buildState,
  });
  if (template === 'canshou') {
    return (
      <CanshouCard
        canshou={result}
        parameterView={parameterView}
        onSaveImage={onSaveImage}
        imageSaveMode={imageSaveMode}
        saveButtonLabel={saveButtonLabel}
        portraitAsset={portraitAsset}
      />
    );
  }

  return (
    <MagicalGirlCard
      magicalGirl={result}
      gradientStyle={MAGICAL_GIRL_GRADIENT}
      parameterView={parameterView}
      onSaveImage={onSaveImage}
      imageSaveMode={imageSaveMode}
      saveButtonLabel={saveButtonLabel}
      portraitAsset={portraitAsset}
    />
  );
}
