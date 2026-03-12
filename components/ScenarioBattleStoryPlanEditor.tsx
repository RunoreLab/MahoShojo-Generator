import React from 'react';

import {
  SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS,
  SCENARIO_BATTLE_STORY_MIN_TOTAL_CHAPTERS,
  readScenarioBattleStoryConfig,
} from '@/lib/scenario-battle-story';

interface ScenarioBattleStoryPlanEditorProps {
  data: Record<string, any>;
  onChange: (path: string, value: any) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export default function ScenarioBattleStoryPlanEditor(props: ScenarioBattleStoryPlanEditorProps) {
  const { data, onChange } = props;
  const rawPlan = isRecord(data?._battle_story) ? data._battle_story : null;
  const parsedPlan = readScenarioBattleStoryConfig(data);
  const isEnabled = Boolean(rawPlan);
  const totalChaptersValue = rawPlan && 'total_chapters' in rawPlan ? rawPlan.total_chapters ?? '' : '';
  const planModeValue =
    rawPlan && typeof rawPlan.plan_mode === 'string' ? rawPlan.plan_mode : 'suggested';
  const hasInvalidPlan = isEnabled && !parsedPlan;

  const updatePlan = (nextPlan: Record<string, unknown> | undefined) => {
    onChange('_battle_story', nextPlan);
  };

  const createDefaultPlan = (): Record<string, unknown> => ({
    total_chapters: parsedPlan?.totalChapters ?? 5,
    plan_mode: parsedPlan?.planMode ?? 'suggested',
  });

  return (
    <fieldset className="border border-gray-300 p-4 rounded-lg">
      <legend className="text-sm font-semibold px-2 text-gray-600">连续战报章节规划</legend>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(event) => updatePlan(event.target.checked ? createDefaultPlan() : undefined)}
          />
          <span>启用章节规划扩展字段 `_battle_story`</span>
        </label>

        {isEnabled ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="input-label">总章节数</label>
              <input
                type="number"
                min={SCENARIO_BATTLE_STORY_MIN_TOTAL_CHAPTERS}
                max={SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS}
                value={totalChaptersValue as any}
                onChange={(event) => {
                  const rawValue = event.target.value;
                  const nextPlan = {
                    ...(rawPlan ?? createDefaultPlan()),
                    total_chapters: rawValue === '' ? undefined : Number.parseInt(rawValue, 10),
                  };
                  updatePlan(nextPlan);
                }}
                className="input-field"
                placeholder={`请输入 ${SCENARIO_BATTLE_STORY_MIN_TOTAL_CHAPTERS}-${SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS}`}
              />
              <p className="mt-1 text-xs text-gray-500">
                连续战报启动后会把“当前第几章 / 共几章”明确传给 AI。
              </p>
            </div>

            <div>
              <label className="input-label">规划模式</label>
              <select
                value={planModeValue}
                onChange={(event) =>
                  updatePlan({
                    ...(rawPlan ?? createDefaultPlan()),
                    plan_mode: event.target.value,
                  })
                }
                className="input-field"
              >
                <option value="suggested">建议值（用户可改）</option>
                <option value="fixed">固定值（用户不可改）</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                该扩展字段不会参与原生签名，也不会因为编辑它而丢失原生性。
              </p>
            </div>
          </div>
        ) : null}

        {hasInvalidPlan ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            当前 `_battle_story` 配置无效，请确保总章节数为
            {` ${SCENARIO_BATTLE_STORY_MIN_TOTAL_CHAPTERS}-${SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS} `}
            的整数，且规划模式为 `suggested` 或 `fixed`。
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
