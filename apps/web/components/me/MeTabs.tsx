'use client';

type TabKey = 'reports' | 'pvp' | 'settings';

type Props = {
  value: TabKey;
  onChange: (next: TabKey) => void;
};

const tabBase =
  'inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors';

export function MeTabs({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={[
          tabBase,
          value === 'reports' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
        ].join(' ')}
        onClick={() => onChange('reports')}
      >
        战报记录
      </button>
      <button
        type="button"
        className={[
          tabBase,
          value === 'pvp' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
        ].join(' ')}
        onClick={() => onChange('pvp')}
      >
        PVP 战绩
      </button>
      <button
        type="button"
        className={[
          tabBase,
          value === 'settings' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
        ].join(' ')}
        onClick={() => onChange('settings')}
      >
        设置
      </button>
    </div>
  );
}

