// @vitest-environment jsdom
/**
 * 共源设备偏好的纯逻辑断言（D5.1-S1 / DESK-SET-007）：存储键契约、init 脚本
 * 内容、动效偏好解析与持久化、`data-motion` 根标记与结果自动定位开关。
 *
 * `data-motion` 与 `RESULT_AUTO_SCROLL_STORAGE_KEY` 是双宿主共享的产品契约——
 * Web 的 `app/layout.tsx`、Desktop 的 `index.html` 与共享 CSS/hook 消费同一
 * 来源；这里钉死它们，任何一端“自己写一份”都会在测试里立刻偏红。
 */
import { describe, expect, it } from 'vitest';

import {
  getMotionPreferenceInitScript,
  MOTION_PREFERENCE_STORAGE_KEY,
} from '../src/device-preferences/init';
import {
  applyMotionToDocument,
  isReducedMotionActive,
  readStoredMotionPreference,
  readStoredResultAutoScrollEnabled,
  resolveMotionPreference,
  RESULT_AUTO_SCROLL_STORAGE_KEY,
  storeMotionPreference,
  storeResultAutoScrollEnabled,
} from '../src/device-preferences/index';

describe('motion init script', () => {
  it('embeds the canonical storage key and writes the resolved document marker', () => {
    const script = getMotionPreferenceInitScript();

    expect(script).toContain(JSON.stringify(MOTION_PREFERENCE_STORAGE_KEY));
    expect(script).toContain('document.documentElement.dataset.motion');
    expect(script).toContain('prefers-reduced-motion: reduce');
    // 受限环境必须自己兜住：localStorage/matchMedia 不可用不得让首屏崩溃。
    expect(script).toContain('try {');
    expect(script).toContain('catch');
  });

  it('exposes the product storage key once for both hosts', () => {
    expect(MOTION_PREFERENCE_STORAGE_KEY).toBe('mahoshojo.motion-preference');
  });
});

describe('motion preference resolution', () => {
  it('lets an explicit reduce win and lets system follow the media query', () => {
    expect(resolveMotionPreference('reduce', false)).toBe('reduce');
    expect(resolveMotionPreference('reduce', true)).toBe('reduce');
    expect(resolveMotionPreference('system', true)).toBe('reduce');
    expect(resolveMotionPreference('system', false)).toBe('no-preference');
  });

  it('round-trips a stored preference and ignores invalid values', () => {
    expect(readStoredMotionPreference()).toBe('system');

    storeMotionPreference('reduce');
    expect(readStoredMotionPreference()).toBe('reduce');

    window.localStorage.setItem(MOTION_PREFERENCE_STORAGE_KEY, 'full');
    // 不存在「始终完整动效」一档：任何非法值回落 system，而不是被消费成绕过。
    expect(readStoredMotionPreference()).toBe('system');
  });
});

describe('data-motion document marker', () => {
  it('applies the resolved state onto the document element', () => {
    applyMotionToDocument('reduce');
    expect(document.documentElement.dataset.motion).toBe('reduce');
    applyMotionToDocument('no-preference');
    expect(document.documentElement.dataset.motion).toBe('no-preference');
  });

  it('isReducedMotionActive reads the marker and falls back to the media query', () => {
    document.documentElement.dataset.motion = 'reduce';
    expect(isReducedMotionActive()).toBe(true);
    document.documentElement.dataset.motion = 'no-preference';
    expect(isReducedMotionActive()).toBe(false);

    // 标记缺失（未跑 init 的裸页面）回落系统查询；jsdom 无 matchMedia → 不减。
    delete document.documentElement.dataset.motion;
    expect(isReducedMotionActive()).toBe(false);
  });
});

describe('result auto-scroll device preference', () => {
  it('exposes the product storage key once for both hosts', () => {
    expect(RESULT_AUTO_SCROLL_STORAGE_KEY).toBe('mahoshojo.result-auto-scroll');
  });

  it('defaults to enabled and treats anything but explicit off as on', () => {
    window.localStorage.removeItem(RESULT_AUTO_SCROLL_STORAGE_KEY);
    expect(readStoredResultAutoScrollEnabled()).toBe(true);

    window.localStorage.setItem(RESULT_AUTO_SCROLL_STORAGE_KEY, 'garbage');
    // 保守回退产品默认：损坏值不被消费成关闭。
    expect(readStoredResultAutoScrollEnabled()).toBe(true);
  });

  it('round-trips the toggle', () => {
    storeResultAutoScrollEnabled(false);
    expect(readStoredResultAutoScrollEnabled()).toBe(false);
    storeResultAutoScrollEnabled(true);
    expect(readStoredResultAutoScrollEnabled()).toBe(true);
  });
});
