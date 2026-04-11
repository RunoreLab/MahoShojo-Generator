type CreatorOverviewCardProps = {
  stageLabel: string;
  progressLabel: string;
  templateLabel: string;
  primaryRuleLabel: string;
  nativeHint: string;
};

export function CreatorOverviewCard({
  stageLabel,
  progressLabel,
  templateLabel,
  primaryRuleLabel,
  nativeHint,
}: CreatorOverviewCardProps) {
  return (
    <div className="rounded-2xl border border-sky-100 bg-white/90 p-4 shadow-sm">
      <div className="text-xs uppercase tracking-[0.28em] text-sky-500">创作概况</div>
      <div className="mt-3 space-y-2 text-sm text-slate-700">
        <div>阶段：{stageLabel}</div>
        <div>进度：{progressLabel}</div>
        <div>模板：{templateLabel}</div>
        <div>主规则：{primaryRuleLabel}</div>
        <div>{nativeHint}</div>
      </div>
    </div>
  );
}
