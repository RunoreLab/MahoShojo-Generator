import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODELSCOPE_MODEL,
  DEFAULT_MODELSCOPE_SIZE,
  MODELSCOPE_SIZE_OPTIONS,
  isModelScopePresetSize,
} from '../src/modelscope';

describe('ModelScope shared parameter rules', () => {
  it('preserves the original five choices, labels, order and defaults', () => {
    expect(MODELSCOPE_SIZE_OPTIONS).toEqual([
      { value: '928x1664', label: '16:9 竖屏（928×1664）' },
      { value: '1664x928', label: '16:9 横屏（1664×928）' },
      { value: '1328x1328', label: '正方形（1328×1328）' },
      { value: '1104x1472', label: '4:3 竖屏（1104×1472）' },
      { value: '1472x1104', label: '4:3 横屏（1472×1104）' },
    ]);
    expect(DEFAULT_MODELSCOPE_SIZE).toBe('1328x1328');
    expect(DEFAULT_MODELSCOPE_MODEL).toBe('Stonego/XiabanmostyleV3');
  });

  it.each(['928x1664', '1664x928', '1328x1328', '1104x1472', '1472x1104'])('accepts the exact preset %s', (value) => {
    expect(isModelScopePresetSize(value)).toBe(true);
    expect(isModelScopePresetSize(` ${value} `)).toBe(false);
  });

  it.each([undefined, null, 1328, true, {}, ['1328x1328'], '', '1024x1024', '1328X1328', '1328×1328', '\t1328x1328\n'])('rejects non-exact values without coercion: %j', (value) => {
    expect(isModelScopePresetSize(value)).toBe(false);
  });
});
