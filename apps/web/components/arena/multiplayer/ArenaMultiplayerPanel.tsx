'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import { ChevronDown } from 'lucide-react';

import { MAX_ROOM_MEMBERS, type RoomDirectoryVisibility } from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import type { ArenaRoomPanelUi } from './useArenaRoom';
import {
  createArenaRoomCanonicalEmptyDraftBundle,
  tryBuildArenaRoomHostWorkspaceBundleFromBattleState,
  type ArenaRoomShareabilityIssue,
} from '@/lib/arena-room/shared-config';
import { arenaRoomHostWorkspaceAuthorityFromSession } from '@/lib/arena-room/host-workspace';
import {
  buildArenaRoomInviteText,
  parseArenaRoomJoinCode,
} from '@/lib/arena-room/join-code';
import { copyTextToClipboard } from '@/lib/clipboard';
import { ActionBar } from '@/components/shared/ui/ActionBar';
import { Badge, CountBadge } from '@/components/shared/ui/Badge';
import { Button, buttonClassName } from '@/components/shared/ui/Button';
import { inputClassName } from '@/components/shared/ui/Input';
import { StatusLine } from '@/components/shared/ui/StatusNotice';
import {
  arenaRoomGenerationErrorCopy,
  arenaRoomGenerationGapNotice,
  arenaRoomGenerationStatusLabel,
  arenaRoomGenerationUnknownNotice,
} from './presentation/generation-copy';
import { arenaRoomConfigSyncLabel } from './presentation/room-copy';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { ArenaProposalPanel } from './ArenaProposalPanel';
import { ArenaHostConfigPanel } from './ArenaHostConfigPanel';
import { useArenaRoomContext } from './useArenaRoom';
import { useArenaRoomAutoTitle } from './useArenaRoomAutoTitle';
import type { ArenaRoomLatestCompletedHistory } from './useArenaRoomLatestCompletedHistory';
import { ArenaRoomLatestHistoryResult } from './ArenaRoomLatestHistoryResult';
import { BattleResultPresentation } from '../components/BattleResultPresentation';
import { ArenaRoomDialog } from './ArenaRoomDialog';
import { ArenaRoomGenerationHistory } from './ArenaRoomGenerationHistory';

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
  readonly origin?: string;
  readonly actionPending?: boolean;
  readonly hostConfigContent?: ReactNode;
  readonly proposalContent?: ReactNode;
  readonly generationHistoryContent?: ReactNode;
  readonly hostConfigStatus?: 'idle' | 'synchronizing' | 'synced' | 'attention';
  readonly proposalWorkspaceActive?: boolean;
  readonly localConfigSyncIssues?: readonly ArenaRoomShareabilityIssue[];
  readonly generationHistoryCount?: number;
  /** 受控模式：底部大按钮等外部入口通过 runtime.panelUi 共享 Modal 开关。 */
  readonly hostPanelUi?: ArenaRoomPanelUi;
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

const MULTIPLAYER_GUIDE_HREF = '/encyclopedia/arena-multiplayer';

