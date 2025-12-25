'use client';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { inferTemplate } from '@/lib/data-card-converter';

type Props = {
  updatedCombatants: any[];
};

export function PvpUpdatedCombatantsPanel({ updatedCombatants }: Props) {
  return (
    <div className="p-4 rounded-xl bg-white border mt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm text-gray-900">角色更新（只读展示）</div>
          <div className="text-xs text-gray-600 mt-1">
            提示：PVP 中开启资料写入仅用于展示“历战记录/当前状态”的更新摘要，不会提供下载、保存或替换角色的入口。
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-4">
        {updatedCombatants.length === 0 && (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
            本轮尚未产生可展示的角色更新（或本轮写入被关闭）。
          </div>
        )}

        {updatedCombatants.map((character: any) => {
          const name = (character?.codename || character?.name || '未命名') as string;
          const template = inferTemplate(character);
          const typeDisplay = template === 'magical-girl' ? '魔法少女' : template === 'canshou' ? '残兽' : '通用角色';

          const entries = character?.arena_history?.entries;
          const latestEntry = Array.isArray(entries) && entries.length > 0 ? entries[entries.length - 1] : null;
          const impact = typeof latestEntry?.impact === 'string' ? latestEntry.impact : '';

          const stateSummary = typeof character?.current_state?.summary === 'string' ? character.current_state.summary.trim() : '';

          if (!impact && !stateSummary) return null;

          return (
            <div key={name} className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="font-semibold text-gray-700">
                {name} <span className="text-xs text-gray-500">({typeDisplay})</span>
              </p>

              {impact && (
                <div className="text-sm text-gray-600 mt-2">
                  <div className="font-medium text-gray-700">历战记录</div>
                  <div className="mt-1">
                    <MarkdownBlock content={impact} variant="light" />
                  </div>
                </div>
              )}

              {stateSummary && (
                <div className="text-sm text-gray-600 mt-3">
                  <div className="font-medium text-gray-700">当前状态</div>
                  <div className="mt-1">
                    <MarkdownBlock content={stateSummary} variant="light" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

