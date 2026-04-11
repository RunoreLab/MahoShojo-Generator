// components/CanshouCard.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArenaHistory, ArenaHistoryEntry, CharacterCurrentState } from '@/types/arena';
import { CurrentStatePanel } from '@/components/CurrentStatePanel';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import { createBlobUrl, downloadBlob } from '@/lib/client/blobUrl';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';
import { InlineField } from '@/components/shared/InlineField';
import { CharacterParameterSection } from '@/components/shared/CharacterParameterSection';
import {
  buildCharacterParameterView,
  type CharacterParameterSourceKey,
} from '@/lib/creator/character-parameter-view';
import type { CharacterCardPortraitAsset } from '@/types/visual-asset';

export interface CanshouDetails {
  name: string;
  coreConcept: string;
  coreEmotion: string;
  evolutionStage: string;
  appearance: string;
  materialAndSkin: string;
  featuresAndAppendages: string;
  attackMethod: string;
  specialAbility: string;
  origin: string;
  birthEnvironment: string;
  researcherNotes: string;
  arena_history?: ArenaHistory;
  current_state?: CharacterCurrentState | null;
  creationInputs?: unknown;
  buildState?: unknown;
}

interface CanshouCardProps {
  canshou: CanshouDetails;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  saveButtonLabel?: string;
  portraitAsset?: CharacterCardPortraitAsset | null;
}

const waitForNextPaint = async () => {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return;
  }

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
};

