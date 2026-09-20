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
});
