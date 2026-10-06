import type { ReactNode } from 'react';

import { qqGroups } from '../community/index';
import { homeAssetUrl, type HomeAssetSource } from '../home/feature-catalog';
import type { InternalLinkRenderProps, ExternalLinkRenderProps } from '../markdown/MarkdownBlock';

/**
 * 共源产品页脚（D5.1-P1 自 `apps/web/components/Footer.tsx` 上移）。
 *
 * 赞助、社群群号、署名与仓库链接是**产品内容**，两端展示同一份；但「点开之后发生什么」
 * 是宿主能力：Web 用 `<a target="_blank">` 原生打开，Desktop 走受控外链确认
 * （DESK-ONLINE-014）。因此每个链接都经过导航策略注入，而不是在这里写死 `<a>`：
 *
 * - 站内路径（百科）：`onNavigateInternal` 或 `renderInternalLink`；
 * - 站外 URL：`onNavigateExternal` 或 `renderExternalLink`；
 * - 两者都缺省：渲染成不可点击并说明原因，不给点了没反应的链接（DESK-PROD-001）。
 */
export interface ProductFooterProps {
  readonly className?: string;
  /** 深色页面上使用浅色爱发电 logo。 */
  readonly textWhite?: boolean;
  readonly assetSource: HomeAssetSource;
  readonly onNavigateInternal?: (href: string) => void;
  readonly renderInternalLink?: (link: InternalLinkRenderProps) => ReactNode;
  readonly onNavigateExternal?: (href: string) => void;
  readonly renderExternalLink?: (link: ExternalLinkRenderProps) => ReactNode;
  readonly externalBlockedReason?: string;
}

const DEFAULT_BLOCKED_REASON = '此链接需要在系统浏览器中打开，当前运行时未提供该能力';

export function ProductFooter({
  className = 'footer',
  textWhite = false,
  assetSource,
  onNavigateInternal,
  renderInternalLink,
  onNavigateExternal,
  renderExternalLink,
  externalBlockedReason = DEFAULT_BLOCKED_REASON,
}: ProductFooterProps) {
  const external = (href: string, label: ReactNode, title?: string): ReactNode => {
    const link = { href, title, className: 'footer-link', children: label };
    if (renderExternalLink) return <>{renderExternalLink(link)}</>;
    if (onNavigateExternal) {
      return (
        <a
          href={href}
          className="footer-link"
          title={title}
          onClick={(event) => {
            event.preventDefault();
            onNavigateExternal(href);
          }}
        >
          {label}
        </a>
      );
    }
    return (
      <span className="footer-link-disabled" title={externalBlockedReason}>
        {label}
      </span>
    );
  };

  const internal = (href: string, label: ReactNode): ReactNode => {
    const link = { href, className: 'footer-link', children: label };
    if (renderInternalLink) return <>{renderInternalLink(link)}</>;
    if (onNavigateInternal) {
      return (
        <a
          href={href}
          className="footer-link"
          onClick={(event) => {
            event.preventDefault();
            onNavigateInternal(href);
          }}
        >
          {label}
        </a>
      );
    }
    return (
      <a href={href} className="footer-link">
        {label}
      </a>
    );
  };

  return (
    <footer className={className} style={{ color: textWhite ? 'white' : '' }}>
      <p>本项目绝赞靠爱发电中，</p>
      <p>欢迎在爱发电上赞助我们！</p>
      <p style={{ textAlign: 'center', display: 'flex', justifyContent: 'center' }}>
        {external(
          'https://afdian.com/a/colanns',
          <img
            src={homeAssetUrl(assetSource, textWhite ? 'afdian-white.svg' : 'afdian.svg')}
            alt="afdian"
            width={120}
            height={20}
          />,
        )}
      </p>
      <p>
        交流群{' '}
        {qqGroups.map((group, index) => (
          <span key={group.groupCode}>
            {index > 0 ? ' / ' : null}
            {external(group.joinUrl, group.groupCode, group.name)}
          </span>
        ))}
      </p>
      <p>腾讯频道 {external('https://pd.qq.com/s/brisxifbl', 'pd73230758')}</p>
      <p>设计与制作 {external('https://github.com/notuhao', '@末伏之夜')}</p>
      <p>程序与美工 {external('https://github.com/colasama', '@Colanns')}</p>
      <p>
        本项目 AI 能力由&nbsp;
        {external('https://github.com/KouriChat/KouriChat', 'KouriChat')}
        &nbsp;&&nbsp;
        {external('https://api.kourichat.com/', 'Kouri API')}
        &nbsp;强力支持
      </p>
      <p>{external('https://docs.qq.com/form/page/DYmdrdWFQdmZCSGdZ', '反馈问题')}</p>
      <p>{internal('/encyclopedia', '百科')}</p>
      <p>{external('https://github.com/colasama/MahoShojo-Generator', 'colasama/MahoShojo-Generator')}</p>
    </footer>
  );
}
