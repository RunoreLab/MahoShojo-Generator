// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { capturePngBlob } from '../src/client/snapdomCapture';

const capture = vi.hoisted(() => vi.fn(async () => new Blob(['synthetic-image'], { type: 'image/png' })));
vi.mock('@zumer/snapdom', () => ({ snapdom: { toBlob: capture } }));

afterEach(() => { vi.restoreAllMocks(); });

it('waits for the selected reading font before capturing the current text layout', async () => {
  let ready!: () => void;
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  const fontReady = new Promise<void>((resolve) => { ready = resolve; });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fontReady } });
  const element = document.createElement('article');
  element.textContent = '合成阅读正文';
  document.body.append(element);
  try {
    const result = capturePngBlob(element);
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
    ready();
    expect((await result).type).toBe('image/png');
    expect(capture).toHaveBeenCalledWith(element, expect.objectContaining({ scale: 1 }));
  } finally {
    element.remove();
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
    else Reflect.deleteProperty(document, 'fonts');
  }
});
