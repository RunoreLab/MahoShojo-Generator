import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps, type Options } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import {
  DENY_EXTERNAL_MEDIA,
  formatMarkdownImage,
  formatMarkdownLink,
  isExternalMarkdownHref,
  normalizeMarkdownHref,
  type ExternalMediaKind,
  type ExternalMediaPolicy,
} from './external-media';
import { createHeadingSlugger } from './heading-slug';
import { fixNestedListIndentation } from './fix-nested-list-indentation';

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> & ExtraProps & { inline?: boolean };

/**
 * remark / rehype 插件注入。
 *
 * 它们**由宿主提供**而不是在这里写死：`apps/web` 的竞技场战报表格（`remarkBattleTable`）是竞技场
 * 领域知识，把它放进共享包等于让 Desktop 的百科页面依赖竞技场规则，也违反
 * `packages/README.md`「`ui-web` 不成为倾倒包」。共享层自带的是 GFM 与数学公式这两条所有消费者
 * 都需要、又与领域无关的规则。
 *
 * 类型从 `react-markdown` 自己的 `Options` 反推，而不是直接引 `unified`：后者不是本包的依赖，
 * 声明它只为了拿一个类型会给客户端包增加一条无运行时收益的安装边。
 */
export type MarkdownPlugin = NonNullable<NonNullable<Options['remarkPlugins']>[number]>;

export interface InternalLinkRenderProps {
  readonly href: string;
  readonly title?: string | undefined;
  readonly className: string;
  readonly children: ReactNode;
}

/**
 * 链接策略。
 *
 * 两个方向各自独立，且都可以缺省：
 *
 * - **站内**产品路径：宿主可以只给 `onNavigateInternal`（拦截点击，其余用默认 `<a>`），也可以给
 *   `renderInternalLink` 换掉整个元素（Web 用 Next 的 `<Link>` 拿到客户端路由）。两者都不给时就是
 *   普通 `<a href>`，即浏览器默认导航。
 * - **站外**链接：缺省 `onNavigateExternal` 时渲染成**不可点击并说明原因**，而不是留一个点了没反应的
 *   链接。这与 `ProductNav` 的处理是同一套形状：Desktop 目前没有 opener 能力，于是站外内容在该运行时
 *   里就是不可执行的，而不是「看起来能点但什么也不发生」。
 */
export type MarkdownNavigationPolicy = {
  readonly onNavigateInternal?: ((href: string) => void) | undefined;
  readonly renderInternalLink?: ((link: InternalLinkRenderProps) => ReactNode) | undefined;
  readonly onNavigateExternal?: ((href: string) => void) | undefined;
  readonly externalBlockedReason?: string;
};

export type MarkdownBlockVariant = 'light' | 'dark';
export type MarkdownBlockMode = 'compact' | 'article';

export interface MarkdownBlockProps extends MarkdownNavigationPolicy {
  content: string;
  variant?: MarkdownBlockVariant;
  mode?: MarkdownBlockMode;
  className?: string;
  /**
   * 是否给 heading 生成 `id`。
   *
   * 缺省 `false`。百科条目页会显式开启，而竞技场与魔法茶会渲染的是 AI 生成与用户输入内容——
   * heading `id` 会进入 DOM 并可被 fragment 引用，官方插件因此建议面向不可信内容时配 sanitize。
   * 对那两类内容默认不写 `id`，比"全局开启再想办法 sanitize"更保守，也更少改动既有行为。
   */
  headingIds?: false | 'github';
  /** 站外媒体策略。缺省拒绝一切站外媒体，见 {@link DENY_EXTERNAL_MEDIA}。 */
  externalMediaPolicy?: ExternalMediaPolicy;
  /** 宿主的 remark 插件，按需追加在 GFM 与数学之后。 */
  remarkPlugins?: readonly MarkdownPlugin[];
  /** 宿主的 rehype 插件，按需追加在 KaTeX 之后。 */
  rehypePlugins?: readonly MarkdownPlugin[];
}

const linkClassNameFor = (variant: MarkdownBlockVariant): string =>
  variant === 'light' ? 'text-blue-700' : 'text-blue-200';

const DEFAULT_EXTERNAL_BLOCKED_REASON = '此链接需要在系统浏览器中打开，当前运行时未提供该能力';

/**
 * 把 `/encyclopedia/<slug>[#fragment]` 判成站内百科链接。
 *
 * 这里**只校验 pathname**。fragment 交由 URL 本身处理：它是 URL 的一个片段，可以是任意经过
 * percent-encoding 的字符串，而旧实现用 `[A-Za-z0-9-_]+` 匹配它，结果是所有中文标题的锚点链接
 * 都被判死——中文标题的锚点因此完全不可用（`D3.0-5`）。
 */
