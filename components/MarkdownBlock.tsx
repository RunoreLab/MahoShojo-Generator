import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';

import remarkBattleTable from '@/lib/markdown/remarkBattleTable';

type MarkdownCodeProps = React.ComponentPropsWithoutRef<'code'> & ExtraProps & { inline?: boolean };

export type MarkdownBlockVariant = 'light' | 'dark';

export interface MarkdownBlockProps {
  content: string;
  variant?: MarkdownBlockVariant;
  className?: string;
}

export function MarkdownBlock({ content, variant = 'dark', className }: MarkdownBlockProps) {
  const borderClass = variant === 'light' ? 'border-gray-200' : 'border-white/15';
  const headerBgClass = variant === 'light' ? 'bg-gray-50' : 'bg-white/10';
  const cellBorderClass = variant === 'light' ? 'border-gray-200' : 'border-white/10';
  const rowDividerClass = variant === 'light' ? 'divide-gray-200' : 'divide-white/10';
  const textClass = variant === 'light' ? 'text-gray-800' : 'text-white/90';
  const mutedTextClass = variant === 'light' ? 'text-gray-600' : 'text-white/70';

  const components: Components = {
    h1: ({ children }) => <h3 className={`mt-3 mb-2 text-base font-semibold ${textClass}`}>{children}</h3>,
    h2: ({ children }) => <h4 className={`mt-3 mb-2 text-sm font-semibold ${textClass}`}>{children}</h4>,
    h3: ({ children }) => <h5 className={`mt-2 mb-1 text-sm font-semibold ${textClass}`}>{children}</h5>,
    p: ({ children }) => (
      <p className={`my-0 whitespace-pre-wrap break-words leading-relaxed ${textClass}`}>{children}</p>
    ),
    ul: ({ children }) => <ul className={`my-1 list-disc pl-5 space-y-1 ${textClass}`}>{children}</ul>,
    ol: ({ children }) => <ol className={`my-1 list-decimal pl-5 space-y-1 ${textClass}`}>{children}</ol>,
    li: ({ children }) => <li className="break-words">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className={`my-2 border-l-4 ${borderClass} pl-3 ${mutedTextClass}`}>{children}</blockquote>
    ),
    hr: () => <hr className={`my-3 ${borderClass}`} />,
    pre: ({ children }) => (
      <pre className={`my-2 overflow-x-auto rounded-lg border ${borderClass} bg-black/10 p-3 text-xs leading-relaxed ${textClass}`}>
        {children}
      </pre>
    ),
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

