type CreatorQuestionnaireSidebarPanelProps = {
  navigator: React.ReactNode;
  settings: React.ReactNode;
  answerReview: React.ReactNode;
};

export function CreatorQuestionnaireSidebarPanel({
  navigator,
  settings,
  answerReview,
}: CreatorQuestionnaireSidebarPanelProps) {
  return (
    <div className="space-y-4">
      <div>{navigator}</div>
      <div>{settings}</div>
      <div>{answerReview}</div>
    </div>
  );
}