const getEncyclopediaHrefFromInlineCode = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/encyclopedia/')) return null;

  const [pathname, ...rest] = trimmed.split('#');
  if (!/^\/encyclopedia\/[a-z0-9-]+$/.test(pathname)) return null;

  return rest.length > 0 ? `${pathname}#${rest.join('#')}` : pathname;
};

const flattenText = (children: ReactNode): string => {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    return children.filter((child): child is string => typeof child === 'string').join('');
  }
  return '';
};

export function MarkdownBlock({
  content,
  variant = 'dark',
  mode = 'compact',
  className,
  headingIds = false,
  externalMediaPolicy = DENY_EXTERNAL_MEDIA,
  onNavigateInternal,
  renderInternalLink,
  onNavigateExternal,
  externalBlockedReason = DEFAULT_EXTERNAL_BLOCKED_REASON,
  remarkPlugins = [],
  rehypePlugins = [],
}: MarkdownBlockProps) {
  const borderClass = variant === 'light' ? 'border-gray-200' : 'border-white/15';
  const headerBgClass = variant === 'light' ? 'bg-gray-50' : 'bg-white/10';
  const cellBorderClass = variant === 'light' ? 'border-gray-200' : 'border-white/10';
  const rowDividerClass = variant === 'light' ? 'divide-gray-200' : 'divide-white/10';
  const textClass = variant === 'light' ? 'text-gray-800' : 'text-white/90';
  const mutedTextClass = variant === 'light' ? 'text-gray-600' : 'text-white/70';

  const isArticle = mode === 'article';
  const paragraphClass = isArticle
    ? `my-3 whitespace-normal break-words leading-7 ${textClass}`
    : `my-0 whitespace-pre-wrap break-words leading-relaxed ${textClass}`;
  const unorderedListClass = isArticle
    ? `my-3 list-disc pl-6 space-y-1 ${textClass}`
    : `my-1 list-disc pl-5 space-y-1 ${textClass}`;
  const orderedListClass = isArticle
    ? `my-3 list-decimal pl-6 space-y-1 ${textClass}`
    : `my-1 list-decimal pl-5 space-y-1 ${textClass}`;
  const blockquoteClass = isArticle
    ? `my-4 border-l-4 ${borderClass} pl-4 text-sm leading-6 ${mutedTextClass} [&>p]:my-1 [&>p]:leading-6`
    : `my-2 border-l-4 ${borderClass} pl-3 ${mutedTextClass}`;
  const hrClass = isArticle ? `my-6 ${borderClass}` : `my-3 ${borderClass}`;
  const preClass = isArticle
    ? `my-4 overflow-x-auto rounded-lg border ${borderClass} bg-black/10 p-3 text-xs leading-relaxed ${textClass}`
    : `my-2 overflow-x-auto rounded-lg border ${borderClass} bg-black/10 p-3 text-xs leading-relaxed ${textClass}`;

  /**
   * slug 分配器。
   *
   * 它在渲染期间创建，因此**每次渲染都是新的**——这正是需要的：一篇文章内同名标题要消解，而两次
   * 渲染之间不需要保留任何状态（重新渲染时 heading 集合相同，结果也相同）。
   */
  const slugHeading = headingIds === 'github' ? createHeadingSlugger() : null;

  const headingId = (children: ReactNode): string | undefined =>
    slugHeading === null ? undefined : slugHeading(flattenText(children));

  const externalLink = (
    href: string,
    label: ReactNode,
    linkClassName: string,
    title?: string,
  ) => {
    if (onNavigateExternal) {
      return (
        <a
          href={href}
          title={title}
          className={linkClassName}
          onClick={(event) => {
            event.preventDefault();
            onNavigateExternal(href);
          }}
        >
          {label}
        </a>
      );
    }

    // 没有打开方式时宁可说明原因，也不留一个点了没反应的链接。
    return (
      <span className={`${linkClassName} cursor-not-allowed underline underline-offset-2`} title={externalBlockedReason}>
        {label}
      </span>
    );
  };

  const internalLink = (href: string, children: ReactNode, title: string | undefined, className: string) => {
    if (renderInternalLink) {
      return <>{renderInternalLink({ href, title, className, children })}</>;
    }

    if (onNavigateInternal) {
      return (
        <a
          href={href}
          title={title}
          className={className}
          onClick={(event) => {
            event.preventDefault();
            onNavigateInternal(href);
          }}
        >
          {children}
        </a>
      );
    }

    return (
      <a href={href} title={title} className={className}>
        {children}
      </a>
    );
  };

  const components: Components = {
    h1: ({ children }) =>
      isArticle ? (
        <h2 id={headingId(children)} className={`mt-8 mb-3 text-lg font-semibold leading-tight first:mt-0 ${textClass}`}>
          {children}
        </h2>
      ) : (
        <h3 id={headingId(children)} className={`mt-3 mb-2 text-base font-semibold ${textClass}`}>
          {children}
        </h3>
      ),
    h2: ({ children }) =>
      isArticle ? (
        <h3 id={headingId(children)} className={`mt-7 mb-3 text-base font-semibold leading-tight ${textClass}`}>
          {children}
        </h3>
      ) : (
        <h4 id={headingId(children)} className={`mt-3 mb-2 text-sm font-semibold ${textClass}`}>
          {children}
        </h4>
      ),
    h3: ({ children }) =>
      isArticle ? (
        <h4 id={headingId(children)} className={`mt-5 mb-2 text-sm font-semibold leading-tight ${textClass}`}>
          {children}
        </h4>
      ) : (
        <h5 id={headingId(children)} className={`mt-2 mb-1 text-sm font-semibold ${textClass}`}>
          {children}
        </h5>
      ),
    h4: ({ children }) => (
      <h6 id={headingId(children)} className={`mt-4 mb-2 text-sm font-semibold ${textClass}`}>
        {children}
      </h6>
    ),
    h5: ({ children }) => (
      <h6 id={headingId(children)} className={`mt-3 mb-1 text-sm font-semibold ${textClass}`}>
        {children}
      </h6>
    ),
    h6: ({ children }) => (
      <h6 id={headingId(children)} className={`mt-3 mb-1 text-sm font-semibold ${textClass}`}>
        {children}
      </h6>
    ),
    p: ({ children }) => <p className={paragraphClass}>{children}</p>,
    ul: ({ children }) => <ul className={unorderedListClass}>{children}</ul>,
    ol: ({ children }) => <ol className={orderedListClass}>{children}</ol>,
    li: ({ children }) => <li className="break-words">{children}</li>,
    a: ({ href, title, children, ...props }) => {
      const rawHref = typeof href === 'string' ? href : '';
      const linkClassName = [
        'underline underline-offset-2 transition-opacity hover:opacity-100',
        variant === 'light' ? 'text-blue-700 opacity-95' : 'text-blue-200 opacity-90',
      ].join(' ');

      const linkKind = rawHref ? externalMediaPolicy.detectKind(rawHref) : null;
      if (rawHref && linkKind !== null && linkKind !== 'image') {
        const kind: ExternalMediaKind = linkKind;
        const label = flattenText(children) || (kind === 'audio' ? '播放音频' : '播放视频');

        if (!externalMediaPolicy.isAllowed(rawHref, kind)) {
          return (
            <code
              className={`font-mono text-xs rounded px-1 py-0.5 break-all ${
                variant === 'light' ? 'bg-gray-100 text-gray-800' : 'bg-white/10 text-pink-200'
              }`}
            >
              {formatMarkdownLink(label, rawHref, title)}
            </code>
          );
        }

        const src = externalMediaPolicy.resolve(rawHref, kind);
        return (
          <span className="inline-flex max-w-full flex-col gap-1 align-middle">
            {kind === 'audio' ? (
              <audio controls preload="none" src={src} className="h-8 max-w-full" />
            ) : (
              <video
                controls
                preload="metadata"
                playsInline
                src={src}
                className={`my-2 max-w-full rounded-md border ${borderClass}`}
              />
            )}
            {externalLink(src, label, `text-[11px] ${linkClassName}`, title)}
          </span>
        );
      }

      const normalizedHref = rawHref ? normalizeMarkdownHref(rawHref) : '';

      if (isExternalMarkdownHref(normalizedHref)) {
        return externalLink(normalizedHref, children, linkClassName, title);
      }

      if (normalizedHref.startsWith('/')) {
        return internalLink(normalizedHref, children, title, linkClassName);
      }

      return (
        <a href={rawHref} title={title} className={linkClassName} {...props}>
          {children}
        </a>
      );
    },
    blockquote: ({ children }) => <blockquote className={blockquoteClass}>{children}</blockquote>,
    hr: () => <hr className={hrClass} />,
    pre: ({ children }) => <pre className={preClass}>{children}</pre>,
    code: ({ inline, className: codeClassName, children, node, ...props }: MarkdownCodeProps) => {
      void node;

      const text = flattenText(children);
      const looksLikeBlock = Boolean(codeClassName && /\blanguage-/.test(codeClassName)) || text.includes('\n');
      const isInline = typeof inline === 'boolean' ? inline : !looksLikeBlock;

      if (isInline) {
        const encyclopediaHref = getEncyclopediaHrefFromInlineCode(text);
        if (encyclopediaHref) {
          const codeClass = `font-mono text-xs rounded px-1 py-0.5 ${
            variant === 'light' ? 'bg-gray-100 text-gray-800' : 'bg-white/10 text-pink-200'
          } underline underline-offset-2 decoration-dotted hover:decoration-solid`;
          return internalLink(
            encyclopediaHref,
            <code className={codeClass} {...props}>
              {text}
            </code>,
            '打开对应百科条目',
            'inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300',
          );
        }
      }

      return isInline ? (
        <code
          className={`font-mono text-xs rounded px-1 py-0.5 ${variant === 'light' ? 'bg-gray-100 text-gray-800' : 'bg-white/10 text-pink-200'}`}
          {...props}
        >
          {children}
        </code>
      ) : (
        <code className={['font-mono text-xs', codeClassName].filter(Boolean).join(' ')} {...props}>
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <div className={`my-2 overflow-x-auto rounded-lg border ${borderClass} bg-black/10`}>
        <table className={`min-w-full border-collapse text-left text-sm ${textClass}`}>{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className={headerBgClass}>{children}</thead>,
    // 全局深色模式会重写基础的 bg-white/bg-gray-* utility。
    // odd:/even: 前缀会生成不同的选择器，无法命中该兼容层，因此浅色表格的
    // 行背景不能直接使用 odd:bg-white / even:bg-gray-*。
    tbody: ({ children }) => (
      <tbody className={`divide-y ${rowDividerClass}${variant === 'light' ? ' bg-white' : ''}`}>{children}</tbody>
    ),
    tr: ({ children }) => (
      <tr className={variant === 'light' ? 'even:bg-black/5' : 'odd:bg-white/5'}>
        {children}
      </tr>
    ),
    th: ({ children }) => (
      <th className={`px-3 py-2 font-semibold border-b ${cellBorderClass} whitespace-nowrap`}>{children}</th>
    ),
    td: ({ children }) => (
      <td
        className={`px-3 py-2 align-top border-b ${variant === 'light' ? 'border-gray-100' : 'border-white/5'} whitespace-pre-wrap break-words`}
      >
        {children}
      </td>
    ),
    img: ({ src, alt, title, ...props }) => {
      const rawSrc = typeof src === 'string' ? src : '';
      const kind: ExternalMediaKind = externalMediaPolicy.detectKind(rawSrc) ?? 'image';
      const label = typeof alt === 'string' && alt.trim() ? alt.trim() : '播放音频';

      if (!externalMediaPolicy.isAllowed(rawSrc, kind)) {
        return (
          <code
            className={`font-mono text-xs rounded px-1 py-0.5 break-all ${
              variant === 'light' ? 'bg-gray-100 text-gray-800' : 'bg-white/10 text-pink-200'
            }`}
          >
            {kind === 'image' ? formatMarkdownImage(label, rawSrc, title) : formatMarkdownLink(label, rawSrc, title)}
          </code>
        );
      }

      const normalizedSrc = externalMediaPolicy.resolve(rawSrc, kind);
      if (kind === 'audio') {
        return (
          <span className="inline-flex max-w-full flex-col gap-1 align-middle">
            <audio controls preload="none" src={normalizedSrc} className="h-8 max-w-full" />
            {externalLink(normalizedSrc, label, `text-[11px] ${linkClassNameFor(variant)}`, title)}
          </span>
        );
      }

      if (kind === 'video') {
        return (
          <span className="inline-flex max-w-full flex-col gap-1 align-middle">
            <video
              controls
              preload="metadata"
              playsInline
              src={normalizedSrc}
              className={`my-2 max-w-full rounded-md border ${borderClass}`}
            />
            {externalLink(normalizedSrc, label, `text-[11px] ${linkClassNameFor(variant)}`, title)}
          </span>
        );
      }

      return (
        <img
          src={normalizedSrc}
          alt={typeof alt === 'string' ? alt : ''}
          title={typeof title === 'string' ? title : undefined}
          className={`my-2 max-w-full rounded-md border ${variant === 'light' ? 'border-gray-200' : 'border-white/10'}`}
          loading="lazy"
          {...props}
        />
      );
    },
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...remarkPlugins, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }], ...rehypePlugins]}
        components={components}
      >
        {fixNestedListIndentation(content)}
      </ReactMarkdown>
    </div>
  );
}
