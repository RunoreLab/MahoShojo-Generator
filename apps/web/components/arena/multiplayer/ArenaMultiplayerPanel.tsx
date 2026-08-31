'use client';

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import type { RoomDirectoryVisibility } from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import {
  buildArenaRoomHostWorkspaceBundleFromBattleState,
} from '@/lib/arena-room/shared-config';
import { arenaRoomHostWorkspaceAuthorityFromSession } from '@/lib/arena-room/host-workspace';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { ArenaProposalPanel } from './ArenaProposalPanel';
import { ArenaHostConfigPanel } from './ArenaHostConfigPanel';
import { useArenaRoom, useArenaRoomContext } from './useArenaRoom';
import { BattleResultPresentation } from '../components/BattleResultPresentation';
import { ArenaRoomDialog } from './ArenaRoomDialog';

export type ArenaMultiplayerPanelProps = {
  readonly enabled: boolean;
  readonly origin: string;
  readonly authLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly displayName: string;
};

export type ArenaMultiplayerResultProps = {
  readonly onSaveImage?: (imageUrl: string) => void;
};

export type ArenaMultiplayerPanelViewProps = {
  readonly state: ArenaRoomControllerState;
  readonly authLoading: boolean;
  readonly actionPending?: boolean;
  readonly hostConfigContent?: ReactNode;
  readonly proposalContent?: ReactNode;
  readonly roomTitle: string;
  readonly visibility: RoomDirectoryVisibility;
  readonly joinCode: string;
  readonly onRoomTitleChange: (value: string) => void;
  readonly onVisibilityChange: (value: RoomDirectoryVisibility) => void;
  readonly onJoinCodeChange: (value: string) => void;
  readonly onCreate: () => void;
  readonly onDiscover: () => void;
  readonly onDiscoverMore: () => void;
  readonly onJoin: (roomId: string) => void;
  readonly onLeave: () => void;
  readonly onClose: () => void;
  readonly onKick?: (targetUserId: string) => void;
  readonly onCancelGeneration?: () => void;
  readonly onReconnect: () => void;
  readonly onRetryUnknown: () => void;
  readonly onReset: () => void;
};

