// 结果卡内部共享片段：截图保存流程、立绘块、历战记录折叠块、Logo 占位区。
// 三个结果卡组件（MagicalGirlCard/GeneralCharacterCard/CanshouCard）的公共结构。

import { useCallback, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import {
  capturePngBlob,
  DENY_SNAPDOM_MEDIA,
  type SnapdomMediaAdapter,
} from '../client/snapdomCapture';
import { createBlobUrl, downloadBlob } from '../client/blob';
import type {
  CardImageSaveMode,
  CharacterCardMarkdown,
  CharacterCardPortraitAsset,
} from './types';
import type { ArenaHistory } from '@mahoshojo/domain/arena-types';
import type { ReactNode } from 'react';

export const waitForNextPaint = async () => {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return;
  }

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
};

// ---------------------------------------------------------------------------
// 截图保存流程
// ---------------------------------------------------------------------------

export interface UseCardImageSaveParams {
  cardRef: RefObject<HTMLElement | null>;
  isStreaming?: boolean;
  imageSaveMode?: CardImageSaveMode;
  onSaveImage?: (imageUrl: string) => void;
  /** 生成导出文件名（含 .png 扩展名）。 */
  resolveFileName: () => string;
  mediaAdapter?: SnapdomMediaAdapter;
  /** 流式时是否禁用截图（GeneralCharacterCard 语义；MagicalGirlCard/CanshouCard 不设）。 */
  blockWhenStreaming?: boolean;
}

export interface UseCardImageSaveResult {
  isSavingImage: boolean;
  isExportingImage: boolean;
  handleSaveImage: () => Promise<void>;
}

/**
 * 卡片截图 + 保存策略流程。
 * - auto：自动检测终端类型，移动端触发回调弹窗，桌面端直接下载。
 * - modal：始终调用 onSaveImage，由父组件控制后续交互。
 * - download：始终触发本地下载。
 */
export function useCardImageSave({
  cardRef,
  isStreaming = false,
  imageSaveMode = 'auto',
  onSaveImage,
  resolveFileName,
  mediaAdapter = DENY_SNAPDOM_MEDIA,
  blockWhenStreaming = false,
}: UseCardImageSaveParams): UseCardImageSaveResult {
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [isExportingImage, setIsExportingImage] = useState(false);

  const handleSaveImage = useCallback(async () => {
    if (blockWhenStreaming && isStreaming) return;
    const element = cardRef.current;
    if (!element) return;
    if (isSavingImage) return;

    const saveButton = element.querySelector('.save-button') as HTMLElement;
    const logoPlaceholder = element.querySelector('.logo-placeholder') as HTMLElement;
    try {
      setIsSavingImage(true);
      flushSync(() => setIsExportingImage(true));
      await waitForNextPaint();
      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const blob = await capturePngBlob(element, {
        scale: 1,
        dprMax: 2,
        fast: false,
        exclude: ['audio', 'video'],
        excludeMode: 'remove',
        mediaAdapter,
      });

      const resolvedMode: 'modal' | 'download' = imageSaveMode === 'modal' || imageSaveMode === 'download'
        ? imageSaveMode
        : (/Mobi/i.test(window.navigator.userAgent) ? 'modal' : 'download');
      const filename = resolveFileName();

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
      console.error('Image generation failed:', err);
    } finally {
      flushSync(() => setIsExportingImage(false));
      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
      setIsSavingImage(false);
    }
  }, [blockWhenStreaming, isStreaming, cardRef, isSavingImage, imageSaveMode, mediaAdapter, onSaveImage, resolveFileName]);

  return { isSavingImage, isExportingImage, handleSaveImage };
}

// ---------------------------------------------------------------------------
// 立绘块
// ---------------------------------------------------------------------------

