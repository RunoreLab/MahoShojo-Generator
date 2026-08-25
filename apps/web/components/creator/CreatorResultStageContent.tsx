import type { ReactNode } from 'react';

type CreatorResultStageContentProps = {
  questionnaireEditor?: ReactNode;
  resultContent: ReactNode;
};

export function CreatorResultStageContent({
  questionnaireEditor,
  resultContent,
}: CreatorResultStageContentProps) {
  return (
    <div className="space-y-6">
      {questionnaireEditor ? (
        <section data-creator-result-block="questionnaire" className="space-y-4">
          <div className="rounded-2xl border border-pink-100 bg-pink-50/80 px-4 py-3 text-sm text-pink-700">
            继续编辑问卷
          </div>
          {questionnaireEditor}
        </section>
      ) : null}
      <section data-creator-result-block="result">
        {resultContent}
      </section>
    </div>
  );
}
