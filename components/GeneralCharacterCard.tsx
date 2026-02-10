import React, { useMemo, useRef, useState } from 'react';
import { ArenaHistory, ArenaHistoryEntry, CharacterCurrentState } from '@/types/arena';
import { GeneralCharacterData } from '@/lib/schemas/general-character';
import { CurrentStatePanel } from '@/components/CurrentStatePanel';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import { createBlobUrl, downloadBlob } from '@/lib/client/blobUrl';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';
import { InlineField } from '@/components/shared/InlineField';
import type { CharacterCardPortraitAsset } from '@/types/visual-asset';

export interface GeneralCharacterDetails extends GeneralCharacterData {
  arena_history?: ArenaHistory | null;
}

interface GeneralCharacterCardProps {
  general: GeneralCharacterDetails | {
    name: string;
    content: string;
    arena_history?: ArenaHistory | null;
    current_state?: CharacterCurrentState | null;
  };
  isStreaming?: boolean;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  saveButtonLabel?: string;
  portraitAsset?: CharacterCardPortraitAsset | null;
}

type MainColorKey = 'Red' | 'Orange' | 'Cyan' | 'Blue' | 'Purple' | 'Pink' | 'Yellow' | 'Green';

const MAIN_COLORS: Record<MainColorKey, string> = {
  Red: '红色',
  Orange: '橙色',
  Cyan: '青色',
  Blue: '蓝色',
  Purple: '紫色',
  Pink: '粉色',
  Yellow: '黄色',
  Green: '绿色',
};

const COLOR_GRADIENTS: Record<MainColorKey, { first: string; second: string }> = {
  Red: { first: '#ff6b6b', second: '#ee5a6f' },
  Orange: { first: '#ff922b', second: '#ffa94d' },
  Cyan: { first: '#22b8cf', second: '#66d9e8' },
  Blue: { first: '#5c7cfa', second: '#748ffc' },
  Purple: { first: '#9775fa', second: '#b197fc' },
  Pink: { first: '#ff9a9e', second: '#fecfef' },
  Yellow: { first: '#f59f00', second: '#fcc419' },
  Green: { first: '#51cf66', second: '#8ce99a' },
};

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
  for (const [key, label] of Object.entries(MAIN_COLORS) as [MainColorKey, string][]) {
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

const GeneralCharacterCard: React.FC<GeneralCharacterCardProps> = ({
  general,
  isStreaming = false,
  onSaveImage,
  imageSaveMode = 'auto',
  saveButtonLabel,
  portraitAsset = null,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const labelClassName = 'text-sm opacity-90';
  const portraitImageUrl = typeof portraitAsset?.imageUrl === 'string' ? portraitAsset.imageUrl.trim() : '';
  const uploadedPortraitNote =
    portraitAsset?.source === 'uploaded'
      ? (typeof portraitAsset.note === 'string' && portraitAsset.note.trim() ? portraitAsset.note.trim() : '用户自行上传')
      : '';

  const displayContent =
    general?.content?.trim()
      ? general.content.trim()
      : isStreaming
        ? '正在启动流式生成…'
        : '（content 字段为空，建议补充完整的角色设定，包括外观、能力、背景。）';

  const gradientStyle = useMemo(() => {
    const colors = COLOR_GRADIENTS[detectColorFromContent(general?.content)];
    return `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
  }, [general]);

  const handleSaveImage = async () => {
    if (isStreaming) return;
    if (!cardRef.current) return;
    if (isSavingImage) return;

    const saveButton = cardRef.current.querySelector('.save-button') as HTMLElement;
    const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement;
    try {
      setIsSavingImage(true);
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
      const sanitizedTitle = (general?.name || '未命名角色').replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
      const filename = `通用角色_${sanitizedTitle}.png`;

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
      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
      setIsSavingImage(false);
    }
  };

  const renderHistory = () => {
    const history = general?.arena_history;
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
            {entries.map((entry: ArenaHistoryEntry) => (
              <div key={entry.id} className="p-2 bg-black bg-opacity-10 rounded">
                <p className="font-semibold text-sm">{entry.title || '未命名事件'}</p>
                <p className="text-gray-200">
                  <strong>类型:</strong> {entry.type} | <strong>胜者:</strong> {entry.winner || '未知'}
                </p>
                <div className="mt-1 text-gray-100 leading-relaxed">
                  <MarkdownBlock content={entry.impact || '暂无影响描述'} variant="dark" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={cardRef}
      className="result-card"
      style={{ background: gradientStyle }}
    >
      <div className="result-content">
        <div className="flex justify-center">
          <img src="/questionnaire-title.svg" alt="通用角色档案" className="w-72 mb-4" />
        </div>

        {portraitImageUrl && (
          <div className="result-item" style={{ borderLeft: '4px solid #f9a8d4', background: 'rgba(0,0,0,0.2)' }}>
            <div className="result-label">🖼️ 角色立绘</div>
            <div className="result-value">
              <img
                src={portraitImageUrl}
                alt={`${general?.name || '角色'} 立绘`}
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
          <InlineField
            label="角色名称"
            content={general?.name || '未命名角色'}
            labelClassName={labelClassName}
            contentClassName="text-2xl font-bold text-white drop-shadow"
            contentStyle={{ letterSpacing: '0.08em' }}
          />
        </div>

        <div className="result-item">
          <InlineField
            label="角色设定"
            content={displayContent}
            labelClassName={labelClassName}
            contentClassName="text-sm"
            className={isStreaming ? 'inline-block' : undefined}
          />
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-white/70 animate-pulse align-middle ml-1" />
          )}
        </div>

        <CurrentStatePanel state={general?.current_state} variant="dark" />

        {renderHistory()}

        <button onClick={handleSaveImage} className="save-button mt-4" disabled={isStreaming || isSavingImage}>
          {isStreaming || isSavingImage ? '生成中...' : (saveButtonLabel ?? '📱 保存为图片')}
        </button>

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

export default GeneralCharacterCard;
