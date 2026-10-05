import { useEffect, useRef, useState } from 'react';

import { MarkdownBlock as SharedMarkdownBlock } from '../markdown';
import { MagicalGirlResultBody } from '../character-result';
import { CharacterParameterSection } from './CharacterParameterSection';
import { CurrentStatePanel } from './CurrentStatePanel';
import {
  ArenaHistoryBlock,
  CardSaveButton,
  LogoPlaceholder,
  PortraitBlock,
  useCardImageSave,
} from './internals';
import type {
  CharacterCardCommonProps,
  CharacterParameterSourceKey,
  MagicalGirlCardData,
} from './types';

export interface MagicalGirlCardProps extends CharacterCardCommonProps {
  magicalGirl: MagicalGirlCardData;
  gradientStyle: string;
}

export function MagicalGirlCard({
  magicalGirl,
  gradientStyle,
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
  titleImageSrc = '/questionnaire-title.svg',
  titleImageAlt = 'Logo',
  titleImageVariant = 'svg',
  qrCodeLogoSrc = '/logo-white-qrcode.svg',
}: MagicalGirlCardProps) {
  const resultRef = useRef<HTMLDivElement>(null);
  const [parameterSourceKey, setParameterSourceKey] = useState<CharacterParameterSourceKey>(
    parameterView?.activeSource ?? 'current'
  );

  const { isSavingImage, isExportingImage, handleSaveImage } = useCardImageSave({
    cardRef: resultRef,
    imageSaveMode,
    onSaveImage,
    mediaAdapter: captureMediaAdapter,
    resolveFileName: () =>
      `魔法少女_${magicalGirl.codename.replace(/[^a-z0-9一-龥]/gi, '_')}.png`,
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
    <div
      ref={resultRef}
      className="result-card"
      style={{ background: gradientStyle }}
    >
      <div className="result-content">
        <div className="flex justify-center items-center" style={{ marginBottom: '1rem', background: 'transparent' }}>
          {titleImageVariant === 'svg' ? (
            <img src={titleImageSrc} width={300} height={70} alt={titleImageAlt} style={{ display: 'block', background: 'transparent' }} />
          ) : (
            <img src={titleImageSrc} alt={titleImageAlt} className="w-72 mb-4" />
          )}
        </div>

        <PortraitBlock portraitAsset={portraitAsset} subjectName={magicalGirl.codename} />

        <MagicalGirlResultBody
          magicalGirl={magicalGirl}
          renderMarkdown={(content) => <Markdown content={content} variant="dark" mode="compact" />}
        />

        {parameterView ? (
          <CharacterParameterSection
            view={parameterView}
            sourceKey={parameterSourceKey}
            renderMode={isExportingImage ? 'export' : 'interactive'}
            onChangeSource={setParameterSourceKey}
          />
        ) : null}

        <CurrentStatePanel state={magicalGirl.current_state} variant="dark" Markdown={Markdown} />

        {/*
          健壮性口径：访问 .entries 前先确认 arena_history.entries 存在且为数组，
          防止数据格式不规范（如 arena_history 存在但 entries 缺失或不是数组）导致页面崩溃。
        */}
        <ArenaHistoryBlock
          history={magicalGirl.arena_history}
          Markdown={Markdown}
          resolveEntryBackground={() => {
            // 从 gradientStyle 中提取起始颜色，用作历战记录条目的背景
            const startColor = gradientStyle.startsWith('linear-gradient(to right, ')
              ? gradientStyle.split(', ')[1].trim()
              : 'rgba(0, 0, 0, 0.05)';
            return `${startColor}20`;
          }}
        />

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

export default MagicalGirlCard;
