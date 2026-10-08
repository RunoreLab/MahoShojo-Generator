import type { ReactNode } from 'react';

import { ThemeImage } from '../media/ThemeImage';

export interface QuestionnairePageCardProps {
  variant: 'details' | 'canshou';
  /** 残兽问卷的说明随当前首份问卷更新，与品牌一起常驻。 */
  description?: string;
  /** 宿主保留自身内容的布局；本组件不决定问卷、草稿或结果的排列。 */
  className?: string;
  children: ReactNode;
}

/** 两端问卷页的卡片与常驻品牌区，独立于介绍/答题/草稿恢复状态。 */
export function QuestionnairePageCard({
  variant,
  description,
  className,
  children,
}: QuestionnairePageCardProps) {
  return (
    <div className={className ? `card ${className}` : 'card'}>
      <header className={variant === 'details' ? 'mb-4 flex items-center justify-center' : 'text-center mb-4'}>
        <h1 className="sr-only">{variant === 'details' ? '魔法少女问卷生成' : '残兽问卷生成'}</h1>
        {variant === 'details' ? (
          <img src="/questionnaire-logo.svg" width={250} height={160} alt="Questionnaire Logo" />
        ) : (
          <>
            <ThemeImage lightSrc="/beast-logo.svg" darkSrc="/beast-logo-white.svg" className="w-full px-8" alt="残兽调查" />
            {description && <p className="text-gray-600 mt-2">{description}</p>}
          </>
        )}
      </header>
      {children}
    </div>
  );
}
