type CreatorMainStageProps = {
  stage: 'status' | 'intro' | 'questionnaire' | 'result';
  title?: string;
  content: React.ReactNode;
};

export function CreatorMainStage({ stage, title, content }: CreatorMainStageProps) {
  return (
    <section
      className="rounded-[28px] border p-5 sm:p-6 xl:p-8"
      style={{
        borderColor: 'var(--app-border-strong)',
        background: 'var(--app-surface-90)',
        boxShadow: 'var(--app-card-shadow)',
        backdropFilter: 'blur(10px)',
      }}
    >
      {title ? <div className="mb-4 text-xl font-semibold text-slate-900">{title}</div> : null}
      <div data-creator-stage={stage}>{content}</div>
    </section>
  );
}
