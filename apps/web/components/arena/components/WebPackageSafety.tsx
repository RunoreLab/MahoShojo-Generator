'use client';

import { useEffect, useRef, useState } from 'react';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { resolveWebPackage } from '@mahoshojo/web-package';
import { scanWebPackageBase, type WebPackageRiskProfile } from '@mahoshojo/web-package/security';
import { WebPackageRiskSummary } from '@mahoshojo/ui-web/arena-report';
export { WebPackageRiskSummary } from '@mahoshojo/ui-web/arena-report';
import { BaseModal } from '@/components/shared/BaseModal';

export function WebPackageBaseRisk({ packageRef }: { packageRef: WebPackageRef }) {
  const [result, setResult] = useState<{digest:string;profile:WebPackageRiskProfile|null} | null>(null);
  useEffect(() => {
    let active = true;
    void resolveWebPackage(packageRef).then(base => scanWebPackageBase(base)).then(profile => {
      if (active) setResult({digest:packageRef.digest,profile});
    }).catch(() => { if (active) setResult({digest:packageRef.digest,profile:null}); });
    return () => { active = false; };
  }, [packageRef]);
  if (result?.digest !== packageRef.digest) return <p className="text-xs text-gray-500">正在本地预检 Web 包能力…</p>;
  return result.profile ? <WebPackageRiskSummary profile={result.profile} /> : <p className="text-xs text-amber-700">暂无法完成能力预检；未授予同源权限。</p>;
}

/** 仅在打开时挂载；父组件以 profile.fingerprint 为 key，不能沿用上一份内容的倒计时。 */
export function WebPackageTrustDialog({ profile, onCancel, onAllow }: {
  profile: WebPackageRiskProfile;
  onCancel: () => void;
  onAllow: (_remember: boolean) => void;
}) {
  const [seconds, setSeconds] = useState(3);
  const [remember, setRemember] = useState(false);
  const elapsed = useRef(0);
  useEffect(() => {
    let previous = performance.now();
    // 后台定时器会被节流；重新可见时不能把未执行 tick 的后台时间算作阅读时间。
    const resetClock = () => { previous = performance.now(); };
    document.addEventListener('visibilitychange', resetClock);
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (document.visibilityState !== 'hidden') elapsed.current += now - previous;
      previous = now;
      setSeconds(Math.max(0, Math.ceil((3000 - elapsed.current) / 1000)));
    }, 100);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resetClock);
    };
  }, []);
  const confirm = () => { if (elapsed.current >= 3000) onAllow(remember && profile.status === 'complete'); };
  return <BaseModal isOpen title="授予 Web 包本站同源权限" onClose={onCancel} maxWidthClassName="max-w-2xl">
    <div className="space-y-3 text-sm leading-6">
      <p className="font-semibold text-red-700 dark:text-red-300">这不是普通 Web 显示许可。此代码将获得接近本站自身脚本的权限，不能再依靠 iframe 隔离保护你的站内数据。</p>
      <p>它可能读取或修改本站浏览器存储和可访问的登录凭据，访问宿主页面，以你当前账号调用站内功能、消耗额度，并向网络发送可访问数据。关闭网页不一定能撤回已发送的信息或已执行的操作。</p>
      <p>仅对你自己制作、审查过或完全信任来源的 Web 包授权。拒绝不会阻止受限模式、生成、历史查看或下载。</p>
      <p className="break-all text-xs">{profile.packageRef.id}@{profile.packageRef.version}<br />包摘要：{profile.packageRef.digest}<br />生成摘要：{profile.generatedDigest}</p>
      <WebPackageRiskSummary profile={profile} expanded />
      <label className="flex items-start gap-2"><input type="checkbox" checked={remember} disabled={profile.status !== 'complete'} onChange={event => setRemember(event.target.checked)} className="mt-1" />
        <span>始终信任此包版本（仅本浏览器）。后续 AI 内容即使风险类别相同，也可能有不同的实际行为；此选项表示你接受这些不确定性。</span>
      </label>
      {profile.status !== 'complete' ? <p className="text-amber-700">扫描不完整，只能允许当前结果，不能保存长期信任。</p> : null}
      <div className="flex flex-wrap justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border px-4 py-2">继续受限模式</button>
        <button type="button" disabled={seconds > 0} onClick={confirm} className="min-h-11 rounded-lg bg-red-700 px-4 py-2 text-white disabled:opacity-50">
          {seconds > 0 ? `请阅读风险说明（${seconds}秒）` : remember ? '确认并保存此版本信任' : '仅允许本次结果'}
        </button>
      </div>
    </div>
  </BaseModal>;
}
