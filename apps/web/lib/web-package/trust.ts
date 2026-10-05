'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  canReuseWebPackageTrust, createWebPackageTrustGrant, parseWebPackageTrustGrant,
  type WebPackageRiskProfile, type WebPackageTrustGrant,
} from '@mahoshojo/web-package/security';

export const WEB_PACKAGE_TRUST_KEY_PREFIX = 'arena.web-package-same-origin.v1.';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener); window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
};
const read = (key: string | null): string | null => {
  try { return key ? window.localStorage.getItem(key) : null; } catch { return null; }
};
const decode = (raw: string | null): WebPackageTrustGrant | null => {
  try { return raw ? parseWebPackageTrustGrant(JSON.parse(raw)) : null; } catch { return null; }
};

/** 同源信任与普通 Web consent 完全分离；本次许可不写磁盘，持久许可精确绑定 revision。 */
export function useWebPackageTrust(profile: WebPackageRiskProfile | null) {
  const [once, setOnce] = useState<WebPackageTrustGrant | null>(null);
  const [deniedDigest, setDeniedDigest] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = profile ? WEB_PACKAGE_TRUST_KEY_PREFIX + profile.packageRef.digest : null;
  const snapshot = useCallback(() => read(key), [key]);
  const persisted = useSyncExternalStore(subscribe, snapshot, () => null);
  const trusted = Boolean(profile && deniedDigest !== profile.packageRef.digest
    && (canReuseWebPackageTrust(once, profile) || canReuseWebPackageTrust(decode(persisted), profile)));

  const allow = useCallback((remember: boolean) => {
    if (!profile) return;
    const grant = createWebPackageTrustGrant(profile, remember ? 'revision' : 'instance');
    setDeniedDigest(null); setNotice(null);
    // 即使持久化被浏览器拒绝，本次明确许可仍有效，但不能谎称已经保存。
    setOnce(createWebPackageTrustGrant(profile, 'instance'));
    if (remember && key) {
      try { window.localStorage.setItem(key, JSON.stringify(grant)); setOnce(null); notify(); }
      catch { setNotice('浏览器未能保存信任；本次结果仍已获准，下次需重新确认。'); }
    }
  }, [key, profile]);
  const revoke = useCallback(() => {
    setOnce(null); setDeniedDigest(profile?.packageRef.digest ?? null); setNotice(null);
    if (key) {
      try { window.localStorage.removeItem(key); notify(); }
      catch { setNotice('已停止当前同源执行，但浏览器未能删除持久记录；请清除本站权限存储。'); }
    }
  }, [key, profile]);
  return { trusted, allow, revoke, notice };
}