const formatRoomActivityTime = (iso: string): string => {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  const deltaMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (deltaMinutes < 1) return '刚刚活跃';
  if (deltaMinutes < 60) return `${deltaMinutes} 分钟前活跃`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours} 小时前活跃`;
  return `${Math.floor(deltaHours / 24)} 天前活跃`;
};

const StatusNotice = ({ state }: { readonly state: ArenaRoomControllerState }) => {
  const session = state.phase === 'closed' || state.phase === 'replacement'
    ? null
    : state.session;
  const activeMemberCount = session?.snapshot.members.filter((member) => (
    member.membershipState === 'active'
  )).length ?? 0;
  const defaultNotice = state.phase === 'connected'
    ? (session && activeMemberCount <= 1
      ? '房间已连接；把房间码分享给朋友即可邀请加入'
      : '房间已连接')
    : '';
  return (
    <StatusLine>
      {state.notice ?? defaultNotice}
    </StatusLine>
  );
};

const roomMoreMenuItemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none dark:text-gray-200 dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800';

/** 二级操作收纳菜单：历史战报、房间管理、玩法说明等低频入口。 */
const RoomMoreMenu = ({
  generationHistoryCount,
  onOpenGenerationHistory,
  onOpenRoom,
  guideHref,
}: {
  readonly generationHistoryCount?: number;
  readonly onOpenGenerationHistory: () => void;
  readonly onOpenRoom: () => void;
  readonly guideHref: string;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);
  const closeWith = (action: () => void): void => {
    setOpen(false);
    action();
  };
  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多房间操作"
        onClick={() => setOpen((value) => !value)}
      >
        更多
        <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label="更多房间操作"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <button
            type="button"
            role="menuitem"
            className={roomMoreMenuItemClass}
            onClick={() => closeWith(onOpenGenerationHistory)}
          >
            {generationHistoryCount !== undefined && generationHistoryCount > 0
              ? `历史战报（${generationHistoryCount}）`
              : '历史战报'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={roomMoreMenuItemClass}
            onClick={() => closeWith(onOpenRoom)}
          >
            房间成员与操作
          </button>
          <Link
            href={`${guideHref}#房主与成员`}
            role="menuitem"
            className={roomMoreMenuItemClass}
            onClick={() => setOpen(false)}
          >
            玩法说明
          </Link>
        </div>
      ) : null}
    </div>
  );
};

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
      description="创建房间并邀请朋友一起围观战报、协作生成；也可以从公开房间目录或凭房间码加入。"
      widthClassName="max-w-4xl"
    >
      <StatusNotice state={state} />
      <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="space-y-3 rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/60">
              <legend className="px-1 text-sm font-semibold text-gray-950 dark:text-gray-100">创建房间</legend>
              <div>
                <label htmlFor="arena-room-title" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
                  房间标题
                </label>
                <input
                  id="arena-room-title"
                  className={inputClassName()}
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
                  className={inputClassName()}
                  value={visibility}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => onVisibilityChange(event.target.value as RoomDirectoryVisibility)}
                >
                  <option value="public">公开发现</option>
                  <option value="unlisted">仅凭房间码</option>
                </select>
              </div>
              <button type="button" className={buttonClassName({ variant: 'primary' })} disabled={busy || !roomTitle.trim()} onClick={onCreate}>
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
                  className={inputClassName()}
                  maxLength={1024}
                  value={joinCode}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => onJoinCodeChange(event.target.value)}
                />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  支持直接粘贴完整邀请文案或分享文本，会自动识别其中的房间码。
                </p>
              </div>
              <button type="button" className={buttonClassName({ variant: 'primary' })} disabled={busy || !joinCode.trim()} onClick={() => onJoin(joinCode.trim())}>
                加入房间
              </button>
            </fieldset>
          </div>

          <section aria-labelledby="arena-public-room-heading" className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="arena-public-room-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">公开房间</h4>
              <button type="button" className={buttonClassName()} disabled={busy} onClick={onDiscover}>
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
                {state.rooms.map((room) => {
                  const memberLine = [
                    room.hostDisplayName ?? null,
                    room.memberCount ? `${room.memberCount}/${room.memberLimit ?? MAX_ROOM_MEMBERS} 人` : null,
                  ].filter((part): part is string => Boolean(part)).join(' · ');
                  return (
                    <li
                      key={room.roomId}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-gray-900/70"
                      title={room.roomId}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-950 dark:text-gray-100" title={room.title}>{room.title}</p>
                        {memberLine ? (
                          <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">{memberLine}</p>
                        ) : null}
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">{formatRoomActivityTime(room.lastActivityAt)}</p>
                      </div>
                      <Button className="shrink-0" disabled={busy} onClick={() => onJoin(room.roomId)}>
                        加入
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {state.directoryNextCursor ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  className={buttonClassName()}
                  disabled={Boolean(state.directoryLoadingMore)}
                  onClick={onDiscoverMore}
                >
                  {state.directoryLoadingMore ? '正在加载更多…' : '加载更多'}
                </button>
              </div>
            ) : null}
          </section>

          <div className="mt-4 rounded-xl border border-fuchsia-200 bg-fuchsia-50/70 p-3 text-sm text-gray-700 dark:border-fuchsia-900 dark:bg-fuchsia-950/20 dark:text-gray-200">
            <p className="font-medium text-gray-950 dark:text-gray-100">两种最简单的玩法</p>
            <p className="mt-1">👀 只想围观：加入房间后什么都不做，等房主开始生成，即可实时围观同一份战报。</p>
            <p className="mt-1">🎲 多人跑团：每位成员提案自己的角色，并在角色「行动」里写下本轮行动引导，房主接受大家的提案后统一生成。</p>
            <Link
              href={`${MULTIPLAYER_GUIDE_HREF}#两种最简单的玩法`}
              className="mt-2 inline-block font-medium text-fuchsia-700 hover:underline dark:text-fuchsia-300"
            >
              查看完整玩法说明
            </Link>
          </div>
    </ArenaRoomDialog>
  );
};

export const ArenaRoomGenerationResult = ({ state, onSaveImage }: {
  readonly state: ArenaRoomControllerState;
  readonly onSaveImage?: (imageUrl: string) => void;
}) => {
  const generation = state.generation;
  if (generation.phase === 'idle' && !generation.markdown) return null;

  const statusLabel = arenaRoomGenerationStatusLabel(generation);
  const errorCopy = generation.errorCode ? arenaRoomGenerationErrorCopy(generation.errorCode) : null;

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
        <Badge>{statusLabel}</Badge>
      </div>
      {generation.phase === 'unknown' ? (
        <p role="status" className="mt-3 text-sm text-amber-800 dark:text-amber-200">
          {arenaRoomGenerationUnknownNotice}
        </p>
      ) : null}
      {generation.gap ? (
        <p role="status" className="mt-3 text-sm text-amber-800 dark:text-amber-200">
          {arenaRoomGenerationGapNotice}
        </p>
      ) : null}
      {errorCopy ? (
        <div role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300" data-generation-error-code={generation.errorCode}>
          <p>{errorCopy.message}</p>
          <details className="mt-1 text-xs opacity-80">
            <summary className="cursor-pointer select-none">技术详情</summary>
            <p className="mt-1">错误代码：{generation.errorCode}</p>
          </details>
        </div>
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
  const [localConfigOpen, setLocalConfigOpen] = useState(false);
  const [localProposalsOpen, setLocalProposalsOpen] = useState(false);
  const configOpen = props.hostPanelUi ? props.hostPanelUi.configOpen : localConfigOpen;
  const proposalsOpen = props.hostPanelUi ? props.hostPanelUi.proposalsOpen : localProposalsOpen;
  const setConfigOpen = useCallback((open: boolean): void => {
    if (props.hostPanelUi) props.hostPanelUi.setConfigOpen(open);
    else setLocalConfigOpen(open);
  }, [props.hostPanelUi]);
  const setProposalsOpen = useCallback((open: boolean): void => {
    if (props.hostPanelUi) props.hostPanelUi.setProposalsOpen(open);
    else setLocalProposalsOpen(open);
  }, [props.hostPanelUi]);
  const [generationHistoryOpen, setGenerationHistoryOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [kickConfirmation, setKickConfirmation] = useState<{
    readonly targetUserId: string;
    readonly displayName: string;
  } | null>(null);
  const [managementConfirmation, setManagementConfirmation] = useState<
    'cancel' | 'close' | 'leave' | null
  >(null);
  const panelRef = useRef<HTMLElement>(null);
  const kickConfirmationActionRef = useRef<HTMLButtonElement>(null);
  const kickTriggerRef = useRef<HTMLButtonElement | null>(null);
  const managementConfirmationActionRef = useRef<HTMLButtonElement>(null);
  const cancelGenerationTriggerRef = useRef<HTMLButtonElement>(null);
  const closeRoomTriggerRef = useRef<HTMLButtonElement>(null);
  const leaveRoomTriggerRef = useRef<HTMLButtonElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const session = state.phase === 'closed' || state.phase === 'replacement'
    ? null
    : state.session;
  const hadSessionRef = useRef(Boolean(session));
  const onDiscoverRef = useRef(props.onDiscover);
  onDiscoverRef.current = props.onDiscover;
  useEffect(() => {
    if (props.proposalWorkspaceActive) setProposalsOpen(false);
  }, [props.proposalWorkspaceActive, setProposalsOpen]);
  useEffect(() => {
    const hadSession = hadSessionRef.current;
    hadSessionRef.current = Boolean(session);
    if (!hadSession || session) return;
    queueMicrotask(() => panelRef.current?.focus());
    if (state.phase === 'replacement' || state.phase === 'closed' || state.phase === 'unknown') {
      return;
    }
    // 会话以 ready 结束（离开/关闭房间）：自动回到大厅并刷新公开房间列表，
    // 避免「自动打开的多人房间」显示上一次会话遗留的过期空列表。
    setLobbyOpen(true);
    onDiscoverRef.current();
  }, [session, state.phase]);
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);
  useEffect(() => {
    if (kickConfirmation) kickConfirmationActionRef.current?.focus();
  }, [kickConfirmation]);
  useEffect(() => {
    if (managementConfirmation) managementConfirmationActionRef.current?.focus();
  }, [managementConfirmation]);
  if (state.phase === 'disabled') return null;

  const busy = Boolean(props.actionPending)
    || (state.managementOperation !== null && state.managementOperation !== undefined)
    || ['connecting', 'listing', 'reconnecting'].includes(state.phase);
  const activeMembers = session?.snapshot.members.filter((member) => (
    member.membershipState === 'active'
  )) ?? [];
  const host = activeMembers.find((member) => member.role === 'host');
  const activeGeneration = session?.snapshot.activeGeneration;
  const canCancelGeneration = session?.self.role === 'host'
    && (activeGeneration?.state === 'starting' || activeGeneration?.state === 'running');
  const pendingProposalCount = session?.self.role === 'host'
    ? session.snapshot.proposals.length
    : 0;
  const hostConfigNeedsAttention = state.configPublishResultUnknown
    || props.hostConfigStatus === 'attention';
  const hostConfigSynchronizing = state.configPublishPending
    || props.hostConfigStatus === 'synchronizing';

  const copyRoomInfo = async (): Promise<void> => {
    if (!session) return;
    // 邀请链接必须指向用户正在浏览的 Web 站点（production/preview/本地天然正确）；
    // props.origin 是 Hono API origin，不能用于产品分享链接。
    const text = buildArenaRoomInviteText(window.location.origin, session.roomId);
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopiedInvite(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedInvite(false), 2_000);
  };

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby={session ? 'arena-multiplayer-heading' : undefined}
      aria-label={!session ? '多人模式' : undefined}
      data-arena-multiplayer-entry={!session ? 'compact' : undefined}
      className={session
        ? 'mt-5 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/70 p-4 dark:border-fuchsia-900 dark:bg-fuchsia-950/20 sm:p-5'
        : 'mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-fuchsia-200 bg-fuchsia-50/70 px-3 py-2 dark:border-fuchsia-900 dark:bg-fuchsia-950/20'}
      data-arena-multiplayer="v1"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {session ? (
            <h2 id="arena-multiplayer-heading" className="text-lg font-semibold text-gray-950 dark:text-gray-50">
              竞技场多人房间
            </h2>
          ) : null}
        </div>
        {!session && !props.authLoading && (state.phase === 'ready' || state.phase === 'listing') ? (
          <ActionBar>
            <button
              type="button"
              className={buttonClassName({ variant: 'primary' })}
              onClick={() => {
                setLobbyOpen(true);
                props.onDiscover();
              }}
            >
              打开多人房间
            </button>
            <Link
              href={`${MULTIPLAYER_GUIDE_HREF}#快速开始`}
              className={buttonClassName()}
            >
              玩法说明
            </Link>
          </ActionBar>
        ) : null}
      </div>

      {!session && (!lobbyOpen || state.phase === 'closed' || state.phase === 'replacement') ? (
        <div className="mt-2">
          <StatusNotice state={state} />
        </div>
      ) : null}

      {session ? (
        <div className="mt-3">
          <StatusNotice state={state} />
          {state.error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">
              {state.error}
            </p>
          ) : null}
          {props.localConfigSyncIssues && props.localConfigSyncIssues.length > 0 ? (
            <div
              role="status"
              className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <p className="font-medium">房间已创建，但当前本地配置尚未同步。</p>
              <p className="mt-1">房间已使用空草稿；请处理以下内容后再更新房间配置：</p>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                {props.localConfigSyncIssues.map((issue, index) => (
                  <li key={`${issue.code}:${issue.target}:${index}`} data-shareability-target={issue.target}>
                    <span>{issue.message}</span>
                    <span className="block text-xs opacity-90">处理建议：{issue.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

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
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-950 dark:text-gray-100">
                {host?.displayName ?? '未知'}的房间
                <span className="ml-2 font-normal text-gray-600 dark:text-gray-400">
                  {activeMembers.length} 人在线
                </span>
              </p>
              <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                <span className="font-mono" title={session.roomId}>{session.roomId}</span>
                <span className="inline-flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      session.self.role === 'host' && hostConfigNeedsAttention
                        ? 'bg-amber-500'
                        : session.self.role === 'host' && hostConfigSynchronizing
                          ? 'bg-sky-500'
                          : 'bg-emerald-500'
                    }`}
                  />
                  {session.self.role === 'host'
                    ? arenaRoomConfigSyncLabel({
                      needsAttention: hostConfigNeedsAttention,
                      synchronizing: hostConfigSynchronizing,
                    })
                    : '配置已同步'}
                </span>
              </p>
            </div>
            <ActionBar className="shrink-0">
              <Button
                aria-label="复制房间邀请文案"
                onClick={() => { void copyRoomInfo(); }}
              >
                {copiedInvite ? '已复制邀请' : '分享房间'}
              </Button>
              {session.self.role === 'host' ? (
                <Button
                  className={hostConfigNeedsAttention
                    ? 'border-amber-500 text-amber-800 dark:border-amber-600 dark:text-amber-200'
                    : undefined}
                  onClick={() => setConfigOpen(true)}
                >
                  {hostConfigNeedsAttention
                    ? '配置待处理'
                    : hostConfigSynchronizing
                      ? '同步配置中…'
                      : '配置'}
                </Button>
              ) : null}
              <Button
                className="relative"
                aria-label={pendingProposalCount > 0 ? `提案，${pendingProposalCount} 个待处理` : '提案'}
                onClick={() => setProposalsOpen(true)}
              >
                提案
                <CountBadge count={pendingProposalCount} />
              </Button>
              <RoomMoreMenu
                generationHistoryCount={props.generationHistoryCount}
                onOpenGenerationHistory={() => setGenerationHistoryOpen(true)}
                onOpenRoom={() => setRoomOpen(true)}
                guideHref={MULTIPLAYER_GUIDE_HREF}
              />
            </ActionBar>
          </div>

          <ActionBar className="mt-2">
            {state.phase === 'degraded'
            || state.phase === 'reconnecting'
            || state.configPublishResultUnknown
            || state.managementResultUnknown ? (
              <button type="button" className={buttonClassName()} onClick={props.onReconnect}>
                {state.managementResultUnknown
                  ? '重新确认上次操作'
                  : state.configPublishResultUnknown
                    ? '重新确认配置状态'
                    : '重新连接'}
              </button>
            ) : null}
            {state.phase === 'replacement' || state.phase === 'closed' ? (
              <button type="button" className={buttonClassName()} onClick={props.onReset}>
                返回房间大厅
              </button>
            ) : null}
          </ActionBar>

          <ArenaRoomDialog
            open={configOpen}
            onClose={() => setConfigOpen(false)}
            titleId="arena-room-config-dialog-heading"
            title="房间配置"
            description="房间设置在主编辑区修改；此面板处理本地编辑与房间的同步。"
          >
            {props.hostConfigContent ?? (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                当前房间配置会自动同步到主编辑区；如有本地冲突，请先比较后再选择。
              </p>
            )}
          </ArenaRoomDialog>

          <ArenaRoomDialog
            open={proposalsOpen}
            onClose={() => setProposalsOpen(false)}
            titleId="arena-room-proposals-dialog-heading"
            title="房间提案"
            description="成员在主编辑区编辑，房主在此逐项审阅配置变更。"
            widthClassName="max-w-5xl"
          >
            {props.proposalContent ?? (
              <p className="text-sm text-gray-700 dark:text-gray-300">当前没有待处理提案。</p>
            )}
          </ArenaRoomDialog>

          <ArenaRoomDialog
            open={generationHistoryOpen}
            onClose={() => setGenerationHistoryOpen(false)}
            titleId="arena-room-generation-history-dialog-heading"
            title="历史战报"
            description="当前房间成员可以查看本房间近期生成的战报。"
            widthClassName="max-w-5xl"
          >
            {props.generationHistoryContent ?? (
              <p className="text-sm text-gray-700 dark:text-gray-300">当前没有可查看的历史战报。</p>
            )}
          </ArenaRoomDialog>

          <ArenaRoomDialog
            open={roomOpen}
            onClose={() => {
              setKickConfirmation(null);
              setManagementConfirmation(null);
              setRoomOpen(false);
            }}
            titleId="arena-room-overview-dialog-heading"
            title="房间"
            description={`当前 ${activeMembers.length} 人在线。`}
          >
            {kickConfirmation ? (
              <div role="alertdialog" aria-label="确认移除成员" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                <p>确定将“{kickConfirmation.displayName}”移出当前房间吗？</p>
                <ActionBar className="mt-3">
                  <button
                    ref={kickConfirmationActionRef}
                    type="button"
                    className={buttonClassName({ variant: 'primary' })}
                    disabled={busy}
                    onClick={() => {
                      const targetUserId = kickConfirmation.targetUserId;
                      setKickConfirmation(null);
                      setRoomOpen(false);
                      props.onKick?.(targetUserId);
                    }}
                  >
                    确认移除成员
                  </button>
                  <button
                    type="button"
                    className={buttonClassName()}
                    onClick={() => {
                      setKickConfirmation(null);
                      queueMicrotask(() => kickTriggerRef.current?.focus());
                    }}
                  >
                    取消
                  </button>
                </ActionBar>
              </div>
            ) : null}
            <section aria-labelledby="arena-room-members-heading">
              <h3 id="arena-room-members-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
                房间成员
              </h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="房间成员列表">
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
                        className={buttonClassName()}
                        disabled={busy}
                        onClick={(event) => {
                          kickTriggerRef.current = event.currentTarget;
                          setManagementConfirmation(null);
                          setKickConfirmation({
                            targetUserId: member.userId,
                            displayName: member.displayName,
                          });
                        }}
                      >
                        移除
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {activeMembers.length <= 1 ? (
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  房间里还没有其他成员；把房间面板中的房间码分享给朋友即可邀请加入。
                </p>
              ) : null}
            </section>

            <section aria-labelledby="arena-room-actions-heading" className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
              <h3 id="arena-room-actions-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
                {session.self.role === 'host' ? '房间操作' : '退出房间'}
              </h3>
              {managementConfirmation ? (
                <div role="alertdialog" aria-label="确认房间管理动作" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                  <p>
                    {managementConfirmation === 'close'
                      ? '确定关闭房间吗？所有成员都会断开。'
                      : managementConfirmation === 'leave'
                        ? '确定离开当前房间吗？'
                        : '确定停止当前战报生成吗？'}
                  </p>
                  <ActionBar className="mt-3">
                    <button
                      ref={managementConfirmationActionRef}
                      type="button"
                      className={buttonClassName({ variant: 'primary' })}
                      disabled={busy}
                      onClick={() => {
                        const operation = managementConfirmation;
                        setManagementConfirmation(null);
                        setRoomOpen(false);
                        if (operation === 'close') props.onClose();
                        else if (operation === 'leave') props.onLeave();
                        else props.onCancelGeneration?.();
                      }}
                    >
                      {managementConfirmation === 'close'
                        ? '确认关闭房间'
                        : managementConfirmation === 'leave'
                          ? '确认离开房间'
                          : '确认停止生成'}
                    </button>
                    <button
                      type="button"
                      className={buttonClassName()}
                      onClick={() => {
                        const operation = managementConfirmation;
                        setManagementConfirmation(null);
                        queueMicrotask(() => {
                          if (operation === 'cancel') cancelGenerationTriggerRef.current?.focus();
                          else if (operation === 'close') closeRoomTriggerRef.current?.focus();
                          else leaveRoomTriggerRef.current?.focus();
                        });
                      }}
                    >
                      取消
                    </button>
                  </ActionBar>
                </div>
              ) : session.self.role === 'host' ? (
                <ActionBar className="mt-3">
                  <button
                    ref={cancelGenerationTriggerRef}
                    type="button"
                    className={buttonClassName()}
                    disabled={busy || !canCancelGeneration}
                    onClick={() => {
                      setKickConfirmation(null);
                      setManagementConfirmation('cancel');
                    }}
                  >
                    停止当前生成
                  </button>
                  <button
                    ref={closeRoomTriggerRef}
                    type="button"
                    className={buttonClassName()}
                    disabled={busy}
                    onClick={() => {
                      setKickConfirmation(null);
                      setManagementConfirmation('close');
                    }}
                  >
                    关闭房间
                  </button>
                </ActionBar>
              ) : (
                <button
                  ref={leaveRoomTriggerRef}
                  type="button"
                  className={buttonClassName({ className: 'mt-3' })}
                  disabled={busy}
                  onClick={() => setManagementConfirmation('leave')}
                >
                  离开房间
                </button>
              )}
            </section>
          </ArenaRoomDialog>
        </div>
      ) : state.phase === 'unknown' ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>
            {state.unknownOperation === 'join'
              ? '服务器可能已经处理加入请求。可以重新查询确认结果，不会重复加入。'
              : '服务器可能已经创建房间。可以重新查询确认结果，不会重复创建。'}
          </p>
          <ActionBar className="mt-3">
            <button type="button" className={buttonClassName()} onClick={props.onRetryUnknown}>
              {state.unknownOperation === 'join' ? '重新确认加入结果' : '重新确认创建结果'}
            </button>
            <button type="button" className={buttonClassName()} onClick={props.onReset}>
              已确认状态，返回大厅
            </button>
          </ActionBar>
        </div>
      ) : state.phase === 'replacement' || state.phase === 'closed' ? (
        <button type="button" className={buttonClassName({ className: 'mt-4' })} onClick={props.onReset}>
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

type ArenaRoomRuntimeContext = NonNullable<ReturnType<typeof useArenaRoomContext>>;

type ArenaMultiplayerPanelRuntimeProps = ArenaMultiplayerPanelProps & {
  readonly controller: ArenaRoomRuntimeContext['controller'];
  readonly state: ArenaRoomRuntimeContext['state'];
  readonly hostWorkspace: ArenaRoomRuntimeContext['hostWorkspace'];
  readonly hostReconciliation: ArenaRoomRuntimeContext['hostReconciliation'];
  readonly proposalWorkspace: ArenaRoomRuntimeContext['proposalWorkspace'];
  readonly generationHistory: ArenaRoomRuntimeContext['generationHistory'];
  readonly latestGenerationHistory: ArenaRoomLatestCompletedHistory;
};

function ArenaMultiplayerPanelRuntime({
  controller,
  state,
  hostWorkspace,
  hostReconciliation,
  proposalWorkspace,
  generationHistory,
  latestGenerationHistory,
  ...props
}: ArenaMultiplayerPanelRuntimeProps) {
  const [roomTitle, setRoomTitle] = useArenaRoomAutoTitle(props.displayName);
  const [visibility, setVisibility] = useState<RoomDirectoryVisibility>('public');
  const [joinCode, setJoinCode] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [localConfigSyncIssues, setLocalConfigSyncIssues] = useState<readonly ArenaRoomShareabilityIssue[]>([]);
  const [preparingCreate, setPreparingCreate] = useState(false);
  const createLock = useRef(false);
  const runtime = useArenaRoomContext();
  const panelUi = runtime?.panelUi;
  const viewState = inputError ? { ...state, error: inputError } : state;
  const generationHistoryScope = viewState.session
    ? `${viewState.session.roomId}\n${viewState.session.roomEpoch}\n${viewState.session.self.userId}`
    : 'no-room-session';

  const createRoom = async (): Promise<void> => {
    if (createLock.current) return;
    createLock.current = true;
    setPreparingCreate(true);
    setInputError(null);
    setLocalConfigSyncIssues([]);
    try {
      const buildResult = await tryBuildArenaRoomHostWorkspaceBundleFromBattleState(
        useBattleStore.getState(),
      );
      const bundle = buildResult.ok
        ? buildResult.bundle
        : createArenaRoomCanonicalEmptyDraftBundle();
      await controller.create({
        displayName: props.displayName || '玩家',
        directory: { title: roomTitle, visibility },
        sharedConfig: bundle.sharedConfig,
      });
      const authority = arenaRoomHostWorkspaceAuthorityFromSession(
        controller.getSnapshot().session,
      );
      if (authority) {
        hostWorkspace.capturePublished(authority, bundle);
        if (!buildResult.ok) setLocalConfigSyncIssues(buildResult.issues);
      }
    } catch (error) {
      setInputError(error instanceof Error && error.message.trim()
        ? `创建房间时发生本地错误：${error.message}`
        : '创建房间时无法读取当前本地配置，请重试。');
    } finally {
      createLock.current = false;
      setPreparingCreate(false);
    }
  };

  return (
    <ArenaMultiplayerPanelView
      state={viewState}
      authLoading={props.authLoading}
      origin={props.origin}
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
      generationHistoryContent={(
        <ArenaRoomGenerationHistory key={generationHistoryScope} reader={generationHistory} />
      )}
      hostConfigStatus={hostReconciliation.state.kind === 'conflicted'
        || hostReconciliation.state.kind === 'error'
        ? 'attention'
        : hostReconciliation.state.kind}
      hostPanelUi={panelUi}
      proposalWorkspaceActive={Boolean(proposalWorkspace.editor)}
      localConfigSyncIssues={localConfigSyncIssues}
      generationHistoryCount={latestGenerationHistory.completedCount}
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
      onJoin={(rawRoomId) => {
        setInputError(null);
        // 粘贴的可能是整段邀请文案：先在本地提取房间码，绝不把原文当 roomId 提交。
        const parsed = parseArenaRoomJoinCode(rawRoomId);
        if (!parsed.ok) {
          setInputError(parsed.error);
          return;
        }
        void controller.join(parsed.roomId, props.displayName || '玩家');
      }}
      onLeave={() => { void controller.leave(); }}
      onClose={() => { void controller.close(); }}
      onKick={(targetUserId) => { void controller.kickMember(targetUserId); }}
      onCancelGeneration={() => { void controller.cancelGeneration(); }}
      onReconnect={controller.reconnect}
      onRetryUnknown={() => { void controller.retryUnknownOperation(); }}
      onReset={() => {
        setInputError(null);
        setLocalConfigSyncIssues([]);
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
      generationHistory={runtime.generationHistory}
      latestGenerationHistory={runtime.latestGenerationHistory}
    />
  );
}

/** Production result adapter: keeps the room report in the existing Arena result region. */
export function ArenaMultiplayerContextResult({ onSaveImage }: ArenaMultiplayerResultProps) {
  const runtime = useArenaRoomContext();
  if (!runtime?.state.session) return null;
  const generation = runtime.state.generation;
  if (generation.phase !== 'idle' || generation.markdown) {
    return <ArenaRoomGenerationResult state={runtime.state} onSaveImage={onSaveImage} />;
  }
  return <ArenaRoomLatestHistoryResult history={runtime.latestGenerationHistory} onSaveImage={onSaveImage} />;
}
