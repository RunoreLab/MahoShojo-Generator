'use client';

type Props = {
  techScore: number | null;
  techLevel: string | null;
  mode?: 'full' | 'level';
  className?: string;
};

const hasTextColorClass = (className?: string) =>
  typeof className === 'string' &&
  /(?:^|\s|:)!?text-(?:black|white|transparent|current|inherit|[a-z]+-\d{2,3})(?:\/\d{1,3})?(?=\s|$)/.test(className);

const levelClassNameMap: Record<string, string> = {
  L0: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200',
  L1: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
  L2: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  L3: 'bg-violet-50 text-violet-800 ring-1 ring-violet-200',
  L4: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
  L5: 'bg-rose-50 text-rose-800 ring-1 ring-rose-200',
};

export function TechBadge({ techScore, techLevel, mode = 'full', className }: Props) {
  if (mode !== 'level' && techScore == null) {
    const fallbackTextColor = hasTextColorClass(className) ? null : 'text-gray-500';
    return <span className={[fallbackTextColor, className].filter(Boolean).join(' ')}>-</span>;
  }

  const level = typeof techLevel === 'string' ? techLevel.trim() : '';
  const levelClassName = level ? (levelClassNameMap[level] ?? 'bg-gray-50 text-gray-700 ring-1 ring-gray-200') : '';

  if (mode === 'level') {
    if (!level) return <span className={['text-gray-500', className].filter(Boolean).join(' ')}>-</span>;
    return (
      <span className={['inline-flex items-center', className].filter(Boolean).join(' ')}>
        <span className={['inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold font-sans', levelClassName].join(' ')}>
          {level}
        </span>
      </span>
    );
  }

  const fallbackTextColor = hasTextColorClass(className) ? null : 'text-gray-900';
  return (
    <span className={['inline-flex items-center gap-1.5 font-mono', fallbackTextColor, className].filter(Boolean).join(' ')}>
      <span>{techScore}</span>
      {level ? (
        <span className={['inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold font-sans', levelClassName].join(' ')}>
          {level}
        </span>
      ) : null}
    </span>
  );
}
