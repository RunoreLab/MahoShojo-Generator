import type { ReactNode } from 'react';

/** 宿主决定必答/跳过/提交与生成确认；共享层只拥有操作区及可访问性。 */
export interface QuestionnaireNavigationActionsProps {
  prevLabel: string;
  nextButtonContent: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  disablePrev?: boolean;
  disableNext?: boolean;
}

export function QuestionnaireNavigationActions({
  prevLabel, nextButtonContent, onPrev, onNext, disablePrev, disableNext,
}: QuestionnaireNavigationActionsProps) {
  return (
    <div className="ui-web-questionnaire-navigation" role="group" aria-label="问卷翻页操作">
      <button type="button"
        className="ui-web-questionnaire-step-button ui-web-questionnaire-step-button--previous"
        onClick={onPrev} disabled={disablePrev}>
        {prevLabel}
      </button>
      <button type="button"
        className="ui-web-questionnaire-step-button"
        onClick={onNext} disabled={disableNext}>
        {nextButtonContent}
      </button>
    </div>
  );
}
