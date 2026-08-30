import { describe, expect, test } from 'vitest';
import {
  DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO,
  clampImageTransform,
  getCoverLayout,
  normalizeImageTransform,
} from '@/lib/game-card/image-crop';

describe('game card image crop math', () => {
  test('portrait image uses cover layout and exposes vertical overflow', () => {
    const layout = getCoverLayout(
      { width: 800, height: 1200 },
      { width: 400, height: 300 },
      1,
    );

    expect(layout.width).toBe(400);
    expect(layout.height).toBe(600);
    expect(layout.maxPanX).toBe(0);
    expect(layout.maxPanY).toBe(150);
  });

  test('clampImageTransform prevents pan beyond the scaled image boundary', () => {
    const layout = getCoverLayout({ width: 1200, height: 800 }, { width: 400, height: 300 }, 2);
    const clamped = clampImageTransform({ scale: 2, x: 1.8, y: -1.8 }, layout);

    expect(clamped.x).toBe(1);
    expect(clamped.y).toBe(-1);
  });

  test('an axis without cover overflow cannot be panned', () => {
    const layout = getCoverLayout({ width: 800, height: 1200 }, { width: 400, height: 300 }, 1);
    const clamped = clampImageTransform({ scale: 1, x: 0.8, y: -0.8 }, layout);

    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(-0.8);
  });

  test('invalid metadata falls back to defaults', () => {
    expect(normalizeImageTransform({ scale: 99, x: 'bad', y: null })).toEqual({ scale: 1, x: 0, y: 0 });
    expect(DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO).toBe('4:3');
  });
});
