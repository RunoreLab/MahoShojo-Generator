'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleSettingsFormValues, BattleSettingsSchema } from '../utils/schemas';
import { BattleStoreState, CombatantData } from '../types';

export function BattleSettings() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const combatants = useBattleSelector((state) => state.combatants);

  const form = useForm<BattleSettingsFormValues>({
    resolver: zodResolver(BattleSettingsSchema),
    defaultValues: settings,
    mode: 'onChange',
  });

  useEffect(() => {
    form.reset(settings);
  }, [settings, form]);

  useEffect(() => {
    const subscription = form.watch((values) => {
      if (!form.formState.isDirty) return;
      updateSettings(values as BattleSettingsFormValues);
    });
    return () => subscription.unsubscribe();
  }, [form, updateSettings]);

  const readableCombatantCount = useMemo(
    () => combatants.filter((item): item is CombatantData => 'data' in item).length,
    [combatants]
  );

  const watched = form.watch();
  const numericLimit = watched.isArenaHistoryUnlimited ? Infinity : Math.max(1, watched.readArenaHistoryLimit);
  const estimatedHistoryTotal = watched.readArenaHistory
    ? numericLimit === Infinity
      ? Infinity
      : numericLimit * readableCombatantCount
    : 0;
  const shouldWarnHistoryLimit =
    watched.readArenaHistory && readableCombatantCount > 0 && (numericLimit === Infinity || estimatedHistoryTotal > 20);

  return (
    <div className="input-group">
      <label className="input-label">资料读写策略</label>
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="border border-gray-200 rounded-lg p-3">
          <legend className="text-xs font-semibold text-gray-600 px-1">历战记录</legend>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              {...form.register('readArenaHistory')}
              disabled={isGenerating}
            />
            生成时读取
          </label>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              {...form.register('writeArenaHistory')}
              disabled={isGenerating}
            />
            战报后写入
          </label>
          {watched.readArenaHistory && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-semibold text-gray-600">单个角色读取条数</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="input-field w-24"
                  {...form.register('readArenaHistoryLimit', { valueAsNumber: true })}
                  disabled={isGenerating || watched.isArenaHistoryUnlimited}
                />
                <label className="flex items-center text-xs text-gray-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
                    {...form.register('isArenaHistoryUnlimited')}
                    disabled={isGenerating}
                  />
                  无上限
                </label>
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-500 mt-1">关闭读取后，将不会参考角色历战；关闭写入后，本次战绩不会被记录。</p>
        </fieldset>

        <fieldset className="border border-gray-200 rounded-lg p-3">
          <legend className="text-xs font-semibold text-gray-600 px-1">当前状态</legend>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              {...form.register('readCurrentState')}
              disabled={isGenerating}
            />
            生成时读取
          </label>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              {...form.register('writeCurrentState')}
              disabled={isGenerating}
            />
            战报后写入
          </label>
          <p className="text-[11px] text-gray-500 mt-1">当前状态可记录角色身体状况、物品、人际等实时信息。</p>
        </fieldset>
      </div>
      {shouldWarnHistoryLimit && (
        <p className="text-xs text-orange-600 mt-2">
          ⚠️ 当前设置预计将读取
          {numericLimit === Infinity ? '无限制数量的' : `约 ${Math.ceil(estimatedHistoryTotal)} 条`}历战记录，超过 20 条可能显著提升生成失败或超时概率。
        </p>
      )}
      <p className="text-xs text-gray-500 mt-2">偏好会自动保存到浏览器，下次进入竞技场会沿用当前设置。</p>
    </div>
  );
}
