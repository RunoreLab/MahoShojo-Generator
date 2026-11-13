import { useEffect, useMemo, useRef, useState } from 'react';

import { getMainColorGradient, MainColor, type MainColorKey } from '@mahoshojo/domain/main-color';

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
  CharacterCardCommonProps,
  CharacterParameterSourceKey,
  GeneralCharacterCardData,
} from './types';

export interface GeneralCharacterCardProps extends CharacterCardCommonProps {
  general: GeneralCharacterCardData;
}

const ENGLISH_COLOR_KEYWORDS: Record<string, MainColorKey> = {
  red: 'Red',
  crimson: 'Red',
  scarlet: 'Red',
  orange: 'Orange',
  amber: 'Orange',
  cyan: 'Cyan',
  teal: 'Cyan',
  blue: 'Blue',
  navy: 'Blue',
  violet: 'Purple',
  purple: 'Purple',
  pink: 'Pink',
  rose: 'Pink',
  yellow: 'Yellow',
  gold: 'Yellow',
  green: 'Green',
  emerald: 'Green',
};

const detectColorFromContent = (content?: string): MainColorKey => {
  if (!content) return 'Pink';
  for (const [key, label] of Object.entries(MainColor) as [MainColorKey, string][]) {
    if (content.includes(label)) {
      return key;
    }
  }

  const lower = content.toLowerCase();
  for (const [keyword, color] of Object.entries(ENGLISH_COLOR_KEYWORDS)) {
    if (lower.includes(keyword)) {
      return color;
    }
  }

  return 'Pink';
};

export function GeneralCharacterCard({
  general,
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
  captureExportGuard,
  titleImageSrc = '/questionnaire-title.svg',
  titleImageAlt = '通用角色档案',
  titleImageVariant = 'fluid',
  qrCodeLogoSrc = '/logo-white-qrcode.svg',
}: GeneralCharacterCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [parameterSourceKey, setParameterSourceKey] = useState<CharacterParameterSourceKey>(
    parameterView?.activeSource ?? 'current'
  );
  const labelClassName = 'text-sm opacity-90';

  const { isSavingImage, isExportingImage, handleSaveImage } = useCardImageSave({
    cardRef,
    isStreaming,
    imageSaveMode,
    onSaveImage,
    mediaAdapter: captureMediaAdapter,
    captureExportGuard,
    blockWhenStreaming: true,
    resolveFileName: () =>
      `通用角色_${(general?.name || '未命名角色').replace(/[^a-z0-9一-龥]/gi, '_')}.png`,
  });

  const displayContent =
    general?.content?.trim()
      ? general.content.trim()
      : isStreaming
        ? '正在启动流式生成…'
        : '（content 字段为空，建议补充完整的角色设定，包括外观、能力、背景。）';

  const gradientStyle = useMemo(() => {
    const colors = getMainColorGradient(detectColorFromContent(general?.content));
    return `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
  }, [general]);

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
      ref={cardRef}
      className="result-card"
      style={{ background: gradientStyle }}
    >
      <div className="result-content">
        <div className="flex justify-center">
          {titleImageVariant === 'svg' ? (
            <img src={titleImageSrc} width={300} height={70} alt={titleImageAlt} style={{ display: 'block', background: 'transparent' }} />
          ) : (
            <img src={titleImageSrc} alt={titleImageAlt} className="w-72 mb-4" />
          )}
        </div>

        <PortraitBlock portraitAsset={portraitAsset} subjectName={general?.name} />

        <div className="result-item">
          <InlineField
            label="角色名称"
            content={general?.name || '未命名角色'}
            labelClassName={labelClassName}
            contentClassName="text-2xl font-bold text-white drop-shadow"
            readingHeading="2"
            contentStyle={{ letterSpacing: '0.08em' }}
            Markdown={Markdown}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="角色设定"
            content={displayContent}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            className={isStreaming ? 'inline-block' : undefined}
            Markdown={Markdown}
          />
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-white/70 animate-pulse align-middle ml-1" />
          )}
        </div>

        {parameterView ? (
          <CharacterParameterSection
            view={parameterView}
            sourceKey={parameterSourceKey}
            renderMode={isExportingImage ? 'export' : 'interactive'}
            onChangeSource={setParameterSourceKey}
          />
        ) : null}

        <CurrentStatePanel state={general?.current_state} variant="dark" Markdown={Markdown} />

        <ArenaHistoryBlock history={general?.arena_history} Markdown={Markdown} />

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

export default GeneralCharacterCard;