const CanshouCard: React.FC<CanshouCardProps> = ({ canshou, onSaveImage, imageSaveMode = 'auto', saveButtonLabel, portraitAsset = null }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  // 新增：用于控制历战记录可见性的状态
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const parameterView = useMemo(
    () =>
      buildCharacterParameterView({
        creationInputs: canshou?.creationInputs,
        buildState: canshou?.buildState,
      }),
    [canshou]
  );
  const [parameterSourceKey, setParameterSourceKey] = useState<CharacterParameterSourceKey>(
    parameterView?.activeSource ?? 'current'
  );
  const [isExportingImage, setIsExportingImage] = useState(false);
  const labelClassName = 'text-sm opacity-90';
  const portraitImageUrl = typeof portraitAsset?.imageUrl === 'string' ? portraitAsset.imageUrl.trim() : '';
  const uploadedPortraitNote =
    portraitAsset?.source === 'uploaded'
      ? (typeof portraitAsset.note === 'string' && portraitAsset.note.trim() ? portraitAsset.note.trim() : '用户自行上传')
      : '';

  useEffect(() => {
    setParameterSourceKey((currentSourceKey) => {
      if (!parameterView) return 'current';
      return parameterView.sources.some((source) => source.key === currentSourceKey)
        ? currentSourceKey
        : parameterView.activeSource;
    });
  }, [parameterView]);

  /**
   * 截图残兽档案，并根据 imageSaveMode 决定保存方式。
   * auto 根据终端类型在弹窗与直接下载之间切换，其余模式强制执行对应策略。
   */
  const handleSaveImage = async () => {
    if (!cardRef.current) return;
    if (isSavingImage) return;

    const saveButton = cardRef.current.querySelector('.save-button') as HTMLElement;
    const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement;
    try {
      setIsSavingImage(true);
      flushSync(() => setIsExportingImage(true));
      await waitForNextPaint();
      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const blob = await capturePngBlob(cardRef.current, {
        scale: 1,
        dprMax: 2,
        fast: false,
        exclude: ['audio', 'video'],
        excludeMode: 'remove',
      });

      const resolvedMode: 'modal' | 'download' = imageSaveMode === 'modal' || imageSaveMode === 'download'
        ? imageSaveMode
        : (/Mobi/i.test(window.navigator.userAgent) ? 'modal' : 'download');
      const sanitizedTitle = canshou.name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
      const filename = `残兽档案_${sanitizedTitle}.png`;

      if (resolvedMode === 'modal') {
        const imageUrl = createBlobUrl(blob);
        if (onSaveImage) {
          onSaveImage(imageUrl);
        } else {
          const previewWindow = window.open(imageUrl, '_blank');
          if (!previewWindow) {
            alert('图片已生成，请长按或右键保存。');
          }
        }
      } else {
        downloadBlob(blob, filename);
      }
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error("Image generation failed:", err);
    } finally {
      flushSync(() => setIsExportingImage(false));
      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
      setIsSavingImage(false);
    }
  };

  return (
    <div ref={cardRef} className="result-card" style={{ background: 'linear-gradient(135deg, #434343 0%, #000000 100%)' }}>
      <div className="result-content">
	        <div className="flex justify-center">
	          <img
	            src="/beast-title.svg"
	            alt="残兽档案"
	            className="w-72 mb-4"
	          />
	        </div>

          {portraitImageUrl && (
            <div className="result-item" style={{ borderLeft: '4px solid #f9a8d4', background: 'rgba(0,0,0,0.2)' }}>
              <div className="result-label">🖼️ 角色立绘</div>
              <div className="result-value">
                <img
                  src={portraitImageUrl}
                  alt={`${canshou.name || '角色'} 立绘`}
                  className="w-full max-h-[560px] object-contain rounded-lg border border-white/15 bg-black/15"
                  loading="eager"
                  decoding="async"
                />
                {uploadedPortraitNote && (
                  <p className="mt-2 text-[11px] text-gray-300 text-right">
                    注：{uploadedPortraitNote}
                  </p>
                )}
              </div>
            </div>
          )}

	        <div className="result-item">
            <InlineField label="名称" content={canshou.name} labelClassName={labelClassName} />
	        </div>

        <div className="flex">
        <div className="result-item w-full mr-4">
          <InlineField
            label="核心概念"
            content={canshou.coreConcept}
            labelClassName={labelClassName}
            contentClassName="text-sm"
          />
        </div>
        <div className="result-item w-full">
          <InlineField
            label="核心情感/欲望"
            content={canshou.coreEmotion}
            labelClassName={labelClassName}
            contentClassName="text-sm"
          />
        </div>
      </div>

      <div className="result-item">
        <InlineField
          label="进化阶段"
          content={canshou.evolutionStage}
          labelClassName={labelClassName}
          contentClassName="text-sm"
        />
      </div>

      <div className="result-item">
        <InlineField
          label="外貌描述"
          content={canshou.appearance}
          labelClassName={labelClassName}
          contentClassName="text-sm"
        />
      </div>

      <div className="result-item">
        <InlineField
          label="材质/表皮"
          content={canshou.materialAndSkin}
          labelClassName={labelClassName}
          contentClassName="text-sm"
        />
      </div>

      <div className="result-item">
        <InlineField
          label="特征/附属物"
          content={canshou.featuresAndAppendages}
          labelClassName={labelClassName}
          contentClassName="text-sm"
        />
      </div>

      <div className="result-item">
        <InlineField
          label="攻击方式"
          content={canshou.attackMethod}
          labelClassName={labelClassName}
          contentClassName="text-sm"
        />
      </div>

      <div className="result-item">
        <InlineField
          label="特殊能力"
          content={canshou.specialAbility}
          labelClassName={labelClassName}
          contentClassName="text-sm"
        />
      </div>

      <div className="result-item">
        <InlineField
          label="起源"
          content={canshou.origin}
          labelClassName={labelClassName}
          contentClassName="text-sm"
        />
      </div>

      <div className="result-item">
        <InlineField
          label="诞生环境"
          content={canshou.birthEnvironment}
          labelClassName={labelClassName}
          contentClassName="text-sm"
        />
      </div>

      <div className="result-item border-l-4 border-red-400">
        <InlineField
          label="研究员笔记"
          content={canshou.researcherNotes}
          labelClassName={labelClassName}
          contentClassName="text-sm italic"
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
        
        <CurrentStatePanel state={canshou.current_state} variant="dark" />

        {/*
          【修复】对历战记录进行健壮性检查。
          修改后：在尝试访问 .entries 之前，先确保 canshou.arena_history 和 canshou.arena_history.entries 都存在且为数组。
          这样可以防止因数据格式不规范（如 arena_history 为 null 或 entries 不是数组）导致的页面崩溃。
        */}
        {canshou.arena_history && Array.isArray(canshou.arena_history.entries) && canshou.arena_history.entries.length > 0 && (
          <div className="result-item">
            <button onClick={() => setIsHistoryVisible(!isHistoryVisible)} className="result-label w-full text-left bg-transparent border-none cursor-pointer">
              {isHistoryVisible ? '▼' : '▶'} 📜 历战记录
            </button>
            {isHistoryVisible && (
              <div className="result-value mt-2 space-y-2 text-xs">
                {canshou.arena_history.entries.slice().reverse().map((entry: ArenaHistoryEntry) => (
                  <div key={entry.id} className="p-2 bg-black bg-opacity-10 rounded">
                    <p><strong>{entry.title}</strong></p>
                    <p><strong>类型:</strong> {entry.type} | <strong>胜利者:</strong> {entry.winner}</p>
                    <div className="mt-1">
                      <p className="font-semibold">影响:</p>
                      <MarkdownBlock content={entry.impact || '暂无影响描述'} variant="dark" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button onClick={handleSaveImage} className="save-button mt-4" disabled={isSavingImage}>
          {isSavingImage ? '生成中...' : (saveButtonLabel ?? '📱 保存为图片')}
        </button>

        {/* 【核心修改】新增：用于截图的Logo占位符，默认隐藏 */}
	        <div
	          className="logo-placeholder"
	          style={{ display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' }}
	        >
	          <img
	            src="/logo-white-qrcode.svg"
	            width={280}
	            height={280}
	            alt="Logo"
	            style={{
	              display: 'block',
	              maxWidth: '100%',
	              height: 'auto'
	            }}
	          />
	          <GeneratedByUserBadge variant="dark" className="mt-3" />
	        </div>
	      </div>
	    </div>
	  );
	};

export default CanshouCard;
