'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ArenaRoomHttpErrorCode,
  ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';
import {
  applyArenaRoomAuthorityToBattleStore,
} from '@/lib/arena-room/host-reconciliation';
import { verifyArenaContentOrigin } from '@/lib/arena/verify-origin';
import {
  areArenaRoomSharedConfigsEqual,
  arenaRoomHostWorkspaceAuthorityFromSession,
  type ArenaRoomHostWorkspace,
  type ArenaRoomHostWorkspaceAuthority,
  type ArenaRoomHostWorkspaceDirtyReason,
} from '@/lib/arena-room/host-workspace';
import { fetchPublicDataCardRowById } from '@/lib/public-card-cache/public-data-card-api';
import { buildArenaRoomHostWorkspaceBundleFromBattleState } from '@/lib/arena-room/shared-config';

export type ArenaRoomHostReconciliationState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{
      kind: 'synchronizing';
      action: 'auto' | 'publish' | 'sync-room';
    }>
  | Readonly<{
      kind: 'synced';
      revision: number;
      message: string;
    }>
  | Readonly<{
      kind: 'conflicted';
      revision: number;
      reasons: readonly ArenaRoomHostWorkspaceDirtyReason[];
      roomConfig: ArenaRoomSharedConfig;
      localConfig: ArenaRoomSharedConfig | null;
    }>
  | Readonly<{
      kind: 'error';
      code: ArenaRoomHostReconciliationErrorCode;
      message: string;
    }>;

export type ArenaRoomHostReconciliationErrorCode = Extract<
  ArenaRoomHttpErrorCode,
  'ROOM_GENERATION_RECONCILIATION_REQUIRED'
>;

export const ARENA_ROOM_HOST_RECONCILIATION_ERROR_CODE: ArenaRoomHostReconciliationErrorCode = (
  'ROOM_GENERATION_RECONCILIATION_REQUIRED'
);

export type ArenaRoomHostReconciliation = Readonly<{
  state: ArenaRoomHostReconciliationState;
  publishLocal(): Promise<void>;
  syncRoom(): Promise<void>;
  dismiss(): void;
}>;

const authorityIdentity = (authority: ArenaRoomHostWorkspaceAuthority): string => (
  `${authority.roomId}\n${authority.roomEpoch}\n${authority.ownerUserId}`
);

const isSameAuthorityRevision = (
  left: ArenaRoomHostWorkspaceAuthority | null,
  right: ArenaRoomHostWorkspaceAuthority,
): boolean => Boolean(
  left
  && authorityIdentity(left) === authorityIdentity(right)
  && left.revision === right.revision,
);

const authorityKeyOf = (authority: ArenaRoomHostWorkspaceAuthority): string => (
  `${authorityIdentity(authority)}\n${authority.revision}`
);

const loadPublicCard = async (id: string): Promise<unknown> => {
  const result = await fetchPublicDataCardRowById(id);
  if (result.kind === 'success') return result.card;
  throw new Error(result.kind === 'not-found'
    ? `公开数据卡 ${id} 已不存在`
    : `公开数据卡 ${id} 暂时无法读取`);
};

const currentAuthority = (
  controller: ArenaRoomController,
): ArenaRoomHostWorkspaceAuthority | null => (
  arenaRoomHostWorkspaceAuthorityFromSession(controller.getSnapshot().session)
);

const reconciliationErrorState = (
  error: unknown,
  fallback: string,
): Extract<ArenaRoomHostReconciliationState, { readonly kind: 'error' }> => Object.freeze({
  kind: 'error',
  code: ARENA_ROOM_HOST_RECONCILIATION_ERROR_CODE,
  message: error instanceof Error && error.message.trim() ? error.message : fallback,
});

