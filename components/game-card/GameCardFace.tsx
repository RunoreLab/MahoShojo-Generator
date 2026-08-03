'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Flame, Droplet, Mountain, Wind, Sun, Moon, CircleDashed, CircleEllipsis } from 'lucide-react';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import { createBlobUrl, downloadBlob } from '@/lib/client/blobUrl';
import {
  type GameCardFaceData,
  type GameCardRarity,
  type GameCardElement,
  RARITY_LABELS,
  CARD_TYPE_LABELS,
  ELEMENT_LABELS,
  RARITY_COLORS,
  ELEMENT_COLORS,
} from '@/lib/schemas/game-card';

export interface GameCardFaceProps {
  faceData: GameCardFaceData;
  imageUrl?: string | null;
  isExporting?: boolean;
  onExportStateChange?: (exporting: boolean) => void;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  showSaveButton?: boolean;
  saveButtonLabel?: string;
  className?: string;
}

const ELEMENT_ICONS: Record<GameCardElement, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  fire: Flame,
  water: Droplet,
  earth: Mountain,
  wind: Wind,
  light: Sun,
  dark: Moon,
  void: CircleDashed,
  neutral: CircleEllipsis,
};

const RARITY_STARS: Record<GameCardRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  mythic: 6,
};

const waitForNextPaint = async () => {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
};