const buttonClass = 'rounded-xl border px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = `${buttonClass} border-fuchsia-600 bg-fuchsia-600 text-white hover:bg-fuchsia-700`;
const secondaryButtonClass = `${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const inputClass = 'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100';

const StatusNotice = ({ state }: { readonly state: ArenaRoomControllerState }) => (
  <div aria-live="polite" aria-atomic="true" className="min-h-6 text-sm text-gray-700 dark:text-gray-200">
    {state.notice ?? (state.phase === 'connected' ? '房间已连接' : '')}
  </div>
);

const ArenaRoomLobbyDialog = ({
  open,
  onClose,
  state,
  busy,
  roomTitle,
  visibility,
  joinCode,
  onRoomTitleChange,
  onVisibilityChange,
  onJoinCodeChange,
  onCreate,
  onDiscover,
  onDiscoverMore,
  onJoin,
}: Pick<
  ArenaMultiplayerPanelViewProps,
  | 'state'
  | 'roomTitle'
  | 'visibility'
  | 'joinCode'
  | 'onRoomTitleChange'
  | 'onVisibilityChange'
  | 'onJoinCodeChange'
  | 'onCreate'
  | 'onDiscover'
  | 'onDiscoverMore'
  | 'onJoin'
> & {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly busy: boolean;
}) => {
  return (
    <ArenaRoomDialog
      open={open}
      onClose={onClose}
      titleId="arena-room-lobby-heading"
      title="多人房间"
      description="创建房间，或从有界公开目录中选择并加入。"
      widthClassName="max-w-4xl"
    >
          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="space-y-3 rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/60">
              <legend className="px-1 text-sm font-semibold text-gray-950 dark:text-gray-100">创建房间</legend>
              <div>
                <label htmlFor="arena-room-title" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
                  房间标题
                </label>
                <input
                  id="arena-room-title"
                  className={inputClass}
                  maxLength={80}
                  required
                  value={roomTitle}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => onRoomTitleChange(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="arena-room-visibility" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
                  可发现性
                </label>
                <select
                  id="arena-room-visibility"
                  className={inputClass}
                  value={visibility}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => onVisibilityChange(event.target.value as RoomDirectoryVisibility)}
                >
                  <option value="public">公开发现</option>
                  <option value="unlisted">仅凭房间码</option>
                </select>
              </div>
              <button type="button" className={primaryButtonClass} disabled={busy || !roomTitle.trim()} onClick={onCreate}>
                创建多人房间
              </button>
            </fieldset>

            <fieldset className="space-y-3 rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/60">
              <legend className="px-1 text-sm font-semibold text-gray-950 dark:text-gray-100">凭房间码加入</legend>
              <div>
                <label htmlFor="arena-room-join-code" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
                  房间码
                </label>
                <input
                  id="arena-room-join-code"
                  className={inputClass}
                  maxLength={256}
                  value={joinCode}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => onJoinCodeChange(event.target.value)}
                />
              </div>
              <button type="button" className={primaryButtonClass} disabled={busy || !joinCode.trim()} onClick={() => onJoin(joinCode.trim())}>
                加入房间
              </button>
            </fieldset>
          </div>

          <section aria-labelledby="arena-public-room-heading" className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="arena-public-room-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">公开房间</h4>
              <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onDiscover}>
                {state.phase === 'listing' ? '正在加载…' : state.error ? '重试' : '刷新'}
              </button>
            </div>
            {state.error ? (
              <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{state.error}</p>
            ) : null}
            {state.phase === 'listing' && state.rooms.length === 0 ? (
              <p role="status" className="mt-3 text-sm text-gray-600 dark:text-gray-400">正在加载公开房间…</p>
            ) : state.rooms.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">暂无公开房间</p>
            ) : (
              <ul className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2" aria-label="公开房间列表">
                {state.rooms.map((room) => (
                  <li key={room.roomId} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-gray-900/70">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-950 dark:text-gray-100">{room.title}</p>
                      <p className="truncate font-mono text-xs text-gray-600 dark:text-gray-400">{room.roomId}</p>
                    </div>
                    <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => onJoin(room.roomId)}>
                      加入
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {state.directoryNextCursor ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={Boolean(state.directoryLoadingMore)}
                  onClick={onDiscoverMore}
                >
                  {state.directoryLoadingMore ? '正在加载更多…' : '加载更多'}
                </button>
              </div>
            ) : null}
          </section>
    </ArenaRoomDialog>
  );
};

export const ArenaRoomGenerationResult = ({ state, onSaveImage }: {
  readonly state: ArenaRoomControllerState;
  readonly onSaveImage?: (imageUrl: string) => void;
}) => {
  const generation = state.generation;
  if (generation.phase === 'idle' && !generation.markdown) return null;

  const statusLabel = generation.finalAuthoritative
    ? '权威终态'
    : generation.phase === 'completed'
      ? '正在核对权威终态'
      : generation.phase === 'unknown'
        ? '启动结果尚未确认'
        : generation.phase === 'resyncing'
          ? '正在恢复缺口'
          : generation.phase === 'running' || generation.phase === 'starting'
            ? '服务器实时预览'
            : generation.phase === 'failed'
              ? '生成失败'
              : generation.phase === 'cancelled'
                ? '生成已取消'
                : '暂不可用';

  return (
    <section
      aria-labelledby="arena-room-generation-heading"
      className="rounded-xl border border-fuchsia-200 bg-white/80 p-4 dark:border-fuchsia-900 dark:bg-gray-900/70"
      data-arena-room-generation-report="v1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="arena-room-generation-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
          房间战报
        </h3>
        <span className="rounded-full border border-fuchsia-300 px-2 py-0.5 text-xs font-medium text-fuchsia-900 dark:border-fuchsia-700 dark:text-fuchsia-100">
          {statusLabel}
        </span>
      </div>
      {generation.phase === 'unknown' ? (
        <p role="status" className="mt-3 text-sm text-amber-800 dark:text-amber-200">
          启动结果尚未确认；客户端会读取服务器状态，不要重复提交生成请求。
        </p>
      ) : null}
      {generation.gap ? (
        <p role="status" className="mt-3 text-sm text-amber-800 dark:text-amber-200">
          检测到战报分片缺口，正在从服务器恢复权威基线。
        </p>
      ) : null}
      {generation.errorCode ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          错误代码：{generation.errorCode}
        </p>
      ) : null}
      {generation.phase !== 'unknown' && (
        generation.markdown
        || generation.phase === 'running'
        || generation.phase === 'starting'
        || generation.phase === 'resyncing'
        || generation.phase === 'completed'
      ) ? (
        <BattleResultPresentation
          report={{
            format: 'stream-markdown',
            content: generation.markdown,
            isStreaming: generation.phase === 'running'
              || generation.phase === 'starting'
              || generation.phase === 'resyncing',
            mode: generation.result?.mode,
            scenarioName: generation.result?.scenarioDisplayName,
            reporterInfo: generation.result?.reporterInfo ?? null,
            userGuidance: generation.result?.sharedGuidance ?? null,
            characterGuidances: generation.result?.characterGuidances?.map((guidance) => ({
              characterName: guidance.displayName,
              guidance: guidance.guidance,
            })) ?? null,
            aiUsage: generation.result?.ai?.usage ?? null,
            aiModel: generation.result?.ai?.model ?? null,
            narrativeHistoryReadCount: generation.result?.narrativeHistoryReadCount ?? null,
          }}
          onSaveImage={onSaveImage}
          adjudicationResults={generation.result?.adjudicationResults ?? null}
          combatantUpdates={generation.result?.combatantUpdates ?? null}
        />
      ) : generation.phase !== 'unknown' ? (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">等待服务器发布战报内容…</p>
      ) : null}
      {generation.finalAuthoritative && generation.generationRecordId ? (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          最终内容已从生成记录恢复并核验。
        </p>
      ) : null}
    </section>
  );
};

export function ArenaMultiplayerPanelView(props: ArenaMultiplayerPanelViewProps) {
  const { state } = props;
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [kickConfirmation, setKickConfirmation] = useState<{
    readonly targetUserId: string;
    readonly displayName: string;
  } | null>(null);
  const [managementConfirmation, setManagementConfirmation] = useState<
    'cancel' | 'close' | 'leave' | null
  >(null);
  if (state.phase === 'disabled') return null;

  const busy = Boolean(props.actionPending)
    || (state.managementOperation !== null && state.managementOperation !== undefined)
    || ['connecting', 'listing', 'reconnecting'].includes(state.phase);
  const session = state.session;
  const activeMembers = session?.snapshot.members.filter((member) => (
    member.membershipState === 'active'
  )) ?? [];
  const host = activeMembers.find((member) => member.role === 'host');
  const activeGeneration = session?.snapshot.activeGeneration;
  const canCancelGeneration = session?.self.role === 'host'
    && (activeGeneration?.state === 'starting' || activeGeneration?.state === 'running');

  return (
    <section
      aria-labelledby="arena-multiplayer-heading"
      className="mt-5 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/70 p-4 dark:border-fuchsia-900 dark:bg-fuchsia-950/20 sm:p-5"
      data-arena-multiplayer="v1"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="arena-multiplayer-heading" className="text-lg font-semibold text-gray-950 dark:text-gray-50">
            Arena 多人房间
          </h2>
          {!session ? (
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              房间状态由服务器维护；本地角色与情景只共享安全摘要。
            </p>
          ) : null}
        </div>
        {!session && !props.authLoading && (state.phase === 'ready' || state.phase === 'listing') ? (
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => {
              setLobbyOpen(true);
              props.onDiscover();
            }}
          >
            打开多人房间
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        <StatusNotice state={state} />
        {state.error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">
            {state.error}
          </p>
        ) : null}
      </div>

      {props.authLoading ? (
        <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">正在确认登录状态…</p>
      ) : state.phase === 'unauthenticated' ? (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          多人房间需要登录后使用
        </p>
      ) : session ? (
        <div className="mt-3">
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fuchsia-200 bg-white/80 p-3 dark:border-fuchsia-900 dark:bg-gray-900/70"
            data-arena-room-compact-shell="v1"
          >
            <p className="min-w-0 text-sm text-gray-800 dark:text-gray-200">
              房间 <span className="font-mono font-semibold">{session.roomId}</span>
              <span aria-hidden="true"> · </span>
              房主 {host?.displayName ?? '未知'}
              <span aria-hidden="true"> · </span>
              {activeMembers.length} 人
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => setConfigOpen(true)}>
                {session.self.role === 'host' ? '更新配置' : '同步配置'}
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setProposalsOpen(true)}>
                提案
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setMembersOpen(true)}>
                成员
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setManagementOpen(true)}>
                {session.self.role === 'host' ? '房间管理' : '房间管理 / 退出'}
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {state.phase === 'degraded'
            || state.phase === 'reconnecting'
            || state.configPublishResultUnknown
            || state.managementResultUnknown ? (
              <button type="button" className={secondaryButtonClass} onClick={props.onReconnect}>
                {state.managementResultUnknown
                  ? '重新确认管理动作'
                  : state.configPublishResultUnknown
                    ? '重新确认配置发布'
                    : '重新连接'}
              </button>
            ) : null}
            {state.phase === 'replacement' || state.phase === 'closed' ? (
              <button type="button" className={secondaryButtonClass} onClick={props.onReset}>
                返回房间大厅
              </button>
            ) : null}
          </div>

          <ArenaRoomDialog
            open={configOpen}
            onClose={() => setConfigOpen(false)}
            titleId="arena-room-config-dialog-heading"
            title={session.self.role === 'host' ? '更新房间配置' : '同步房间配置'}
            description="主编辑区继续作为 Arena 配置的唯一编辑入口。"
          >
            {props.hostConfigContent ?? (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                房间权威配置会自动同步到主编辑区；如有本地冲突，请先比较后再选择。
              </p>
            )}
          </ArenaRoomDialog>

          <ArenaRoomDialog
            open={proposalsOpen}
            onClose={() => setProposalsOpen(false)}
            titleId="arena-room-proposals-dialog-heading"
            title="房间提案"
            description="成员在主编辑区编辑，房主在此审阅 typed diff。"
            widthClassName="max-w-5xl"
          >
            {props.proposalContent ?? (
              <p className="text-sm text-gray-700 dark:text-gray-300">当前没有待处理提案。</p>
            )}
          </ArenaRoomDialog>

          <ArenaRoomDialog
            open={membersOpen}
            onClose={() => {
              setKickConfirmation(null);
              setMembersOpen(false);
            }}
            titleId="arena-room-members-dialog-heading"
            title="房间成员"
            description={`当前 ${activeMembers.length} 人在线`}
          >
            {kickConfirmation ? (
              <div role="alertdialog" aria-label="确认移除成员" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                <p>确定将“{kickConfirmation.displayName}”移出当前房间吗？</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={busy}
                    onClick={() => {
                      props.onKick?.(kickConfirmation.targetUserId);
                      setKickConfirmation(null);
                    }}
                  >
                    确认移除成员
                  </button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setKickConfirmation(null)}>
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="房间成员列表">
              {activeMembers.map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/70">
                  <span>
                    <span className="font-medium text-gray-950 dark:text-gray-100">{member.displayName}</span>
                    <span className="ml-2 text-gray-600 dark:text-gray-400">
                      {member.role === 'host' ? '房主' : '成员'}
                    </span>
                  </span>
                  {session.self.role === 'host' && member.role !== 'host' && member.userId !== session.self.userId ? (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={busy}
                      onClick={() => setKickConfirmation({
                        targetUserId: member.userId,
                        displayName: member.displayName,
                      })}
                    >
                      移除
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </ArenaRoomDialog>

          <ArenaRoomDialog
            open={managementOpen}
            onClose={() => {
              setManagementConfirmation(null);
              setManagementOpen(false);
            }}
            titleId="arena-room-management-dialog-heading"
            title={session.self.role === 'host' ? '房间管理' : '退出房间'}
            description="所有管理动作都会由服务器重新校验身份与房间 epoch。"
          >
            {managementConfirmation ? (
              <div role="alertdialog" aria-label="确认房间管理动作" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                <p>
                  {managementConfirmation === 'close'
                    ? '确定关闭房间吗？所有成员都会断开。'
                    : managementConfirmation === 'leave'
                      ? '确定离开当前房间吗？'
                      : '确定停止当前战报生成吗？'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={busy}
                    onClick={() => {
                      if (managementConfirmation === 'close') props.onClose();
                      else if (managementConfirmation === 'leave') props.onLeave();
                      else props.onCancelGeneration?.();
                      setManagementConfirmation(null);
                    }}
                  >
                    {managementConfirmation === 'close'
                      ? '确认关闭房间'
                      : managementConfirmation === 'leave'
                        ? '确认离开房间'
                        : '确认停止生成'}
                  </button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setManagementConfirmation(null)}>
                    取消
                  </button>
                </div>
              </div>
            ) : session.self.role === 'host' ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={busy || !canCancelGeneration}
                  onClick={() => setManagementConfirmation('cancel')}
                >
                  停止当前生成
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={busy}
                  onClick={() => setManagementConfirmation('close')}
                >
                  关闭房间
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={busy}
                onClick={() => setManagementConfirmation('leave')}
              >
                离开房间
              </button>
            )}
          </ArenaRoomDialog>
        </div>
      ) : state.phase === 'unknown' ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>
            {state.unknownOperation === 'join'
              ? '服务器可能已经处理加入请求。可以读取当前 membership 确认结果，不会重复提交加入。'
              : '服务器可能已经创建房间。可以使用同一创建请求 ID 安全确认结果，包括非公开房间。'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={secondaryButtonClass} onClick={props.onRetryUnknown}>
              {state.unknownOperation === 'join' ? '重新确认加入结果' : '重新确认创建结果'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={props.onReset}>
              已确认状态，返回大厅
            </button>
          </div>
        </div>
      ) : state.phase === 'replacement' || state.phase === 'closed' ? (
        <button type="button" className={`${secondaryButtonClass} mt-4`} onClick={props.onReset}>
          返回房间大厅
        </button>
      ) : (
        <ArenaRoomLobbyDialog
          open={lobbyOpen}
          onClose={() => setLobbyOpen(false)}
          state={state}
          busy={busy}
          roomTitle={props.roomTitle}
          visibility={props.visibility}
          joinCode={props.joinCode}
          onRoomTitleChange={props.onRoomTitleChange}
          onVisibilityChange={props.onVisibilityChange}
          onJoinCodeChange={props.onJoinCodeChange}
          onCreate={props.onCreate}
          onDiscover={props.onDiscover}
          onDiscoverMore={props.onDiscoverMore}
          onJoin={props.onJoin}
        />
      )}
    </section>
  );
}

export function ArenaMultiplayerPanel(props: ArenaMultiplayerPanelProps) {
  const {
    controller,
    state,
    hostWorkspace,
    hostReconciliation,
    proposalWorkspace,
  } = useArenaRoom({
    enabled: props.enabled,
    authenticated: props.isAuthenticated && !props.authLoading,
    origin: props.origin,
  });
  return (
    <ArenaMultiplayerPanelRuntime
      {...props}
      controller={controller}
      state={state}
      hostWorkspace={hostWorkspace}
      hostReconciliation={hostReconciliation}
      proposalWorkspace={proposalWorkspace}
    />
  );
}

type ArenaMultiplayerPanelRuntimeProps = ArenaMultiplayerPanelProps & {
  readonly controller: ReturnType<typeof useArenaRoom>['controller'];
  readonly state: ReturnType<typeof useArenaRoom>['state'];
  readonly hostWorkspace: ReturnType<typeof useArenaRoom>['hostWorkspace'];
  readonly hostReconciliation: ReturnType<typeof useArenaRoom>['hostReconciliation'];
  readonly proposalWorkspace: ReturnType<typeof useArenaRoom>['proposalWorkspace'];
};

function ArenaMultiplayerPanelRuntime({
  controller,
  state,
  hostWorkspace,
  hostReconciliation,
  proposalWorkspace,
  ...props
}: ArenaMultiplayerPanelRuntimeProps) {
  const [roomTitle, setRoomTitle] = useState(() => `${props.displayName || '玩家'} 的房间`);
  const [visibility, setVisibility] = useState<RoomDirectoryVisibility>('public');
  const [joinCode, setJoinCode] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [preparingCreate, setPreparingCreate] = useState(false);
  const createLock = useRef(false);
  const viewState = inputError ? { ...state, error: inputError } : state;

  const createRoom = async (): Promise<void> => {
    if (createLock.current) return;
    createLock.current = true;
    setPreparingCreate(true);
    setInputError(null);
    try {
      const bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
        useBattleStore.getState(),
      );
      await controller.create({
        displayName: props.displayName || '玩家',
        directory: { title: roomTitle, visibility },
        sharedConfig: bundle.sharedConfig,
      });
      const authority = arenaRoomHostWorkspaceAuthorityFromSession(
        controller.getSnapshot().session,
      );
      if (authority) hostWorkspace.capturePublished(authority, bundle);
    } catch {
      setInputError('当前竞技场配置无法安全共享，请检查角色、版本与数量限制');
    } finally {
      createLock.current = false;
      setPreparingCreate(false);
    }
  };

  return (
    <ArenaMultiplayerPanelView
      state={viewState}
      authLoading={props.authLoading}
      actionPending={preparingCreate}
      hostConfigContent={(
        <ArenaHostConfigPanel
          controllerState={viewState}
          reconciliation={hostReconciliation}
        />
      )}
      proposalContent={(
        <ArenaProposalPanel
          state={viewState}
          controller={controller}
          workspace={proposalWorkspace}
        />
      )}
      roomTitle={roomTitle}
      visibility={visibility}
      joinCode={joinCode}
      onRoomTitleChange={(value) => {
        setInputError(null);
        setRoomTitle(value);
      }}
      onVisibilityChange={setVisibility}
      onJoinCodeChange={(value) => {
        setInputError(null);
        setJoinCode(value);
      }}
      onCreate={() => { void createRoom(); }}
      onDiscover={() => { void controller.discover(); }}
      onDiscoverMore={() => { void controller.discoverMore(); }}
      onJoin={(roomId) => {
        setInputError(null);
        void controller.join(roomId, props.displayName || '玩家');
      }}
      onLeave={() => { void controller.leave(); }}
      onClose={() => { void controller.close(); }}
      onKick={(targetUserId) => { void controller.kickMember(targetUserId); }}
      onCancelGeneration={() => { void controller.cancelGeneration(); }}
      onReconnect={controller.reconnect}
      onRetryUnknown={() => { void controller.retryUnknownOperation(); }}
      onReset={() => {
        setInputError(null);
        controller.reset();
      }}
    />
  );
}

/** Production page adapter: consumes the page-scoped controller shared with BattleActions. */
export function ArenaMultiplayerContextPanel(props: ArenaMultiplayerPanelProps) {
  const runtime = useArenaRoomContext();
  if (!runtime) return null;
  return (
    <ArenaMultiplayerPanelRuntime
      {...props}
      controller={runtime.controller}
      state={runtime.state}
      hostWorkspace={runtime.hostWorkspace}
      hostReconciliation={runtime.hostReconciliation}
      proposalWorkspace={runtime.proposalWorkspace}
    />
  );
}

/** Production result adapter: keeps the room report in the existing Arena result region. */
export function ArenaMultiplayerContextResult({ onSaveImage }: ArenaMultiplayerResultProps) {
  const runtime = useArenaRoomContext();
  if (!runtime?.state.session) return null;
  return <ArenaRoomGenerationResult state={runtime.state} onSaveImage={onSaveImage} />;
}
