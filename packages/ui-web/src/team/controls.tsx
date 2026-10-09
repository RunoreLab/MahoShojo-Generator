import type { ReactNode } from 'react';
import { DATA_CARD_TEMPLATE_LABELS as TEMPLATE_LABELS, type InferableDataCardTemplate } from '@mahoshojo/domain/data-cards';
import type { TeamMergeOutputTemplate } from '@mahoshojo/domain/team-merge';

export interface TeamMemberView {
  id: string; label: string; template: InferableDataCardTemplate; sourceLabel: string; trustLabel: ReactNode;
}

export function TeamMembersPanel({ members, onClear, onRename, onMove, onRemove, disabled }: {
  members: TeamMemberView[]; onClear: () => void; onRename: (id: string, label: string) => void;
  onMove: (index: number, direction: -1 | 1) => void; onRemove: (id: string) => void; disabled?: boolean;
}) { return (
    <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-base font-semibold text-gray-800">队员列表</div>
          <div className="mt-1 text-xs text-gray-600">顺序会影响合并结果（数组会按队员顺序依次展开）。</div>
        </div>
        <button
          type="button"
          className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          disabled={disabled || members.length === 0}
          onClick={onClear}
        >
          清空队伍
        </button>
      </div>

      {members.length === 0 ? (
        <div className="mt-3 text-sm text-gray-600">暂无队员，先从上方添加角色卡吧。</div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">队员标识（用于前缀）</th>
                <th className="py-2 pr-2">模板</th>
                <th className="py-2 pr-2">来源</th>
                <th className="py-2 pr-2">原生性</th>
                <th className="py-2 pr-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((member, index) => (
                <tr key={member.id}>
                  <td className="py-2 pr-2 text-gray-500">{index + 1}</td>
                  <td className="py-2 pr-2">
                    <input
                      aria-label={`队员 ${index + 1} 标识`}
                      disabled={disabled}
                      value={member.label}
                      onChange={(e) => onRename(member.id, e.target.value)}
                      className="input-field h-9"
                    />
                  </td>
                  <td className="py-2 pr-2 text-gray-700">
                    {member.template in TEMPLATE_LABELS ? TEMPLATE_LABELS[member.template as keyof typeof TEMPLATE_LABELS] : '未知'}
                  </td>
                  <td className="py-2 pr-2 text-gray-700">{member.sourceLabel}</td>
                  <td className="py-2 pr-2 text-gray-700">
                    {member.trustLabel}
                  </td>
                  <td className="py-2 pl-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        disabled={disabled || index === 0}
                        onClick={() => onMove(index, -1)}
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        disabled={disabled || index === members.length - 1}
                        onClick={() => onMove(index, 1)}
                      >
                        下移
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                        disabled={disabled}
                        onClick={() => onRemove(member.id)}
                      >
                        移除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

); }

export function TeamMergeSettings({ outputTemplate, onChange, warnings, disabled }: {
  outputTemplate: TeamMergeOutputTemplate; onChange: (value: TeamMergeOutputTemplate) => void; warnings: string[]; disabled?: boolean;
}) { return (
    <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-base font-semibold text-gray-800">合并设置</div>
          <div className="mt-1 text-xs text-gray-600">自动：同模板直接拼接；不同模板会自动转为通用角色卡。</div>
        </div>
        <select
          aria-label="输出模板"
          value={outputTemplate}
          onChange={(e) => onChange(e.target.value as TeamMergeOutputTemplate)}
          className="input-field sm:w-64"
          disabled={disabled}
        >
          <option value="auto">自动（推荐）</option>
          <option value="general">强制：通用角色卡（Markdown）</option>
          <option value="magical-girl">强制：魔法少女（结构化）</option>
          <option value="canshou">强制：残兽（结构化）</option>
        </select>
      </div>

      {warnings.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="font-semibold">提示</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {warnings.map((line, idx) => (
              <li key={`warn-${idx}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
); }

export function TeamResultJson({ data }: { data: Record<string, unknown> }) { return (
        <details className="mt-4 rounded-xl border border-gray-200 bg-white/70 p-3 text-left">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">查看合并后的 JSON（预览不含原生签名）</summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>); }

export function TeamResultPreview({ children }: { children: ReactNode }) { return <div><h2 className="text-center text-xl font-bold text-gray-800 mb-4">合并结果预览</h2>{children}</div>; }
