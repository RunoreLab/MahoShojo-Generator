interface FreeformBriefPanelProps {
  value: string;
  onChange: (value: string) => void;
}

export function FreeformBriefPanel({
  value,
  onChange,
}: FreeformBriefPanelProps) {
  return (
    <section className="input-group">
      <label className="input-label">自由文本补充</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-field min-h-[160px] resize-y"
        placeholder="例如：写成冷淡、克制但危险的口吻；避免恋爱桥段；强调竞技场出身与收藏型对战节奏。"
      />
      <p className="mt-2 text-xs text-gray-500">
        这里承载无法自然放进问卷或规则块的创作要求。优先于问卷说明，但不会覆盖主规则固定事实。
      </p>
    </section>
  );
}
