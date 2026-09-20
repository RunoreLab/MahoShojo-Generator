// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest';

import { downloadBlob } from '@/lib/client/blobUrl';

describe('blob download helper', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('does not revoke the object URL until after the download click', () => {
    vi.useFakeTimers();
    const objectUrl = 'blob:https://example.com/download';
    const createObjectURL = vi.fn(() => objectUrl);
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const blob = new Blob(['{}'], { type: 'application/json' });
    downloadBlob(blob, '角色.json');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector('a')).toBeNull();

    vi.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
  });

  test('keeps consecutive downloads independent until each URL is released', () => {
    vi.useFakeTimers();
    const blobA = new Blob(['a'], { type: 'text/plain' });
    const blobB = new Blob(['b'], { type: 'text/plain' });
    const objectUrlA = 'blob:https://example.com/download-a';
    const objectUrlB = 'blob:https://example.com/download-b';
    const createObjectURL = vi.fn((blob: Blob) => (blob === blobA ? objectUrlA : objectUrlB));
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    downloadBlob(blobA, 'a.txt');
    downloadBlob(blobB, 'b.txt');

    expect(createObjectURL).toHaveBeenNthCalledWith(1, blobA);
    expect(createObjectURL).toHaveBeenNthCalledWith(2, blobB);
    expect(click).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(9_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, objectUrlA);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, objectUrlB);
  });
});
