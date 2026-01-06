import Link from 'next/link';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';

import remarkBattleTable from '@/lib/markdown/remarkBattleTable';

type MarkdownCodeProps = React.ComponentPropsWithoutRef<'code'> & ExtraProps & { inline?: boolean };

export type MarkdownBlockVariant = 'light' | 'dark';
export type MarkdownBlockMode = 'compact' | 'article';

export interface MarkdownBlockProps {
  content: string;
  variant?: MarkdownBlockVariant;
  mode?: MarkdownBlockMode;
  className?: string;
}

const getEncyclopediaHrefFromInlineCode = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/encyclopedia/')) return null;
  const match = trimmed.match(/^\/encyclopedia\/[a-z0-9-]+(?:#[A-Za-z0-9-_]+)?$/);
  return match ? trimmed : null;
};

export function MarkdownBlock({ content, variant = 'dark', mode = 'compact', className }: MarkdownBlockProps) {
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

  const components: Components = {
    h1: ({ children }) =>
      isArticle ? (
        <h2 className={`mt-8 mb-3 text-lg font-semibold leading-tight first:mt-0 ${textClass}`}>{children}</h2>
      ) : (
        <h3 className={`mt-3 mb-2 text-base font-semibold ${textClass}`}>{children}</h3>
      ),
    h2: ({ children }) =>
      isArticle ? (
        <h3 className={`mt-7 mb-3 text-base font-semibold leading-tight ${textClass}`}>{children}</h3>
      ) : (
        <h4 className={`mt-3 mb-2 text-sm font-semibold ${textClass}`}>{children}</h4>
      ),
    h3: ({ children }) =>
      isArticle ? (
        <h4 className={`mt-5 mb-2 text-sm font-semibold leading-tight ${textClass}`}>{children}</h4>
      ) : (
        <h5 className={`mt-2 mb-1 text-sm font-semibold ${textClass}`}>{children}</h5>
      ),
    p: ({ children }) => <p className={paragraphClass}>{children}</p>,
    ul: ({ children }) => <ul className={unorderedListClass}>{children}</ul>,
    ol: ({ children }) => <ol className={orderedListClass}>{children}</ol>,
    li: ({ children }) => <li className="break-words">{children}</li>,
    a: ({ href, children, ...props }) => {
      const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href);
      return (
        <a
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          className={[
            'underline underline-offset-2 transition-opacity hover:opacity-100',
            variant === 'light' ? 'text-blue-700 opacity-95' : 'text-blue-200 opacity-90',
          ].join(' ')}
          {...props}
        >
          {children}
        </a>
      );
    },
    blockquote: ({ children }) => <blockquote className={blockquoteClass}>{children}</blockquote>,
    hr: () => <hr className={hrClass} />,
    pre: ({ children }) => <pre className={preClass}>{children}</pre>,
    code: ({ inline, className: codeClassName, children, node, ...props }: MarkdownCodeProps) => {
      void node;

      const text =
        typeof children === 'string'
          ? children
          : Array.isArray(children)
            ? children.filter((child): child is string => typeof child === 'string').join('')
            : '';

      const looksLikeBlock = Boolean(codeClassName && /\blanguage-/.test(codeClassName)) || text.includes('\n');
      const isInline = typeof inline === 'boolean' ? inline : !looksLikeBlock;

      if (isInline) {
        const encyclopediaHref = getEncyclopediaHrefFromInlineCode(text);
        if (encyclopediaHref) {
          return (
            <Link
              href={encyclopediaHref}
              className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
              title="打开对应百科条目"
            >
              <code
                className={`font-mono text-xs rounded px-1 py-0.5 ${
                  variant === 'light' ? 'bg-gray-100 text-gray-800' : 'bg-white/10 text-pink-200'
                } underline underline-offset-2 decoration-dotted hover:decoration-solid`}
                {...props}
              >
                {text}
              </code>
            </Link>
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
    tbody: ({ children }) => <tbody className={`divide-y ${rowDividerClass}`}>{children}</tbody>,
    tr: ({ children }) => <tr className={variant === 'light' ? 'odd:bg-white even:bg-gray-50/40' : 'odd:bg-white/5'}>{children}</tr>,
    th: ({ children }) => (
      <th className={`px-3 py-2 font-semibold border-b ${cellBorderClass} whitespace-nowrap`}>{children}</th>
    ),
    td: ({ children }) => (
      <td className={`px-3 py-2 align-top border-b ${variant === 'light' ? 'border-gray-100' : 'border-white/5'} whitespace-pre-wrap break-words`}>
        {children}
      </td>
    ),
  };

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkBattleTable]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