export const useArenaRoomHostReconciliation = ({
  controller,
  controllerState,
  hostWorkspace,
}: {
  readonly controller: ArenaRoomController;
  readonly controllerState: ArenaRoomControllerState;
  readonly hostWorkspace: ArenaRoomHostWorkspace;
}): ArenaRoomHostReconciliation => {
  const [state, setState] = useState<ArenaRoomHostReconciliationState>({ kind: 'idle' });
  const observedAuthorityRef = useRef<ArenaRoomHostWorkspaceAuthority | null>(null);
  const inFlightKeyRef = useRef<string | null>(null);
  const actionLockRef = useRef(false);
  const operationGenerationRef = useRef(0);

  const installAuthority = useCallback(async (
    authority: ArenaRoomHostWorkspaceAuthority,
    action: 'auto' | 'sync-room',
    operationGeneration: number,
  ): Promise<void> => {
    setState({ kind: 'synchronizing', action });
    const battleStateAtStart = useBattleStore.getState();
    const currentBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      battleStateAtStart,
    );
    const roomStart = hostWorkspace.startFromRoom(authority);
    await applyArenaRoomAuthorityToBattleStore(authority.sharedConfig, {
      currentBundle,
      loadPublicCard,
      hostLocalPayloads: roomStart?.hostLocalPayloads,
      verifyOrigin: verifyArenaContentOrigin,
      commitIf: () => (
        operationGenerationRef.current === operationGeneration
        && useBattleStore.getState() === battleStateAtStart
        && isSameAuthorityRevision(currentAuthority(controller), authority)
      ),
    });
    if (
      operationGenerationRef.current !== operationGeneration
      || !isSameAuthorityRevision(currentAuthority(controller), authority)
    ) return;
    const synchronizedState = useBattleStore.getState();
    const synchronizedBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      synchronizedState,
    );
    if (
      operationGenerationRef.current !== operationGeneration
      || useBattleStore.getState() !== synchronizedState
      || !isSameAuthorityRevision(currentAuthority(controller), authority)
    ) {
      throw new Error('房间配置同步期间状态已变化，未覆盖新的本地修改');
    }
    if (!areArenaRoomSharedConfigsEqual(
      synchronizedBundle.sharedConfig,
      authority.sharedConfig,
    )) {
      throw new Error('同步后的本地配置仍与当前房间配置不一致');
    }
    hostWorkspace.capturePublished(authority, synchronizedBundle);
    setState({
      kind: 'synced',
      revision: authority.revision,
      message: action === 'auto'
        ? '房间配置已更新，并同步到 Arena 编辑区'
        : '已放弃本地冲突修改并同步当前房间配置',
    });
  }, [controller, hostWorkspace]);

  const runAutoReconcile = useCallback((): void => {
    if (actionLockRef.current) return;
    const authority = currentAuthority(controller);
    if (!authority) {
      operationGenerationRef.current += 1;
      observedAuthorityRef.current = null;
      inFlightKeyRef.current = null;
      setState({ kind: 'idle' });
      return;
    }
    const previous = observedAuthorityRef.current;
    if (!previous || authorityIdentity(previous) !== authorityIdentity(authority)) {
      // 房间/纪元/房主身份变化后没有任何已落定基线，不能假设本地与权威一致；
      // 首次观察只记录，等下一次 revision 变化再决定同步或冲突。
      operationGenerationRef.current += 1;
      observedAuthorityRef.current = authority;
      inFlightKeyRef.current = null;
      setState({ kind: 'idle' });
      return;
    }
    if (authority.revision <= previous.revision) return;
    observedAuthorityRef.current = authority;
    const settledAuthority = hostWorkspace.settledAuthority();
    if (
      settledAuthority
      && authorityIdentity(settledAuthority) === authorityIdentity(authority)
      && settledAuthority.revision >= authority.revision
    ) return;
    const key = authorityKeyOf(authority);
    if (inFlightKeyRef.current === key) return;
    const operationGeneration = ++operationGenerationRef.current;
    inFlightKeyRef.current = key;
    setState({ kind: 'synchronizing', action: 'auto' });
    void (async () => {
      try {
        const bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
          useBattleStore.getState(),
        );
        if (operationGenerationRef.current !== operationGeneration) return;
        const settled = hostWorkspace.settledAuthority();
        // 脏判定只参照「已成功落定的基线」；从未安装过的中间 revision
        // 不构成房主本地修改。没有落定基线时退回旧行为（与上一个观察对比）。
        const reference = settled && authorityIdentity(settled) === authorityIdentity(authority)
          ? settled
          : previous;
        const comparison = hostWorkspace.compare(reference, bundle);
        if (operationGenerationRef.current !== operationGeneration) return;
        if (comparison.kind === 'dirty') {
          setState({
            kind: 'conflicted',
            revision: authority.revision,
            reasons: comparison.reasons,
            roomConfig: authority.sharedConfig,
            localConfig: bundle.sharedConfig,
          });
          return;
        }
        await installAuthority(authority, 'auto', operationGeneration);
      } catch (error) {
        if (
          operationGenerationRef.current !== operationGeneration
          || !isSameAuthorityRevision(currentAuthority(controller), authority)
        ) return;
        setState(reconciliationErrorState(error, '自动同步房间配置失败'));
      } finally {
        if (inFlightKeyRef.current === key) inFlightKeyRef.current = null;
      }
    })();
  }, [controller, hostWorkspace, installAuthority]);

  const publishLocal = useCallback(async (): Promise<void> => {
    if (actionLockRef.current) return;
    const authority = currentAuthority(controller);
    if (!authority) return;
    const expectedControlSeq = controller.getSnapshot().session?.snapshot.controlSeq;
    if (expectedControlSeq === undefined) return;
    const operationGeneration = ++operationGenerationRef.current;
    actionLockRef.current = true;
    setState({ kind: 'synchronizing', action: 'publish' });
    try {
      const bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
        useBattleStore.getState(),
      );
      await controller.publishConfig({
        expectedRoomEpoch: authority.roomEpoch,
        expectedRevision: authority.revision,
        expectedControlSeq,
        sharedConfig: bundle.sharedConfig,
      });
      const published = currentAuthority(controller);
      const controllerSnapshot = controller.getSnapshot();
      if (
        !published
        || operationGenerationRef.current !== operationGeneration
        || authorityIdentity(published) !== authorityIdentity(authority)
        || controllerSnapshot.configPublishResultUnknown
        || !areArenaRoomSharedConfigsEqual(published.sharedConfig, bundle.sharedConfig)
      ) {
        throw new Error('房间尚未确认配置更新结果，请重新连接并核对');
      }
      hostWorkspace.capturePublished(published, bundle);
      setState({
        kind: 'synced',
        revision: published.revision,
        message: '房间配置已更新',
      });
    } catch (error) {
      if (operationGenerationRef.current !== operationGeneration) return;
      setState(reconciliationErrorState(error, '更新房间配置失败'));
    } finally {
      actionLockRef.current = false;
      // 手动发布期间权威可能又前进（例如提案被接受）；补一次自动对账，
      // 若当前权威已落定则此调用是空操作。
      runAutoReconcile();
    }
  }, [controller, hostWorkspace, runAutoReconcile]);

  const syncRoom = useCallback(async (): Promise<void> => {
    if (actionLockRef.current) return;
    const authority = currentAuthority(controller);
    if (!authority) return;
    const operationGeneration = ++operationGenerationRef.current;
    actionLockRef.current = true;
    try {
      await installAuthority(authority, 'sync-room', operationGeneration);
    } catch (error) {
      if (operationGenerationRef.current !== operationGeneration) return;
      setState(reconciliationErrorState(error, '同步房间配置失败'));
    } finally {
      actionLockRef.current = false;
      // 同步过程中权威前进时旧任务会被 fence 拒绝；这里对最新权威补一次对账。
      runAutoReconcile();
    }
  }, [controller, installAuthority, runAutoReconcile]);

  useEffect(() => () => {
    operationGenerationRef.current += 1;
  }, []);

  // 只依赖 authority 身份 + revision：proposal.resolved / member 变动等
  // 同 revision 的 session 更新不得取消正在进行的配置物化。
  const authorityKey = useMemo(() => {
    const session = controllerState.session;
    if (!session || session.self.role !== 'host') return null;
    return `${session.roomId}\n${session.roomEpoch}\n${session.self.userId}\n${session.snapshot.revision}`;
  }, [controllerState.session]);

  useEffect(() => {
    runAutoReconcile();
  }, [authorityKey, runAutoReconcile]);

  return {
    state,
    publishLocal,
    syncRoom,
    dismiss() {
      setState({ kind: 'idle' });
    },
  };
};
