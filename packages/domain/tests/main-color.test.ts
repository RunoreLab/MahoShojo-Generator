import { describe, expect, it } from 'vitest';

import {
  COLOR_GRADIENTS,
  MAIN_COLOR_KEYS,
  MAIN_COLOR_VALUES,
  MainColor,
  getMainColorGradient,
} from '@mahoshojo/domain/main-color';

describe('main color domain contract', () => {
  it('导出稳定的 canonical 颜色集合与键顺序', () => {
    expect(MainColor).toEqual({
      Red: '红色',
      Orange: '橙色',
      Cyan: '青色',
      Blue: '蓝色',
      Purple: '紫色',
      Pink: '粉色',
      Yellow: '黄色',
      Green: '绿色',
    });
    expect(MAIN_COLOR_KEYS).toEqual([
      'Red',
      'Orange',
      'Cyan',
      'Blue',
      'Purple',
      'Pink',
      'Yellow',
      'Green',
    ]);
    expect(MAIN_COLOR_VALUES).toEqual(Object.values(MainColor));
  });

  it('保留渐变查找与 Pink fallback', () => {
    expect(getMainColorGradient('Green')).toEqual(COLOR_GRADIENTS['绿色']);
    expect(getMainColorGradient(null)).toEqual(COLOR_GRADIENTS['粉色']);
    expect(getMainColorGradient('unknown' as never)).toEqual(COLOR_GRADIENTS['粉色']);
  });
});
