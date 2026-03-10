import { describe, expect, it } from 'bun:test';

import { extractDataCardVisualAssets } from '@/lib/data-card-visual-assets';

describe('data-card-visual-assets', () => {
  it('提取远程图片与内嵌 data url 视觉资产', () => {
    const assets = extractDataCardVisualAssets({
      portrait: 'https://assets.example.com/hero.webp',
      profile: {
        illustration: 'data:image/png;base64,QUJDRA==',
      },
      gallery: [
        {
          imageUrl: 'https://assets.example.com/banner.png?size=large',
        },
      ],
      notes: 'plain text',
    });

    expect(assets).toHaveLength(3);
    expect(assets[0]).toMatchObject({
      keyPath: 'portrait',
      kind: 'portrait',
      sourceType: 'remote',
      mimeType: 'image/webp',
      previewUrl: 'https://assets.example.com/hero.webp',
    });
    expect(assets[1]).toMatchObject({
      keyPath: 'profile.illustration',
      kind: 'illustration',
      sourceType: 'dataUrl',
      mimeType: 'image/png',
      approxBytes: 4,
    });
    expect(assets[2]?.keyPath).toBe('gallery[0].imageUrl');
  });

  it('忽略非图片字符串字段', () => {
    const assets = extractDataCardVisualAssets({
      title: '普通文本',
      metadata: {
        author: 'alice',
      },
      entries: ['hello', 'world'],
    });

    expect(assets).toEqual([]);
  });
});
