import type { ReactNode } from 'react';
import type { InternalLinkRenderProps } from '../markdown/MarkdownBlock';

export type QuestionnaireEditorPageViewProps = {
  children: ReactNode;
  footer?: ReactNode;
  libraryLabel?: string;
  renderLink: (props: InternalLinkRenderProps) => ReactNode;
};

/** Web 的真实页框与品牌区；宿主仅注入库能力文案、路由和编辑/保存行为。 */
export function QuestionnaireEditorPageView({ children, footer, libraryLabel = '云端问卷库', renderLink }: QuestionnaireEditorPageViewProps) {
  return <div className="magic-background-white">
    <div className="container !max-w-[1100px]">
      <div className="card !max-w-none">
        <h1 className="sr-only">问卷编辑器</h1>
        <div className="text-center mb-6">
          <div className="flex justify-center">
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-fuchsia-500 px-6 py-3 shadow-lg">
              <img src="/questionnaire-title.svg" alt="问卷编辑器" className="h-8 w-auto" />
            </div>
          </div>
          <p className="subtitle mt-3">把问卷当作可维护的创作工具箱</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
            <span className="rounded-full bg-pink-100 px-3 py-1 text-pink-700">条件显示 / 跳题</span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">{libraryLabel}</span>
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-700">JSON 导入 / 导出</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          {renderLink({ href: '/details', className: 'rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-pink-700 hover:border-pink-300 hover:bg-pink-100', children: '前往魔法少女问卷' })}
          {renderLink({ href: '/canshou', className: 'rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700 hover:border-rose-300 hover:bg-rose-100', children: '前往残兽问卷' })}
        </div>
        {children}
      </div>
      {footer}
    </div>
  </div>;
}