export function PortraitBlock({ portraitAsset, subjectName }: {
  portraitAsset: CharacterCardPortraitAsset | null | undefined;
  subjectName: string;
}) {
  const portraitImageUrl = typeof portraitAsset?.imageUrl === 'string' ? portraitAsset.imageUrl.trim() : '';
  if (!portraitImageUrl) return null;

  const uploadedPortraitNote =
    portraitAsset?.source === 'uploaded'
      ? (typeof portraitAsset.note === 'string' && portraitAsset.note.trim() ? portraitAsset.note.trim() : '用户自行上传')
      : '';

  return (
    <div className="result-item" style={{ borderLeft: '4px solid #f9a8d4', background: 'rgba(0,0,0,0.2)' }}>
      <div className="result-label">🖼️ 角色立绘</div>
      <div className="result-value">
        <img
          src={portraitImageUrl}
          alt={`${subjectName || '角色'} 立绘`}
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
  );
}

// ---------------------------------------------------------------------------
// 历战记录折叠块
// ---------------------------------------------------------------------------

export function ArenaHistoryBlock({
  history,
  Markdown,
  entryBackground,
  resolveEntryBackground,
}: {
  history: ArenaHistory | null | undefined;
  Markdown: CharacterCardMarkdown;
  /** 静态条目背景（GeneralCharacterCard/CanshouCard：`bg-black bg-opacity-10`）。 */
  entryBackground?: string;
  /** 逐条目动态背景（MagicalGirlCard：从卡片渐变取色）。 */
  resolveEntryBackground?: () => string;
}) {
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  if (!history || !Array.isArray(history.entries) || history.entries.length === 0) {
    return null;
  }

  const entries = [...history.entries].reverse();

  return (
    <div className="result-item">
      <button
        onClick={() => setIsHistoryVisible(!isHistoryVisible)}
        className="result-label w-full text-left bg-transparent border-none cursor-pointer"
      >
        {isHistoryVisible ? '▼' : '▶'} 📜 历战记录
      </button>
      {isHistoryVisible && (
        <div className="result-value mt-2 space-y-2 text-xs">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={resolveEntryBackground ? 'p-2 rounded' : 'p-2 bg-black bg-opacity-10 rounded'}
              style={resolveEntryBackground ? { backgroundColor: resolveEntryBackground() } : entryBackground ? { backgroundColor: entryBackground } : undefined}
            >
              <p className="font-semibold text-sm">{entry.title || '未命名事件'}</p>
              <p className="text-gray-200">
                <strong>类型:</strong> {entry.type} | <strong>胜者:</strong> {entry.winner || '未知'}
              </p>
              <div className="mt-1 text-gray-100 leading-relaxed">
                <Markdown content={entry.impact || '暂无影响描述'} variant="dark" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logo 占位区（截图导出时替换保存按钮）
// ---------------------------------------------------------------------------

export function LogoPlaceholder({ qrCodeLogoSrc, generatedByBadge }: {
  qrCodeLogoSrc: string;
  generatedByBadge?: ReactNode;
}) {
  return (
    <div
      className="logo-placeholder"
      style={{ display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' }}
    >
      <img
        src={qrCodeLogoSrc}
        width={280}
        height={280}
        alt="Logo"
        style={{
          display: 'block',
          maxWidth: '100%',
          height: 'auto'
        }}
      />
      {generatedByBadge}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 底部保存/停止按钮
// ---------------------------------------------------------------------------

export function CardSaveButton({ isStreaming, onStopGeneration, isSavingImage, saveButtonLabel, onSaveImageClick }: {
  isStreaming?: boolean;
  onStopGeneration?: () => void;
  isSavingImage: boolean;
  saveButtonLabel?: string;
  onSaveImageClick: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <button
        onClick={isStreaming && onStopGeneration ? onStopGeneration : onSaveImageClick}
        className="save-button flex-1"
        disabled={isSavingImage}
      >
        {isStreaming && onStopGeneration ? '⏹ 停止生成' : isSavingImage ? '生成中...' : (saveButtonLabel ?? '📱 保存为图片')}
      </button>
    </div>
  );
}
