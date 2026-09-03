'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { ArenaRosterList, ArenaRosterRow } from '../../presentation/ArenaRoster';
import type {
  ArenaRosterRowView,
  ArenaRosterSectionModel,
  ArenaRosterTeamView,
} from './roster-contract';

type RowMoveMode =
  | Readonly<{ kind: 'global' }>
  | Readonly<{ kind: 'team'; teamKey: string; groupName: string }>;

type RowGroupContext =
  | Readonly<{ kind: 'flat' | 'unassigned' }>
  | Readonly<{ kind: 'team'; team: ArenaRosterTeamView }>;

const removeTeamConfirmMessage = (teamName: string): string =>
  `确定删除分队「${teamName}」吗？成员会回到未分队。`;

/**
 * 单人与 Proposal 共用的“已选角色 / 分队”区块。
 * 只消费 ArenaRosterSectionModel；能力差异全部来自 adapter 提供的 capabilities/actions，
 * 内部不得出现按模式分支的逻辑。
 */
export function ArenaRosterSection({
  model,
  emptyLabel,
}: Readonly<{
  model: ArenaRosterSectionModel;
  /** 提供后空 roster 不再整体隐藏，而是渲染空态（proposal 草稿语义）。 */
  emptyLabel?: string;
}>) {
  const { rows, teams, capabilities, actions } = model;
  const [expandedGuidanceKeys, setExpandedGuidanceKeys] = useState<ReadonlySet<string>>(new Set());
  const [editingTeamKey, setEditingTeamKey] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [unassignedCollapsed, setUnassignedCollapsed] = useState(false);

  const rowByKey = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows],
  );
  const unassignedRows = useMemo(
    () => rows.filter((row) => !row.teamKey || !teams.some((team) => team.key === row.teamKey)),
    [rows, teams],
  );
  const teamMembersOf = (team: ArenaRosterTeamView): ArenaRosterRowView[] => (
    team.memberKeys
      .map((key) => rowByKey.get(key))
      .filter((row): row is ArenaRosterRowView => Boolean(row))
  );

  if (rows.length === 0 && !emptyLabel) return null;

  const moveModeFor = (row: ArenaRosterRowView): RowMoveMode => {
    const team = row.teamKey ? teams.find((item) => item.key === row.teamKey) : undefined;
    if (team && capabilities.reorderTeamMembers) {
      return { kind: 'team', teamKey: team.key, groupName: `${team.name}内 ${row.displayName}` };
    }
    return { kind: 'global' };
  };

  const renderRow = (row: ArenaRosterRowView, group: RowGroupContext) => {
    const moveMode = moveModeFor(row);
    const extras = model.rowExtras?.(row);
    const teamMove = moveMode.kind === 'team';
    // 队内重排使用队内下标；全局重排（solo 分组内或未分队行）必须使用全局下标。
    const inTeamMove = teamMove && group.kind === 'team' && group.team.key === moveMode.teamKey;
    const index = inTeamMove ? group.team.memberKeys.indexOf(row.key) : row.index;
    const total = inTeamMove ? group.team.memberKeys.length : rows.length;
    return (
      <ArenaRosterRow
        key={row.key}
        item={{
          key: row.key,
          displayName: row.displayName,
          typeLabel: row.typeLabel,
          guidance: row.guidance,
          tags: extras?.tags,
        }}
        index={index}
        total={total}
        disabled={model.disabled}
        capabilities={{
          reorder: teamMove ? capabilities.reorderTeamMembers : capabilities.reorderRows,
          remove: capabilities.removeRows,
          guidance: capabilities.editGuidance && !row.isPlaceholder,
          details: Boolean(extras?.onShowDetails),
          download: Boolean(extras?.onDownload),
          copy: Boolean(extras?.onCopy),
          ranking: capabilities.ranking && !row.isPlaceholder,
        }}
        moveGroupLabel={teamMove ? moveMode.groupName : undefined}
        guidanceExpanded={expandedGuidanceKeys.has(row.key)}
        copied={extras?.copied ?? false}
        rankingBadge={capabilities.ranking ? extras?.rankingBadge : undefined}
        ranking={capabilities.ranking ? extras?.ranking : undefined}
        onMove={(fromIndex, toIndex) => {
          if (teamMove) actions.moveTeamMember(moveMode.teamKey, fromIndex, toIndex);
          else actions.moveRow(fromIndex, toIndex);
        }}
        onToggleGuidance={() => setExpandedGuidanceKeys((current) => {
          const next = new Set(current);
          if (next.has(row.key)) next.delete(row.key);
          else next.add(row.key);
          return next;
        })}
        onGuidanceChange={(value) => actions.setGuidance(row.key, value)}
        onShowDetails={extras?.onShowDetails}
        onDownload={extras?.onDownload}
        onCopy={extras?.onCopy}
        onRemove={() => actions.removeRow(row.key)}
      />
    );
  };

  const beginTeamRename = (team: ArenaRosterTeamView) => {
    setEditingTeamKey(team.key);
    setEditingTeamName(team.name);
  };

  const commitTeamRename = () => {
    if (!editingTeamKey) return;
    actions.renameTeam(editingTeamKey, editingTeamName);
    setEditingTeamKey(null);
    setEditingTeamName('');
  };

  const handleCreateTeam = () => {
    const teamKey = actions.createTeam();
    setEditingTeamKey(teamKey);
    setEditingTeamName('');
    setUnassignedCollapsed(false);
  };

  const teamLabelOf = (row: ArenaRosterRowView): string => {
    const team = row.teamKey ? teams.find((item) => item.key === row.teamKey) : undefined;
    return team?.name ?? '未分队';
  };

  const renderTeam = (team: ArenaRosterTeamView, teamIndex: number) => {
    const members = teamMembersOf(team);
    const isEditing = editingTeamKey === team.key;
    const transferableRows = rows.filter((row) => row.teamKey !== team.key);
    return (
      <div key={team.key} className="rounded-lg border border-gray-300 bg-white/50">
        <div className="flex flex-wrap items-center gap-2 px-2 py-2">
          <button
            type="button"
            className="flex items-center gap-2 min-w-0 flex-1"
            onClick={() => {
              if (capabilities.collapseTeams) actions.toggleTeamCollapsed(team.key);
            }}
            aria-expanded={!team.collapsed}
            aria-controls={`arena-team-${team.key}-content`}
          >
            <ChevronDown
              className={`h-4 w-4 text-gray-700 transition-transform ${team.collapsed ? '-rotate-90' : ''}`}
              aria-hidden
            />
            {!isEditing ? (
              <span className="font-semibold text-sm text-gray-700 truncate" title={team.name}>
                {team.name}
              </span>
            ) : null}
            <span className="text-xs text-gray-500">({members.length})</span>
          </button>

          {/* 重命名输入必须留在折叠 button 外：嵌套交互元素会让点击输入/回车提交
              冒泡触发折叠（a11y interactive-in-interactive）。 */}
          {isEditing ? (
            <input
              className="text-sm font-semibold text-gray-700 border border-gray-300 rounded px-2 py-1 bg-white w-44"
              value={editingTeamName}
              disabled={model.disabled}
              autoFocus
              onChange={(event) => setEditingTeamName(event.target.value)}
              onBlur={commitTeamRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTeamRename();
                if (event.key === 'Escape') {
                  setEditingTeamKey(null);
                  setEditingTeamName('');
                }
              }}
              aria-label="分队名称"
            />
          ) : null}

          <div className="flex w-full sm:w-auto flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:ml-auto min-w-0">
            {capabilities.reorderTeams ? (
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  className="relative w-6 h-6 rounded border border-gray-300 bg-white text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 after:absolute after:-inset-2 after:content-['']"
                  aria-label={`上移队伍 ${team.name}`}
                  disabled={model.disabled || teamIndex === 0}
                  onClick={() => actions.moveTeam(team.key, -1)}
                >↑</button>
                <button
                  type="button"
                  className="relative w-6 h-6 rounded border border-gray-300 bg-white text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 after:absolute after:-inset-2 after:content-['']"
                  aria-label={`下移队伍 ${team.name}`}
                  disabled={model.disabled || teamIndex === teams.length - 1}
                  onClick={() => actions.moveTeam(team.key, 1)}
                >↓</button>
              </div>
            ) : null}
            {capabilities.assignTeamMembers ? (
              <select
                defaultValue=""
                className="text-xs border border-gray-300 rounded px-1 py-1 bg-white disabled:opacity-50 w-full sm:w-44 min-w-0 max-w-full truncate"
                disabled={model.disabled || rows.length === 0}
                onChange={(event) => {
                  const combatantKey = event.currentTarget.value;
                  if (!combatantKey) return;
                  actions.assignCombatant(combatantKey, team.key);
                  event.currentTarget.value = '';
                }}
                title="把角色加入/转移到该分队"
              >
                <option value="">添加/转移成员…</option>
                {transferableRows.map((row) => (
                  <option key={row.key} value={row.key}>
                    {row.displayName}（{teamLabelOf(row)}）
                  </option>
                ))}
              </select>
            ) : null}
            {capabilities.renameTeams ? (
              <button
                type="button"
                onClick={() => beginTeamRename(team)}
                disabled={model.disabled}
                className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                改名
              </button>
            ) : null}
            {capabilities.removeTeams ? (
              <button
                type="button"
                onClick={() => {
                  if (model.disabled) return;
                  if (!globalThis.confirm(removeTeamConfirmMessage(team.name))) return;
                  actions.removeTeam(team.key);
                }}
                disabled={model.disabled}
                className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 disabled:opacity-50"
              >
                删除
              </button>
            ) : null}
          </div>
        </div>

        {!team.collapsed ? (
          <div id={`arena-team-${team.key}-content`} className="p-2 pt-0 space-y-2">
            {members.length === 0 ? (
              <div className="text-xs text-gray-500 px-1 py-2">暂无成员（可用右侧下拉框添加/转移）</div>
            ) : (
              members.map((member) => renderRow(member, { kind: 'team', team }))
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderUnassignedGroup = () => {
    if (unassignedRows.length === 0 && teams.length === 0) return null;
    return (
      <div className="rounded-lg border border-gray-300 bg-white/50">
        <div className="w-full flex flex-wrap items-center gap-2 px-2 py-2">
          <button
            type="button"
            className="flex items-center gap-2 min-w-0 flex-1"
            onClick={() => setUnassignedCollapsed((value) => !value)}
            aria-expanded={!unassignedCollapsed}
            aria-controls="arena-team-unassigned-content"
          >
            <ChevronDown
              className={`h-4 w-4 text-gray-700 transition-transform ${unassignedCollapsed ? '-rotate-90' : ''}`}
              aria-hidden
            />
            <span className="font-semibold text-sm text-gray-700">未分队</span>
            <span className="text-xs text-gray-500">({unassignedRows.length})</span>
          </button>
          {/* 移回下拉框留在折叠 button 外，避免点击/选择时冒泡触发折叠。 */}
          {capabilities.assignTeamMembers && teams.length > 0 ? (
            <select
              defaultValue=""
              className="text-xs border border-gray-300 rounded px-1 py-1 bg-white disabled:opacity-50 w-full sm:w-44 min-w-0 max-w-full truncate sm:ml-auto"
              disabled={model.disabled || rows.every((row) => !row.teamKey)}
              onChange={(event) => {
                const combatantKey = event.currentTarget.value;
                if (!combatantKey) return;
                actions.assignCombatant(combatantKey, null);
                event.currentTarget.value = '';
              }}
              title="把某个已分队的角色移回未分队"
            >
              <option value="">移回未分队…</option>
              {teams.flatMap((team) => teamMembersOf(team).map((row) => (
                <option key={row.key} value={row.key}>
                  {row.displayName}（{team.name}）
                </option>
              )))}
            </select>
          ) : null}
        </div>

        {!unassignedCollapsed ? (
          <div id="arena-team-unassigned-content" className="p-2 pt-0 space-y-2">
            {unassignedRows.map((row) => renderRow(row, { kind: 'unassigned' }))}
          </div>
        ) : null}
      </div>
    );
  };

  const grouped = teams.length > 0 || rows.some((row) => row.teamKey);

  return (
    <div className="mb-4 p-3 bg-gray-200 rounded-lg">
      <div className="flex justify-between items-center m-0 top-0 right-0">
        <p className="font-semibold text-sm text-gray-700">已选角色 ({model.combatantCountLabel}):</p>
        {capabilities.clearRoster ? (
          <button
            type="button"
            onClick={() => actions.clearRoster()}
            disabled={model.disabled}
            className="text-sm text-red-500 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            清空列表
          </button>
        ) : null}
      </div>

      {capabilities.addPlaceholders ? (
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => actions.addPlaceholder('random-magical-girl')}
            disabled={model.disabled || model.combatantCapReached}
            className="text-xs flex-1 bg-pink-100 text-pink-700 px-3 py-1.5 rounded-lg hover:bg-pink-200 disabled:opacity-50"
          >
            + 添加随机魔法少女
          </button>
          <button
            type="button"
            onClick={() => actions.addPlaceholder('random-canshou')}
            disabled={model.disabled || model.combatantCapReached}
            className="text-xs flex-1 bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 disabled:opacity-50"
          >
            + 添加随机残兽
          </button>
        </div>
      ) : null}

      {capabilities.createTeams ? (
        <div className="flex justify-between items-center mt-3">
          <button
            type="button"
            onClick={handleCreateTeam}
            disabled={model.disabled}
            className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50"
          >
            + 新建分队
          </button>
        </div>
      ) : null}

      {!grouped ? (
        <ArenaRosterList
          className="mt-2 space-y-2"
          items={rows}
          emptyLabel={emptyLabel}
          renderItem={(row) => renderRow(row, { kind: 'flat' })}
        />
      ) : (
        <div className="mt-2 space-y-2">
          {renderUnassignedGroup()}
          {teams.map(renderTeam)}
          {rows.length === 0 && emptyLabel ? (
            <ArenaRosterList items={[]} emptyLabel={emptyLabel} renderItem={() => null} />
          ) : null}
        </div>
      )}
    </div>
  );
}
