type FreeformBriefPanelProps = {
  value: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
};

export function FreeformBriefPanel({
  value,
  onChange,
  disabled = false,
}: FreeformBriefPanelProps) {
  return (
    <section className="rounded-2xl border border-amber-100 bg-white/85 p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-amber-900">自由补充说明</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          用于描述创作要求、口吻偏好、禁忌与其他无法自然放进问卷或规则块的要求。
        </p>
      </div>
      <label className="block text-xs font-medium text-slate-700" htmlFor="creator-freeform-brief">
        创作要求
      </label>
      <textarea
        id="creator-freeform-brief"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="例如：写成冷淡但克制的口吻；强调战斗机动与高压炮击；不要出现现实隐私信息。"
        className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-inner outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-50"
      />
    </section>
  );
}
