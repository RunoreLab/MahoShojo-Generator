import type { MessageFilter } from '@/lib/messages/types';

const FILTER_OPTIONS: Array<{ value: MessageFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'site', label: '全站' },
  { value: 'direct', label: '定向' },
];

export function MessageFilters({
  activeFilter,
  isAuthenticated,
  onChange,
}: {
  activeFilter: MessageFilter;
  isAuthenticated: boolean;
  onChange: (filter: MessageFilter) => void;
}) {
  const options = isAuthenticated ? FILTER_OPTIONS : FILTER_OPTIONS.filter((option) => option.value === 'all' || option.value === 'site');

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {options.map((option) => {
        const active = activeFilter === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={
              active
                ? 'inline-flex rounded-full bg-pink-600 px-4 py-2 text-sm font-semibold text-white'
                : 'inline-flex rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200'
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
