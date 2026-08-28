'use client';

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import type { RoomDirectoryVisibility } from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import { buildArenaRoomSharedConfigFromBattleState } from '@/lib/arena-room/shared-config';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { ArenaProposalPanel } from './ArenaProposalPanel';
import { useArenaRoom, useArenaRoomContext } from './useArenaRoom';

export type ArenaMultiplayerPanelProps = {
  readonly enabled: boolean;
  readonly origin: string;
  readonly authLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly displayName: string;
};

export type ArenaMultiplayerPanelViewProps = {
  readonly state: ArenaRoomControllerState;
  readonly authLoading: boolean;
  readonly actionPending?: boolean;
  readonly proposalContent?: ReactNode;
  readonly roomTitle: string;
  readonly visibility: RoomDirectoryVisibility;
  readonly joinCode: string;
  readonly onRoomTitleChange: (value: string) => void;
  readonly onVisibilityChange: (value: RoomDirectoryVisibility) => void;
  readonly onJoinCodeChange: (value: string) => void;
  readonly onCreate: () => void;
  readonly onDiscover: () => void;
  readonly onJoin: (roomId: string) => void;
  readonly onLeave: () => void;
  readonly onClose: () => void;
  readonly onReconnect: () => void;
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

const ArenaRoomGenerationReport = ({ state }: {
  readonly state: ArenaRoomControllerState;
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
      {generation.markdown ? (
        <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-gray-900 dark:text-gray-100">
          {generation.markdown}
        </div>
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
  if (state.phase === 'disabled') return null;

  const busy = Boolean(props.actionPending)
    || ['connecting', 'listing', 'reconnecting'].includes(state.phase);
  const session = state.session;

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
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            房间状态由服务器维护；本地角色与情景只共享安全摘要。
          </p>
        </div>
        <span className="rounded-full border border-fuchsia-300 px-2.5 py-1 text-xs font-medium text-fuchsia-900 dark:border-fuchsia-700 dark:text-fuchsia-100">
          Development Gate
        </span>
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
        <div className="mt-4 space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-gray-600 dark:text-gray-400">房间码</dt>
              <dd className="mt-1 break-all font-mono text-gray-950 dark:text-gray-100">{session.roomId}</dd>
            </div>
            <div>
              <dt className="text-gray-600 dark:text-gray-400">身份</dt>
              <dd className="mt-1 font-medium text-gray-950 dark:text-gray-100">
                {session.self.role === 'host' ? '房主' : '成员'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-600 dark:text-gray-400">连接状态</dt>
              <dd className="mt-1 font-medium text-gray-950 dark:text-gray-100">{state.phase}</dd>
            </div>
          </dl>

          <div>
            <h3 className="text-sm font-semibold text-gray-950 dark:text-gray-100">房间成员</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="房间成员列表">
              {session.snapshot.members.map((member) => (
                <li key={member.userId} className="rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/70">
                  <span className="font-medium text-gray-950 dark:text-gray-100">{member.displayName}</span>
                  <span className="ml-2 text-gray-600 dark:text-gray-400">
                    {member.role === 'host' ? '房主' : '成员'} · {member.membershipState === 'active' ? '在房间' : '已离开'}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {props.proposalContent}

          <ArenaRoomGenerationReport state={state} />

          <div className="flex flex-wrap gap-2">
            {state.phase === 'degraded' || state.phase === 'reconnecting' ? (
              <button type="button" className={secondaryButtonClass} onClick={props.onReconnect}>
                重新连接
              </button>
            ) : null}
            {state.phase === 'replacement' || state.phase === 'closed' ? (
              <button type="button" className={secondaryButtonClass} onClick={props.onReset}>
                返回房间大厅
              </button>
            ) : session.self.role === 'host' ? (
              <button type="button" className={secondaryButtonClass} disabled={busy} onClick={props.onClose}>
                关闭房间
              </button>
            ) : (
              <button type="button" className={secondaryButtonClass} disabled={busy} onClick={props.onLeave}>
                离开房间
              </button>
            )}
          </div>
        </div>
      ) : state.phase === 'unknown' ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>
            {state.unknownOperation === 'join'
              ? '服务器可能已经处理加入请求。请先确认当前房间状态，不要直接重复加入。'
              : '服务器可能已经创建房间。请先检查公开房间或其他已登录设备，不要直接重复创建。'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.unknownOperation === 'create' ? (
              <button type="button" className={secondaryButtonClass} onClick={props.onDiscover}>
                检查公开房间
              </button>
            ) : null}
            <button type="button" className={secondaryButtonClass} onClick={props.onReset}>
              已确认状态，返回大厅
            </button>
          </div>
          {state.rooms.length > 0 ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="可能已创建的公开房间">
              {state.rooms.map((room) => (
                <li key={room.roomId} className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-white/80 p-3 dark:border-amber-800 dark:bg-gray-900/70">
                  <span className="min-w-0 truncate font-medium">{room.title}</span>
                  <button type="button" className={secondaryButtonClass} onClick={() => props.onJoin(room.roomId)}>
                    重新进入
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : state.phase === 'replacement' || state.phase === 'closed' ? (
        <button type="button" className={`${secondaryButtonClass} mt-4`} onClick={props.onReset}>
          返回房间大厅
        </button>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
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
                value={props.roomTitle}
                onChange={(event: ChangeEvent<HTMLInputElement>) => props.onRoomTitleChange(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="arena-room-visibility" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
                可发现性
              </label>
              <select
                id="arena-room-visibility"
                className={inputClass}
                value={props.visibility}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => props.onVisibilityChange(event.target.value as RoomDirectoryVisibility)}
              >
                <option value="public">公开发现</option>
                <option value="unlisted">仅凭房间码</option>
              </select>
            </div>
            <button type="button" className={primaryButtonClass} disabled={busy || !props.roomTitle.trim()} onClick={props.onCreate}>
              创建多人房间
            </button>
          </fieldset>

          <fieldset className="space-y-3 rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/60">
            <legend className="px-1 text-sm font-semibold text-gray-950 dark:text-gray-100">发现或加入</legend>
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={props.onDiscover}>
              发现公开房间
            </button>
            <div>
              <label htmlFor="arena-room-join-code" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
                房间码
              </label>
              <input
                id="arena-room-join-code"
                className={inputClass}
                maxLength={256}
                value={props.joinCode}
                onChange={(event: ChangeEvent<HTMLInputElement>) => props.onJoinCodeChange(event.target.value)}
              />
            </div>
            <button type="button" className={primaryButtonClass} disabled={busy || !props.joinCode.trim()} onClick={() => props.onJoin(props.joinCode.trim())}>
              加入房间
            </button>
          </fieldset>

          {state.rooms.length > 0 ? (
            <div className="lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-950 dark:text-gray-100">公开房间</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="公开房间列表">
                {state.rooms.map((room) => (
                  <li key={room.roomId} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-gray-900/70">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-950 dark:text-gray-100">{room.title}</p>
                      <p className="truncate font-mono text-xs text-gray-600 dark:text-gray-400">{room.roomId}</p>
                    </div>
                    <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => props.onJoin(room.roomId)}>
                      加入
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function ArenaMultiplayerPanel(props: ArenaMultiplayerPanelProps) {
  const { controller, state } = useArenaRoom({
    enabled: props.enabled,
    authenticated: props.isAuthenticated && !props.authLoading,
    origin: props.origin,
  });
  return (
    <ArenaMultiplayerPanelRuntime
      {...props}
      controller={controller}
      state={state}
    />
  );
}

type ArenaMultiplayerPanelRuntimeProps = ArenaMultiplayerPanelProps & {
  readonly controller: ReturnType<typeof useArenaRoom>['controller'];
  readonly state: ReturnType<typeof useArenaRoom>['state'];
};

function ArenaMultiplayerPanelRuntime({
  controller,
  state,
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
      const sharedConfig = await buildArenaRoomSharedConfigFromBattleState(
        useBattleStore.getState(),
      );
      await controller.create({
        displayName: props.displayName || '玩家',
        directory: { title: roomTitle, visibility },
        sharedConfig,
      });
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
      proposalContent={<ArenaProposalPanel state={viewState} controller={controller} />}
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
      onJoin={(roomId) => {
        setInputError(null);
        void controller.join(roomId, props.displayName || '玩家');
      }}
      onLeave={() => { void controller.leave(); }}
      onClose={() => { void controller.close(); }}
      onReconnect={controller.reconnect}
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
    />
  );
}
