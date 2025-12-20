import { describe, expect, test } from 'bun:test';

import { isBlobUrl } from '@/lib/client/blobUrl';
import { getSafeDpr } from '@/lib/client/snapdomCapture';

describe('client capture utils', () => {
  test('getSafeDpr: 在非浏览器环境回退为 1', () => {
    expect(getSafeDpr()).toBe(1);
    expect(getSafeDpr(3)).toBe(1);
  });

  test('isBlobUrl: 仅识别 blob: 开头的 URL', () => {
    expect(isBlobUrl('blob:https://example.com/123')).toBe(true);
    expect(isBlobUrl('data:image/png;base64,abc')).toBe(false);
    expect(isBlobUrl('https://example.com/a.png')).toBe(false);
  });
});

