import type { ExternalLinkRenderProps } from '@mahoshojo/ui-web/markdown';

/** Web 保留浏览器原生链接行为，包括修饰键点击、复制地址和新标签页打开。 */
export const renderWebExternalLink = ({ href, title, className, children }: ExternalLinkRenderProps) => (
  <a href={href} title={title} className={className} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);
