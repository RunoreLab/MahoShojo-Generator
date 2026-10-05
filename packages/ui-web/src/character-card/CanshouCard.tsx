import { useEffect, useRef, useState } from 'react';

import { MarkdownBlock as SharedMarkdownBlock } from '../markdown';
import { CharacterParameterSection } from './CharacterParameterSection';
import { CurrentStatePanel } from './CurrentStatePanel';
import { InlineField } from './InlineField';
import {
  ArenaHistoryBlock,
  CardSaveButton,
  LogoPlaceholder,
  PortraitBlock,
  useCardImageSave,
} from './internals';
import type {
  CanshouDetails,
  CharacterCardCommonProps,
  CharacterParameterSourceKey,
} from './types';

export interface CanshouCardProps extends CharacterCardCommonProps {
  canshou: CanshouDetails;
}

export function CanshouCard({
  canshou,
  isStreaming = false,
  onStopGeneration,
  onSaveImage,
  imageSaveMode = 'auto',
  saveButtonLabel,
  portraitAsset = null,
  parameterView = null,
  Markdown = SharedMarkdownBlock,
  generatedByBadge,
  captureMediaAdapter,
  titleImageSrc = '/beast-title.svg',
  titleImageAlt = '残兽档案',
  titleImageVariant = 'fluid',
  qrCodeLogoSrc = '/logo-white-qrcode.svg',
}: CanshouCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [parameterSourceKey, setParameterSourceKey] = useState<CharacterParameterSourceKey>(
    parameterView?.activeSource ?? 'current'
  );
  const labelClassName = 'text-sm opacity-90';

  const { isSavingImage, isExportingImage, handleSaveImage } = useCardImageSave({
    cardRef,
    imageSaveMode,
    onSaveImage,
    mediaAdapter: captureMediaAdapter,
    resolveFileName: () =>
      `残兽档案_${canshou.name.replace(/[^a-z0-9一-龥]/gi, '_')}.png`,
  });

  useEffect(() => {
    setParameterSourceKey((currentSourceKey) => {
      if (!parameterView) return 'current';
      return parameterView.sources.some((source) => source.key === currentSourceKey)
        ? currentSourceKey
        : parameterView.activeSource;
    });
  }, [parameterView]);

  return (
    <div ref={cardRef} className="result-card" style={{ background: 'linear-gradient(135deg, #434343 0%, #000000 100%)' }}>
      <div className="result-content">
        <div className="flex justify-center">
          {titleImageVariant === 'svg' ? (
            <img src={titleImageSrc} width={300} height={70} alt={titleImageAlt} style={{ display: 'block', background: 'transparent' }} />
          ) : (
            <img src={titleImageSrc} alt={titleImageAlt} className="w-72 mb-4" />
          )}
        </div>

        <PortraitBlock portraitAsset={portraitAsset} subjectName={canshou.name} />

        <div className="result-item">
          <InlineField label="名称" content={canshou.name} labelClassName={labelClassName} Markdown={Markdown} />
        </div>

        <div className="flex">
          <div className="result-item w-full mr-4">
            <InlineField
              label="核心概念"
              content={canshou.coreConcept}
              labelClassName={labelClassName}
              contentClassName="text-sm"
              Markdown={Markdown}
            />
          </div>
          <div className="result-item w-full">
            <InlineField
              label="核心情感/欲望"
              content={canshou.coreEmotion}
              labelClassName={labelClassName}
              contentClassName="text-sm"
              Markdown={Markdown}
            />
          </div>
        </div>

        <div className="result-item">
          <InlineField
            label="进化阶段"
            content={canshou.evolutionStage}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            Markdown={Markdown}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="外貌描述"
            content={canshou.appearance}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            Markdown={Markdown}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="材质/表皮"
            content={canshou.materialAndSkin}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            Markdown={Markdown}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="特征/附属物"
            content={canshou.featuresAndAppendages}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            Markdown={Markdown}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="攻击方式"
            content={canshou.attackMethod}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            Markdown={Markdown}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="特殊能力"
            content={canshou.specialAbility}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            Markdown={Markdown}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="起源"
            content={canshou.origin}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            Markdown={Markdown}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="诞生环境"
            content={canshou.birthEnvironment}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            Markdown={Markdown}
          />
        </div>

        <div className="result-item border-l-4 border-red-400">
          <InlineField
            label="研究员笔记"
            content={canshou.researcherNotes}
            labelClassName={labelClassName}
            contentClassName="text-sm italic"
            Markdown={Markdown}
          />
        </div>

        {parameterView ? (
          <CharacterParameterSection
            view={parameterView}
            sourceKey={parameterSourceKey}
            renderMode={isExportingImage ? 'export' : 'interactive'}
            onChangeSource={setParameterSourceKey}
          />
        ) : null}

        <CurrentStatePanel state={canshou.current_state} variant="dark" Markdown={Markdown} />

        <ArenaHistoryBlock history={canshou.arena_history} Markdown={Markdown} />

        <CardSaveButton
          isStreaming={isStreaming}
          onStopGeneration={onStopGeneration}
          isSavingImage={isSavingImage}
          saveButtonLabel={saveButtonLabel}
          onSaveImageClick={handleSaveImage}
        />

        <LogoPlaceholder qrCodeLogoSrc={qrCodeLogoSrc} generatedByBadge={generatedByBadge} />
      </div>
    </div>
  );
}

export default CanshouCard;
