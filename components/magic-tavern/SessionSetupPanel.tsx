import { type ChangeEvent } from 'react';

import type { MagicTavernRole, MagicTavernScenario, MagicTavernSession } from '@/lib/magic-tavern/types';

type MagicTavernPlayerOption = { value: string; label: string };

type MagicTavernSessionSetupPanelProps = {
  activeSession: MagicTavernSession | null;
  playerOptions: MagicTavernPlayerOption[];
  onOpenRoleModal: () => void;
  onOpenScenarioModal: () => void;
  onUploadRoles: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadScenarios: (event: ChangeEvent<HTMLInputElement>) => void;
  onUpdateRoles: (roles: MagicTavernRole[]) => void;
  onUpdateScenarios: (scenario: MagicTavernScenario | undefined, auxScenarios: MagicTavernScenario[]) => void;
  onUpdatePlayerRole: (roleId: string | null) => void;
  onUpdateTitle: (title: string) => void;
  onLockTitle: () => void;
};

export function MagicTavernSessionSetupPanel(props: MagicTavernSessionSetupPanelProps) {
  const {
    activeSession,
    playerOptions,
    onOpenRoleModal,
    onOpenScenarioModal,
    onUploadRoles,
    onUploadScenarios,
    onUpdateRoles,
    onUpdateScenarios,
    onUpdatePlayerRole,
    onUpdateTitle,
    onLockTitle,
  } = props;

  const roles = activeSession?.roles ?? [];
  const scenario = activeSession?.scenario;
  const auxScenarios = activeSession?.auxScenarios ?? [];

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-800">会话设置</div>
        <button
          type="button"
          className="text-xs text-gray-600 hover:underline"
          onClick={onLockTitle}
          title="标记为手动标题（阻止自动覆盖）"
          disabled={!activeSession}
        >
          锁定标题
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-600">角色</div>
            <button
              type="button"
              className="text-xs text-pink-700 hover:underline"
              onClick={onOpenRoleModal}
              disabled={!activeSession}
            >
              浏览在线角色库
            </button>
          </div>
          <input type="file" accept=".json" multiple className="input-field" onChange={onUploadRoles} disabled={!activeSession} />
          <div className="flex flex-wrap gap-2">
            {roles.length === 0 ? (
              <div className="text-xs text-gray-500">未选择角色（可选）</div>
            ) : (
              roles.map((role) => (
                <span key={role.id} className="inline-flex items-center gap-2 rounded-full bg-pink-50 px-3 py-1 text-xs text-pink-800">
                  {role.name}
                  <button
                    type="button"
                    className="text-pink-700 hover:text-pink-900"
                    onClick={() => onUpdateRoles(roles.filter((item) => item.id !== role.id))}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-600">情景</div>
            <button
              type="button"
              className="text-xs text-pink-700 hover:underline"
              onClick={onOpenScenarioModal}
              disabled={!activeSession}
            >
              浏览在线情景库
            </button>
          </div>
          <input type="file" accept=".json" multiple className="input-field" onChange={onUploadScenarios} disabled={!activeSession} />
          <div className="space-y-2">
            {scenario ? (
              <div className="rounded-lg border border-pink-100 bg-pink-50 px-3 py-2">
                <div className="text-xs font-semibold text-pink-800">主情景：{scenario.title}</div>
              </div>
            ) : (
              <div className="text-xs text-gray-500">未选择主情景（可选）</div>
            )}
            {auxScenarios.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {auxScenarios.map((item) => (
                  <span key={item.id} className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-700">
                    {item.title}
                    <button
                      type="button"
                      className="text-gray-500 hover:text-gray-700"
                      onClick={() => onUpdateScenarios(scenario, auxScenarios.filter((scn) => scn.id !== item.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-xs font-semibold text-gray-600">扮演方式</label>
          <select
            className="input-field"
            value={activeSession?.playerRoleId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              onUpdatePlayerRole(value ? value : null);
            }}
            disabled={!activeSession}
          >
            {playerOptions.map((opt) => (
              <option key={opt.value || 'user'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs font-semibold text-gray-600">会话标题</label>
          <input
            className="input-field"
            value={activeSession?.title ?? ''}
            onChange={(event) => onUpdateTitle(event.target.value)}
            placeholder="输入会话标题"
            disabled={!activeSession}
          />
        </div>
      </div>
    </div>
  );
}
