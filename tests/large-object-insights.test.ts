import { describe, expect, test } from 'bun:test';

import {
  formatLargeObjectAssetFamily,
  formatLargeObjectKindLabel,
  getLargeObjectAssetFamily,
  isLargeObjectPreviewableImage,
} from '@/lib/admin/large-object-insights';

describe('large-object-insights', () => {
  test('根据 kind 和 contentType 识别文本对象', () => {
    expect(getLargeObjectAssetFamily('battle_report_generation_output', null)).toBe('text');
    expect(getLargeObjectAssetFamily('unknown', 'application/json')).toBe('text');
  });

  test('根据 contentType 识别图片对象并支持预览', () => {
    expect(getLargeObjectAssetFamily('portrait', 'image/webp')).toBe('image');
    expect(isLargeObjectPreviewableImage('portrait', 'image/webp')).toBe(true);
  });

  test('未知二进制对象落到 other', () => {
    expect(getLargeObjectAssetFamily('binary_blob', 'application/octet-stream')).toBe('other');
    expect(formatLargeObjectAssetFamily('other')).toBe('其他对象');
  });

  test('kind 标签格式化为后台友好文案', () => {
    expect(formatLargeObjectKindLabel('battle_report_generation_output')).toBe('战报正文');
    expect(formatLargeObjectKindLabel('illustration')).toBe('插图');
  });
});
