// @vitest-environment jsdom
/**
 * 共源亮暗偏好的纯逻辑断言：存储键契约、init 脚本内容、解析与持久化。
 *
 * `COLOR_MODE_STORAGE_KEY` 与 `getColorModeInitScript()` 是双宿主共享的产品契约——
 * Web 的 `app/layout.tsx` 与 Desktop 的 `index.html` 消费同一来源；这里钉死它们，
 * 任何一端"自己写一份"都会在测试里立刻偏红。
 */
import { describe, expect, it } from 'vitest';

import {
  COLOR_MODE_STORAGE_KEY,
  getColorModeInitScript,
} from '../src/color-mode/init';
import {
  applyColorModeToDocument,
  readStoredColorModePreference,
  resolveColorMode,
  storeColorModePreference,
} from '../src/color-mode/index';

describe('color-mode init script', () => {
  it('embeds the canonical storage key and writes the resolved document attribute', () => {
    const script = getColorModeInitScript();

    expect(script).toContain(JSON.stringify(COLOR_MODE_STORAGE_KEY));
    expect(script).toContain('document.documentElement.dataset.colorMode');
    expect(script).toContain('prefers-color-scheme: dark');
    // 脚本必须自己兜住受限环境：localStorage/matchMedia 不可用时不得让首屏崩溃。
    expect(script).toContain('try {');
    expect(script).toContain('catch');
  });

  it('exposes the product storage key once for both hosts', () => {
    expect(COLOR_MODE_STORAGE_KEY).toBe('mahoshojo.color-mode');
  });
});

describe('color-mode resolution', () => {
  it('keeps an explicit choice over the system preference', () => {
    expect(resolveColorMode('light', 'dark')).toBe('light');
    expect(resolveColorMode('dark', 'light')).toBe('dark');
    expect(resolveColorMode('system', 'dark')).toBe('dark');
    expect(resolveColorMode('system', 'light')).toBe('light');
  });

  it('round-trips a stored preference and ignores invalid values', () => {
    expect(readStoredColorModePreference()).toBe('system');

    storeColorModePreference('dark');
    expect(readStoredColorModePreference()).toBe('dark');

    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'not-a-mode');
    expect(readStoredColorModePreference()).toBe('system');
  });

  it('applies the resolved mode onto the document element', () => {
    applyColorModeToDocument('dark');
    expect(document.documentElement.dataset.colorMode).toBe('dark');
    applyColorModeToDocument('light');
    expect(document.documentElement.dataset.colorMode).toBe('light');
  });
});
