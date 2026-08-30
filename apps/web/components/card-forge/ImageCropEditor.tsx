'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GAME_CARD_IMAGE_ASPECT_RATIO_OPTIONS,
  DEFAULT_IMAGE_TRANSFORM,
  clampImageTransform,
  getAspectRatioValue,
  getCoverLayout,
  normalizeImageTransform,
  type CoverLayout,
  type ImageSize,
} from '@/lib/game-card/image-crop';
import type { GameCardImageAspectRatio, ImageTransform } from '@/lib/schemas/game-card';

interface ImageCropEditorProps {
  imageUrl: string;
  imageAspectRatio: GameCardImageAspectRatio;
  imageTransform: ImageTransform;
  onAspectRatioChange: (value: GameCardImageAspectRatio) => void;
  onTransformChange: (value: ImageTransform) => void;
  onReset: () => void;
}

type PointerPosition = {
  x: number;
  y: number;
};

type DragStart = PointerPosition & {
  pointerId: number;
  origin: ImageTransform;
};

type PinchStart = {
  distance: number;
  scale: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const SCALE_STEP = 0.05;
const WHEEL_SCALE_STEP = 0.1;

const distanceBetween = (first: PointerPosition, second: PointerPosition): number => (
  Math.hypot(first.x - second.x, first.y - second.y)
);

const sameTransform = (first: ImageTransform, second: ImageTransform): boolean => (
  first.scale === second.scale && first.x === second.x && first.y === second.y
);

export function ImageCropEditor({
  imageUrl,
  imageAspectRatio,
  imageTransform,
  onAspectRatioChange,
  onTransformChange,
  onReset,
}: ImageCropEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef<Map<number, PointerPosition>>(new Map());
  const dragStartRef = useRef<DragStart | null>(null);
  const pinchStartRef = useRef<PinchStart | null>(null);
  const transformRef = useRef(imageTransform);
  const [viewportSize, setViewportSize] = useState<ImageSize | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    transformRef.current = imageTransform;
  }, [imageTransform]);

  useEffect(() => {
    setImageError(null);
    setImageSize(null);
    pointersRef.current.clear();
    dragStartRef.current = null;
    pinchStartRef.current = null;
  }, [imageUrl]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateViewportSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };

    updateViewportSize();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo<CoverLayout | null>(() => {
    if (!viewportSize || !imageSize) return null;
    return getCoverLayout(imageSize, viewportSize, imageTransform.scale);
  }, [imageSize, imageTransform.scale, viewportSize]);

  useEffect(() => {
    if (!layout) return;
    const normalized = normalizeImageTransform(imageTransform);
    const clamped = clampImageTransform(normalized, layout);
    if (sameTransform(clamped, imageTransform)) return;
    transformRef.current = clamped;
    onTransformChange(clamped);
  }, [imageTransform, layout, onTransformChange]);

  const updateTransform = useCallback((next: ImageTransform, nextLayout?: CoverLayout | null) => {
    const normalized = normalizeImageTransform(next);
    const clamped = nextLayout ? clampImageTransform(normalized, nextLayout) : normalized;
    transformRef.current = clamped;
    onTransformChange(clamped);
  }, [onTransformChange]);

  const updateScale = useCallback((nextScale: number, originTransform = transformRef.current) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const nextLayout = viewportSize && imageSize
      ? getCoverLayout(imageSize, viewportSize, scale)
      : null;
    updateTransform({ ...originTransform, scale }, nextLayout);
  }, [imageSize, updateTransform, viewportSize]);

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (!image.naturalWidth || !image.naturalHeight) {
      setImageError('无法读取图片尺寸，请更换图片后重试。');
      return;
    }
    setImageError(null);
    setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      pinchStartRef.current = {
        distance: Math.max(1, distanceBetween(first, second)),
        scale: transformRef.current.scale,
      };
      dragStartRef.current = null;
    } else {
      dragStartRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        origin: transformRef.current,
      };
      setIsDragging(true);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = pointersRef.current.get(event.pointerId);
    if (!current) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size >= 2 && pinchStartRef.current) {
      const [first, second] = Array.from(pointersRef.current.values());
      const distance = Math.max(1, distanceBetween(first, second));
      updateScale(pinchStartRef.current.scale * (distance / pinchStartRef.current.distance));
      return;
    }

    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId || !layout) return;

    const nextX = layout.maxPanX > 0
      ? dragStart.origin.x + (event.clientX - dragStart.x) / layout.maxPanX
      : 0;
    const nextY = layout.maxPanY > 0
      ? dragStart.origin.y + (event.clientY - dragStart.y) / layout.maxPanY
      : 0;
    updateTransform({ ...dragStart.origin, x: nextX, y: nextY }, layout);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;

    const remaining = Array.from(pointersRef.current.entries());
    if (remaining.length === 1) {
      const [pointerId, position] = remaining[0];
      dragStartRef.current = {
        pointerId,
        x: position.x,
        y: position.y,
        origin: transformRef.current,
      };
      setIsDragging(true);
    } else {
      dragStartRef.current = null;
      setIsDragging(false);
    }

    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateScale(transformRef.current.scale + (event.deltaY < 0 ? WHEEL_SCALE_STEP : -WHEEL_SCALE_STEP));
  };

  const handleFinePositionChange = (axis: 'x' | 'y', value: number) => {
    updateTransform({ ...transformRef.current, [axis]: value }, layout);
  };

  const renderedImageStyle: React.CSSProperties = layout
    ? {
        width: layout.width,
        height: layout.height,
        left: '50%',
        top: '50%',
        transform: `translate(-50%, -50%) translate(${imageTransform.x * layout.maxPanX}px, ${imageTransform.y * layout.maxPanY}px)`,
      }
    : {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      };

  return (
    <div className="card-forge-crop-editor space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="input-label text-xs">卡面插图比例</div>
          <p className="mt-1 text-xs text-[var(--app-text-muted)]">拖拽图片调整构图，滚轮或双指调整缩放</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="卡面插图比例"
            value={imageAspectRatio}
            onChange={(event) => onAspectRatioChange(event.target.value as GameCardImageAspectRatio)}
            className="input-field h-9 w-36 text-sm"
          >
            {GAME_CARD_IMAGE_ASPECT_RATIO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              transformRef.current = DEFAULT_IMAGE_TRANSFORM;
              onReset();
            }}
            className="card-forge-chip card-forge-chip-neutral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
            aria-label="重置图片裁剪"
          >
            重置
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`card-forge-crop-viewport ${isDragging ? 'is-dragging' : ''}`}
        style={{ aspectRatio: getAspectRatioValue(imageAspectRatio) }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
        onContextMenu={(event) => event.preventDefault()}
        role="application"
        aria-label="插图裁剪视窗"
      >
        <img
          ref={imageRef}
          src={imageUrl}
          alt="插图裁剪预览"
          draggable={false}
          className="card-forge-crop-image"
          style={renderedImageStyle}
          onLoad={handleImageLoad}
          onError={() => setImageError('图片加载失败，请重新选择图片。')}
        />
        <div className="card-forge-crop-grid" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        {imageError && (
          <div className="card-forge-crop-error" role="alert">
            {imageError}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-3 text-xs text-[var(--app-text-muted)]">
          <span className="w-12 shrink-0">缩放</span>
          <input
            aria-label="图片缩放"
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={SCALE_STEP}
            value={imageTransform.scale}
            onChange={(event) => updateScale(Number(event.target.value))}
            className="flex-1 accent-pink-500"
          />
          <span className="w-12 shrink-0 text-right tabular-nums">{imageTransform.scale.toFixed(2)}x</span>
        </label>

        <details className="rounded-lg border border-[var(--app-border)] bg-black/[0.02] px-3 py-2 dark:bg-white/[0.03]">
          <summary className="cursor-pointer text-xs font-medium text-[var(--app-text-muted)]">精细调整位置</summary>
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-3 text-xs text-[var(--app-text-muted)]">
              <span className="w-12 shrink-0">水平</span>
              <input
                aria-label="图片水平位置"
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={imageTransform.x}
                onChange={(event) => handleFinePositionChange('x', Number(event.target.value))}
                className="flex-1 accent-pink-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums">{Math.round(imageTransform.x * 100)}%</span>
            </label>
            <label className="flex items-center gap-3 text-xs text-[var(--app-text-muted)]">
              <span className="w-12 shrink-0">垂直</span>
              <input
                aria-label="图片垂直位置"
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={imageTransform.y}
                onChange={(event) => handleFinePositionChange('y', Number(event.target.value))}
                className="flex-1 accent-pink-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums">{Math.round(imageTransform.y * 100)}%</span>
            </label>
          </div>
        </details>
      </div>
    </div>
  );
}
