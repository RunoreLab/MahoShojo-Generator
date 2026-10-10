'use client';

import { WEB_PACKAGE_RISK_LABELS, diffWebPackageDeclaration, webPackageRiskLabel, type WebPackageRiskProfile } from '@mahoshojo/web-package/security';

export function WebPackageRiskSummary({ profile, expanded = false, surface = 'page' }: {
  profile: WebPackageRiskProfile;
  expanded?: boolean;
  surface?: 'page' | 'on-dark';
}) {
  // 差异是「作者声明」唯一值得展示的内容。两份完整清单并排会互相削弱：读者会把作者
  // 自述当成授权范围，预检警告退化成"作者已经说过了"的附注。声明与预检一致或声明为
  // 空时不产生任何输出——那种情况下声明不提供任何信息。
  const diff = diffWebPackageDeclaration(profile);
  const labels = (values: readonly string[]) => values.map(webPackageRiskLabel).join('、');
  return <details open={expanded || undefined} className="rounded-lg border border-amber-400/30 p-3 text-sm" data-testid="web-package-risk-summary">
    <summary className="cursor-pointer font-medium">能力与权限预检 · {profile.status === 'complete' ? '已完成文本扫描' : '部分内容未扫描'}（不是安全认证）</summary>
    <div className="mt-2 space-y-2 break-words text-xs leading-5">
      <p>预检检测到：{profile.categories.map(webPackageRiskLabel).join('、') || '未发现已知匹配；不代表没有能力'}</p>
      {diff.undeclaredDetected.length ? <p>作者未声明，但预检检测到：{labels(diff.undeclaredDetected)}</p> : null}
      {diff.declaredNotDetected.length ? <p>作者声明了，预检未检测到：{labels(diff.declaredNotDetected)}（可能只是无害误报）</p> : null}
      {profile.externalOrigins.length ? <p>可见网络目的地：{profile.externalOrigins.join('、')}</p> : null}
      {profile.uncertainty.map(message => <p key={message} className={surface === 'on-dark' ? 'text-amber-300' : 'text-amber-700 dark:text-amber-300'}>⚠ {message}</p>)}
      {profile.findings.length ? <details><summary className="cursor-pointer">查看文件与匹配证据（{profile.findings.length}）</summary>
        <div className="mt-2 max-h-44 overflow-auto">{profile.findings.map((finding, index) => <p key={`${finding.path}:${finding.category}:${index}`}>
          {finding.source === 'overlay' ? 'AI 生成目标' : '基础包'} · {finding.path} · {WEB_PACKAGE_RISK_LABELS[finding.category]}<br />
          <code className="whitespace-pre-wrap">{finding.evidence}</code>
        </p>)}</div>
      </details> : null}
    </div>
  </details>;
}
