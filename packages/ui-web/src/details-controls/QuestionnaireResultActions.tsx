import type { ReactNode } from 'react';

export interface QuestionnaireResultActionsProps {
  variant: 'details' | 'canshou';
  children: ReactNode;
  sizeIndicator?: ReactNode;
  status?: ReactNode;
  regenerateAction?: ReactNode;
  resolveInternalHref?: (href: string) => string;
  onNavigate?: (href: string) => void;
  renderLink?: (props: { href: string; className: string; children: ReactNode }) => ReactNode;
}

/** 自 Web 问卷结果抽出的完整保存卡片；文件/卡库能力由宿主注入。 */
export function QuestionnaireResultActions({
  variant, children, sizeIndicator, status, regenerateAction,
  resolveInternalHref = (href) => href, onNavigate, renderLink,
}: QuestionnaireResultActionsProps) {
  const isDetails = variant === 'details';
  const link = {
    href: resolveInternalHref('/battle'),
    className: `footer-link text-lg${isDetails ? '' : ' text-purple-600'}`,
    children: isDetails ? '前往竞技场，开始战斗！→' : '前往竞技场，让它大闹一场！→',
  };
  return (
    <section aria-label="保存原始数据" className="card" style={{ marginTop: '1rem' }}>
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-800" style={{ marginBottom: '1rem' }}>{isDetails ? '保存人物设定' : '后续操作'}</h3>
        <div className={isDetails ? 'flex flex-col gap-3' : 'flex flex-col sm:flex-row gap-3 justify-center'}>{children}</div>
        {status}
        {sizeIndicator}
        {regenerateAction}
        <div className="mt-2 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-600 mb-2">{isDetails ? '保存好你的设定文件了吗？' : '保存好你的档案了吗？'}</p>
          {renderLink ? renderLink(link) : <a {...link} onClick={(event) => {
            if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); onNavigate('/battle');
          }} />}
        </div>
      </div>
    </section>
  );
}