export function GameCardFace({
  faceData,
  imageUrl,
  isExporting: externalIsExporting,
  onExportStateChange,
  onSaveImage,
  imageSaveMode = 'auto',
  showSaveButton = true,
  saveButtonLabel,
  className,
}: GameCardFaceProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [internalIsExporting, setInternalIsExporting] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const isExporting = externalIsExporting ?? internalIsExporting;

  useEffect(() => {
    if (onExportStateChange) onExportStateChange(isExporting);
  }, [isExporting, onExportStateChange]);

  const rarityColors = RARITY_COLORS[faceData.rarity] ?? RARITY_COLORS.common;
  const elementColor = ELEMENT_COLORS[faceData.element] ?? ELEMENT_COLORS.neutral;
  const themeColor = useMemo(() => {
    const hex = faceData.themeColor?.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex ?? '')) return hex!;
    return rarityColors.primary;
  }, [faceData.themeColor, rarityColors.primary]);

  const gradientBg = useMemo(() => {
    return `linear-gradient(160deg, ${themeColor}dd 0%, ${rarityColors.secondary}cc 60%, #0a0a12 100%)`;
  }, [themeColor, rarityColors.secondary]);

  const stars = RARITY_STARS[faceData.rarity] ?? 1;
  const isCombatCard = faceData.cardType === 'character' || faceData.cardType === 'creature' || faceData.cardType === 'equipment';

  const handleSaveImage = async () => {
    if (!cardRef.current || isSavingImage) return;
    try {
      setIsSavingImage(true);
      if (externalIsExporting === undefined) {
        flushSync(() => setInternalIsExporting(true));
      }
      await waitForNextPaint();

      const blob = await capturePngBlob(cardRef.current, {
        scale: 2,
        dprMax: 3,
        fast: false,
        exclude: ['audio', 'video'],
        excludeMode: 'remove',
      });

      const resolvedMode: 'modal' | 'download' =
        imageSaveMode === 'modal' || imageSaveMode === 'download'
          ? imageSaveMode
          : /Mobi/i.test(window.navigator.userAgent)
            ? 'modal'
            : 'download';
      const sanitized = faceData.cardName.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
      const filename = `卡牌_${sanitized}.png`;

      if (resolvedMode === 'modal') {
        const url = createBlobUrl(blob);
        onSaveImage?.(url);
      } else {
        downloadBlob(blob, filename);
      }
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error('GameCardFace image export failed:', err);
    } finally {
      if (externalIsExporting === undefined) {
        flushSync(() => setInternalIsExporting(false));
      }
      setIsSavingImage(false);
    }
  };

  return (
    <div className={`gc-wrapper ${className ?? ''}`}>
      <div
        ref={cardRef}
        className={`gc-card ${isExporting ? 'gc-exporting' : ''}`}
        style={{
          ['--gc-rarity-primary' as string]: rarityColors.primary,
          ['--gc-rarity-secondary' as string]: rarityColors.secondary,
          ['--gc-rarity-glow' as string]: rarityColors.glow,
          ['--gc-element' as string]: elementColor,
          ['--gc-theme' as string]: themeColor,
          background: gradientBg,
        }}
      >
        {/* 顶部装饰条 */}
        <div className="gc-top-bar" />

        {/* 费用宝石 */}
        <div className="gc-cost-gem">
          <span className="gc-cost-number">{faceData.cost}</span>
        </div>

        {/* 稀有度宝石 */}
        <div className="gc-rarity-gem" title={RARITY_LABELS[faceData.rarity]}>
          <span className="gc-rarity-stars">{'★'.repeat(stars)}</span>
        </div>

        {/* 卡牌名称 */}
        <div className="gc-name-bar">
          <span className="gc-name-text">{faceData.cardName}</span>
        </div>

        {/* 插图区域 */}
        <div className="gc-art-frame">
          <div className="gc-art-bg" style={{ borderColor: `${elementColor}66` }}>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={faceData.cardName}
                className="gc-art-img"
                crossOrigin="anonymous"
              />
            ) : (
              <div className="gc-art-placeholder">
                <span className="gc-art-placeholder-icon">🎴</span>
                <span className="gc-art-placeholder-text">暂无插图</span>
              </div>
            )}
          </div>
          {/* 元素标识 */}
          <div className="gc-element-badge" style={{ background: `${elementColor}cc` }}>
            {(() => {
              const Icon = ELEMENT_ICONS[faceData.element] ?? CircleEllipsis;
              return <Icon size={12} strokeWidth={2.5} />;
            })()}
            <span className="gc-element-label">{ELEMENT_LABELS[faceData.element]}</span>
          </div>
        </div>

        {/* 类型栏 */}
        <div className="gc-type-bar">
          <span className="gc-type-text">
            {CARD_TYPE_LABELS[faceData.cardType]}
            {faceData.traits.length > 0 && ` · ${faceData.traits.join(' ')}`}
          </span>
          <span className="gc-power-level">{faceData.powerLevel}</span>
        </div>

        {/* 效果文本框 */}
        <div className="gc-effect-box">
          {faceData.effects.map((effect, idx) => (
            <div key={idx} className="gc-effect-item">
              <span className="gc-effect-type">【{effect.type}】</span>
              <span className="gc-effect-desc">{effect.description}</span>
            </div>
          ))}
          {faceData.description && faceData.effects.length === 0 && (
            <div className="gc-effect-desc">{faceData.description}</div>
          )}
        </div>

        {/* 风味文本 */}
        {faceData.flavorText && (
          <div className="gc-flavor-text">
            <span className="gc-flavor-quote">“</span>
            {faceData.flavorText}
            <span className="gc-flavor-quote">”</span>
          </div>
        )}

        {/* 底部数值栏 */}
        {isCombatCard && (
          <div className="gc-stats-bar">
            {faceData.attack !== null && (
              <div className="gc-stat gc-stat-atk">
                <span className="gc-stat-label">ATK</span>
                <span className="gc-stat-value">{faceData.attack}</span>
              </div>
            )}
            {faceData.hp !== null && (
              <div className="gc-stat gc-stat-hp">
                <span className="gc-stat-label">HP</span>
                <span className="gc-stat-value">{faceData.hp}</span>
              </div>
            )}
            {faceData.defense !== null && (
              <div className="gc-stat gc-stat-def">
                <span className="gc-stat-label">DEF</span>
                <span className="gc-stat-value">{faceData.defense}</span>
              </div>
            )}
          </div>
        )}

        {/* 非战斗卡显示强度 */}
        {!isCombatCard && (
          <div className="gc-stats-bar gc-stats-bar-simple">
            <span className="gc-stat-simple">强度 {faceData.powerLevel}</span>
          </div>
        )}

        {/* 导出时显示的 LOGO 水印 */}
        {isExporting && (
          <div className="gc-export-logo">
            <img src="/logo-white.svg" alt="魔法少女生成器" />
          </div>
        )}

        {/* 底部装饰条 */}
        <div className="gc-bottom-bar" />
      </div>

      {showSaveButton && (
        <button
          className="gc-save-btn save-button"
          onClick={handleSaveImage}
          disabled={isSavingImage}
        >
          {isSavingImage ? '生成中...' : (saveButtonLabel ?? '📱 保存卡牌图片')}
        </button>
      )}
    </div>
  );
}
