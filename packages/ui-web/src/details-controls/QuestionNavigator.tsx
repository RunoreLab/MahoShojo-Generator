import React, { useEffect, useMemo, useState } from 'react';

export interface QuestionNavigatorItem {
  id: string;
  label: string;
}

export type QuestionNavigatorTheme = 'pink' | 'violet' | 'dark' | 'app';

interface QuestionNavigatorProps {
  items: QuestionNavigatorItem[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  isAnswered: (index: number) => boolean;
  theme?: QuestionNavigatorTheme;
}

const themeStyles: Record<QuestionNavigatorTheme, { container: string; progress: string; current: string; answered: string; unanswered: string; label: string; muted: string; selectLabel: string; track: string; }> = {
  pink: {
    container: 'border-pink-200 bg-pink-50/80',
    progress: 'bg-pink-400',
    current: 'bg-pink-500 text-white shadow-sm',
    answered: 'bg-white text-pink-600 border border-pink-200',
    unanswered: 'bg-white/70 text-gray-500 border border-pink-100',
    label: 'text-gray-700',
    muted: 'text-gray-500',
    selectLabel: 'text-gray-600',
    track: 'bg-white/60'
  },
  violet: {
    container: 'border-purple-200 bg-purple-50/80',
    progress: 'bg-purple-500',
    current: 'bg-purple-600 text-white shadow-sm',
    answered: 'bg-white text-purple-600 border border-purple-200',
    unanswered: 'bg-white/70 text-gray-500 border border-purple-100',
    label: 'text-gray-700',
    muted: 'text-gray-500',
    selectLabel: 'text-gray-600',
    track: 'bg-white/60'
  },
  dark: {
    container: 'border-slate-600 bg-slate-900/70',
    progress: 'bg-emerald-400',
    current: 'bg-emerald-500 text-white shadow-sm',
    answered: 'bg-slate-800 text-emerald-300 border border-slate-600',
    unanswered: 'bg-slate-800/60 text-slate-400 border border-slate-700',
    label: 'text-slate-200',
    muted: 'text-slate-300',
    selectLabel: 'text-slate-300',
    track: 'bg-slate-800'
  },
  // 「app」用共享产品 token，随 data-color-mode 自动适配亮/暗（Desktop 与壳化 Web 面板）。
  app: {
    container: 'border-(--app-border) bg-(--app-surface)',
    progress: 'bg-(--app-accent)',
    current: 'bg-(--app-accent) text-white shadow-sm',
    answered: 'bg-(--app-surface) text-(--app-text) border border-(--app-border)',
    unanswered: 'bg-(--app-surface)/70 text-(--app-text-muted) border border-(--app-border)',
    label: 'text-(--app-text)',
    muted: 'text-(--app-text-muted)',
    selectLabel: 'text-(--app-text-muted)',
    track: 'bg-(--app-surface-strong)'
  }
};

const truncateLabel = (label: string, maxLength = 24): string => {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength - 1)}…`;
};

const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({
  items,
  currentIndex,
  onNavigate,
  isAnswered,
  theme = 'pink'
}) => {
  const styles = themeStyles[theme];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const labelClass = styles.label;
  const mutedClass = styles.muted;
  const selectLabelClass = styles.selectLabel;
  const trackBackgroundClass = styles.track;

  const answeredCount = useMemo(() => {
    return items.reduce((count, _, index) => count + (isAnswered(index) ? 1 : 0), 0);
  }, [items, isAnswered]);

  const progress = items.length === 0 ? 0 : Math.round((answeredCount / items.length) * 100);

  useEffect(() => {
    setSelectedId(items[currentIndex]?.id ?? null);
  }, [currentIndex, items]);

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm shadow-sm transition-colors ${styles.container}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className={`font-semibold text-sm ${labelClass}`}>
          题号导航
        </div>
        <div className={`text-xs ${mutedClass}`}>已完成 {answeredCount}/{items.length}</div>
      </div>

      <div className={`mt-2 h-2 w-full overflow-hidden rounded-full ${trackBackgroundClass}`}>
        <div
          className={`h-full transition-all duration-300 ease-out ${styles.progress}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-6 sm:grid-cols-8 gap-2">
        {items.map((item, index) => {
          const answered = isAnswered(index);
          const isCurrent = index === currentIndex;
          const baseStyles = isCurrent
            ? styles.current
            : answered
              ? styles.answered
              : styles.unanswered;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id);
                onNavigate(index);
              }}
              className={`flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${baseStyles}`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        <label htmlFor="question-navigator-select" className={`mb-1 block text-xs font-medium ${selectLabelClass}`}>
          快速跳转
        </label>
        <select
          id="question-navigator-select"
          className="input-field text-xs"
          value={items[currentIndex]?.id || selectedId || (items[0]?.id ?? '')}
          onChange={(event) => {
            const nextIndex = items.findIndex(item => item.id === event.target.value);
            if (nextIndex >= 0) {
              setSelectedId(event.target.value);
              onNavigate(nextIndex);
            }
          }}
        >
          {items.map((item, index) => (
            <option key={item.id} value={item.id}>
              {index + 1}. {truncateLabel(item.label)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default QuestionNavigator;
export { QuestionNavigator };
export type { QuestionNavigatorProps };
