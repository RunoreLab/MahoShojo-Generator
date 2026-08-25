import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  estimateImageDataUrlByteLength,
  getImageSizeWarning,
  IMAGE_SIZE_WARNING_BYTES,
  blobToDataUrl,
  imageUrlToDataUrl,
  isImageDataUrl,
} from '@/lib/card-forge/image-data';

afterEach(() => vi.restoreAllMocks());

describe('card forge image data', () => {
  test('large images only produce a user-facing warning', () => {
    expect(getImageSizeWarning(IMAGE_SIZE_WARNING_BYTES)).toBeNull();

    const warning = getImageSizeWarning(IMAGE_SIZE_WARNING_BYTES + 1);
    expect(warning).toContain('图片较大');
    expect(warning).toContain('不会阻止继续使用');
  });

  test('estimates embedded image Data URL size without imposing a limit', () => {
    expect(estimateImageDataUrlByteLength('data:image/png;base64,aGVsbG8=')).toBe(5);
    expect(estimateImageDataUrlByteLength('https://cdn.example.test/card.png')).toBeNull();
  });

  test('recognizes image Base64 Data URLs only', () => {
    expect(isImageDataUrl('data:image/png;base64,aGVsbG8=')).toBe(true);
    expect(isImageDataUrl('https://cdn.example.test/card.png')).toBe(false);
    expect(isImageDataUrl('data:text/plain;base64,SGk=')).toBe(false);
  });

  test('converts a Blob to a typed Base64 Data URL', async () => {
    const dataUrl = await blobToDataUrl(new Blob(['hello'], { type: 'image/png' }));
    expect(dataUrl).toBe('data:image/png;base64,aGVsbG8=');
  });

  test('keeps an existing image Data URL without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const dataUrl = 'data:image/webp;base64,aGVsbG8=';
    await expect(imageUrlToDataUrl(dataUrl)).resolves.toBe(dataUrl);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('downloads a remote image and converts it to Base64', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new Blob(['hello'], { type: 'image/jpeg' }),
      { status: 200 },
    )));

    await expect(imageUrlToDataUrl('https://cdn.example.test/card.jpg'))
      .resolves.toBe('data:image/jpeg;base64,aGVsbG8=');
  });

  test('rejects failed responses and non-image responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    await expect(imageUrlToDataUrl('https://cdn.example.test/missing.png'))
      .rejects.toThrow('图片下载失败');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new Blob(['hello'], { type: 'text/plain' }),
      { status: 200 },
    )));
    await expect(imageUrlToDataUrl('https://cdn.example.test/not-image'))
      .rejects.toThrow('不是有效的图片');
  });
});
