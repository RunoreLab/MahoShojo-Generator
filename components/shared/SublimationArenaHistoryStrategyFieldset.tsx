import React from 'react';

import {
  ARENA_HISTORY_RETENTION_DESCRIPTIONS,
  ARENA_HISTORY_RETENTION_LABELS,
  normalizeArenaHistoryRetentionStrategy,
  type ArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

const RETENTION_STRATEGY_OPTIONS: ArenaHistoryRetentionStrategy[] = [
  'keep-all',
  'keep-sublimation-only',
  'reset-all',
];

type SublimationArenaHistoryStrategyFieldsetProps = {
  readArenaHistory: boolean;
  writeArenaHistory: boolean;
  retentionStrategy: ArenaHistoryRetentionStrategy;
  disabled: boolean;
  onReadArenaHistoryChange: (nextValue: boolean) => void;
  onWriteArenaHistoryChange: (nextValue: boolean) => void;
  onRetentionStrategyChange: (nextValue: ArenaHistoryRetentionStrategy) => void;
};

export const SublimationArenaHistoryStrategyFieldset: React.FC<SublimationArenaHistoryStrategyFieldsetProps> = ({
  readArenaHistory,
  writeArenaHistory,
  retentionStrategy,
  disabled,
  onReadArenaHistoryChange,
  onWriteArenaHistoryChange,
  onRetentionStrategyChange,
}) => {
  const normalizedRetentionStrategy = normalizeArenaHistoryRetentionStrategy(retentionStrategy);

  return (
    <fieldset className="border border-gray-200 rounded-lg p-3">
      <legend className="text-xs font-semibold text-gray-600 px-1">历战记录</legend>
      <label className="flex items-center text-sm text-gray-700 mt-2">
        <input
          type="checkbox"
          className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
          checked={readArenaHistory}
          onChange={(event) => onReadArenaHistoryChange(event.target.checked)}
          disabled={disabled}
        />
        升华时读取
      </label>
      <label className="flex items-center text-sm text-gray-700 mt-2">
        <input
          type="checkbox"
          className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
          checked={writeArenaHistory}
          onChange={(event) => onWriteArenaHistoryChange(event.target.checked)}
          disabled={disabled}
        />
        升华后写入
      </label>

      {writeArenaHistory && (
        <div className="mt-3 rounded-md border border-purple-100 bg-purple-50/60 p-2">
          <p className="text-xs font-semibold text-purple-700">写入策略</p>
          <div className="mt-2 space-y-2">
            {RETENTION_STRATEGY_OPTIONS.map((strategy) => (
              <label key={strategy} className="flex items-center text-xs text-gray-700">
                <input
                  type="radio"
                  name="arena-history-retention-strategy"
                  value={strategy}
                  className="h-4 w-4 mr-2 text-purple-600 border-gray-300"
                  checked={normalizedRetentionStrategy === strategy}
                  onChange={(event) =>
                    onRetentionStrategyChange(
                      normalizeArenaHistoryRetentionStrategy(event.target.value),
                    )
                  }
                  disabled={disabled}
                />
                {ARENA_HISTORY_RETENTION_LABELS[strategy]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-purple-700">
            {ARENA_HISTORY_RETENTION_DESCRIPTIONS[normalizedRetentionStrategy]}
          </p>
        </div>
      )}

      <p className="text-[11px] text-gray-500 mt-1">
        关闭读取后，仅根据设定与引导完成升华；关闭写入后，本次升华不会新增历史条目。
      </p>
    </fieldset>
  );
};
