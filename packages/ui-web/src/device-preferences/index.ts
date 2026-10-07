/**
 * 共源设备偏好 hook 与 DOM 应用逻辑（客户端专属）。
 *
 * 与 `color-mode` 同一先例：localStorage 持久化 + 根节点数据集标记 +
 * `useSyncExternalStore` 式的水合，Web 设置页与 Desktop 设置页消费同一份。
 * 这些是**设备级**偏好——只写本机 localStorage，不同步账号，也不要求登录
 * （DESK-SET-007：离线可改、不触发账号查询）。
 */
import { useEffect, useState } from 'react';

import { MOTION_PREFERENCE_STORAGE_KEY } from './init';

export type MotionPreference = 'system' | 'reduce';
/** `data-motion` 的取值——解析后的生效状态，不是用户选择本身。 */
export type ResolvedMotion = 'reduce' | 'no-preference';

export { MOTION_PREFERENCE_STORAGE_KEY } from './init';

export const MOTION_PREFERENCE_OPTIONS: Array<{ value: MotionPreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'reduce', label: '减少动态效果' },
];

const isMotionPreference = (value: string | null): value is MotionPreference => {
  return value === 'system' || value === 'reduce';
};

const getSystemReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export const resolveMotionPreference = (
  preference: MotionPreference,
  systemReduce: boolean
): ResolvedMotion => (preference === 'reduce' || (preference === 'system' && systemReduce) ? 'reduce' : 'no-preference');

export const readStoredMotionPreference = (): MotionPreference => {
  if (typeof window === 'undefined') {
    return 'system';
  }
  try {
    const stored = window.localStorage.getItem(MOTION_PREFERENCE_STORAGE_KEY);
    if (isMotionPreference(stored)) {
      return stored;
    }
  } catch {
    // localStorage 在受限环境下可能不可用，忽略即可
  }
  return 'system';
};

export const storeMotionPreference = (preference: MotionPreference): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(MOTION_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // localStorage 在受限环境下可能不可用，忽略即可
  }
};

export const applyMotionToDocument = (resolved: ResolvedMotion): void => {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.motion = resolved;
};

/**
 * 运行时读生效状态——给 `useResultAutoScroll` 这类不进 React 渲染的判定点用。
 * 权威源是 init 脚本/本模块 hook 写入的 `data-motion` 标记；标记缺失时回落到系统
 * 查询，保证裸页面（未跑 init 的测试环境）也遵守系统偏好。
 */
export const isReducedMotionActive = (): boolean => {
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion) {
    return document.documentElement.dataset.motion === 'reduce';
  }
  return getSystemReducedMotion();
};

export const useMotionPreference = (): {
  preference: MotionPreference;
  resolvedMotion: ResolvedMotion;
  setPreference: (value: MotionPreference) => void;
  isHydrated: boolean;
} => {
  const [preference, setPreference] = useState<MotionPreference>('system');
  const [resolvedMotion, setResolvedMotion] = useState<ResolvedMotion>('no-preference');
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
    const storedPreference = readStoredMotionPreference();
    setPreference(storedPreference);
    const resolved = resolveMotionPreference(storedPreference, getSystemReducedMotion());
    setResolvedMotion(resolved);
    applyMotionToDocument(resolved);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    storeMotionPreference(preference);
    const resolved = resolveMotionPreference(preference, getSystemReducedMotion());
    setResolvedMotion(resolved);
    applyMotionToDocument(resolved);
  }, [isHydrated, preference]);

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      // 只有跟随系统时才需要响应系统侧变化；显式 reduce 不受系统回落影响。
      if (preference !== 'system') {
        return;
      }
      const nextResolved: ResolvedMotion = event.matches ? 'reduce' : 'no-preference';
      setResolvedMotion(nextResolved);
      applyMotionToDocument(nextResolved);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [isHydrated, preference]);

  return {
    preference,
    resolvedMotion,
    setPreference,
    isHydrated,
  };
};

/* ── 结果自动定位（DESK-SET-007 外观与交互组，默认开） ─────────────── */

export const RESULT_AUTO_SCROLL_STORAGE_KEY = 'mahoshojo.result-auto-scroll';

export const readStoredResultAutoScrollEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    // 缺省与任何非显式关闭的值都视为开：保守回退到产品默认。
    return window.localStorage.getItem(RESULT_AUTO_SCROLL_STORAGE_KEY) === 'off' ? false : true;
  } catch {
    return true;
  }
};

export const storeResultAutoScrollEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(RESULT_AUTO_SCROLL_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // localStorage 在受限环境下可能不可用，忽略即可
  }
};

export const useResultAutoScrollEnabled = (): {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  isHydrated: boolean;
} => {
  const [enabled, setEnabled] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
    setEnabled(readStoredResultAutoScrollEnabled());
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    storeResultAutoScrollEnabled(enabled);
  }, [isHydrated, enabled]);

  return { enabled, setEnabled, isHydrated };
};
