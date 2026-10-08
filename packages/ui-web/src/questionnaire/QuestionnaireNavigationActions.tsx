import type { ReactNode } from 'react';

/** 宿主决定必答/跳过/提交与生成确认；共享层只拥有操作区及可访问性。 */
export interface QuestionnaireNavigationActionsProps {
  prevLabel: string;
  nextButtonContent: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  disablePrev?: boolean;
  disableNext?: boolean;
  /** 旧 Creator 入口兼容；Details/Canshou 使用共享默认样式。 */
  prevButtonClass?: string;
  nextButtonClass?: string;
}

export function QuestionnaireNavigationActions({
  prevLabel, nextButtonContent, onPrev, onNext, disablePrev, disableNext,
  prevButtonClass, nextButtonClass,
}: QuestionnaireNavigationActionsProps) {
  const hasLegacyClasses = Boolean(prevButtonClass || nextButtonClass);
  return (
    <div className={hasLegacyClasses ? 'mt-4 flex flex-col sm:flex-row gap-2' : 'ui-web-questionnaire-navigation'} role="group" aria-label="问卷翻页操作">
      <button type="button"
        className={prevButtonClass ?? 'ui-web-questionnaire-step-button ui-web-questionnaire-step-button--previous'}
        onClick={onPrev} disabled={disablePrev}>
        {prevLabel}
      </button>
      <button type="button"
        className={nextButtonClass ?? 'ui-web-questionnaire-step-button'}
        onClick={onNext} disabled={disableNext}>
        {nextButtonContent}
      </button>
    </div>
  );
}
