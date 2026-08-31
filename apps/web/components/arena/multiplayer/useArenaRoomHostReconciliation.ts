'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';
import {
  applyArenaRoomAuthorityToBattleStore,
} from '@/lib/arena-room/host-reconciliation';
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
      message: string;
    }>;

export type ArenaRoomHostReconciliation = Readonly<{
  state: ArenaRoomHostReconciliationState;
  publishLocal(): Promise<void>;
  syncRoom(): Promise<void>;
  dismiss(): void;
}>;

const authorityIdentity = (authority: ArenaRoomHostWorkspaceAuthority): string => (
  `${authority.roomId}\n${authority.roomEpoch}\n${authority.ownerUserId}`
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
  const processingKeyRef = useRef<string | null>(null);
  const actionLockRef = useRef(false);

  const installAuthority = useCallback(async (
    authority: ArenaRoomHostWorkspaceAuthority,
    action: 'auto' | 'sync-room',
  ): Promise<void> => {
    setState({ kind: 'synchronizing', action });
    const currentBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      useBattleStore.getState(),
    );
    const roomStart = hostWorkspace.startFromRoom(authority);
    await applyArenaRoomAuthorityToBattleStore(authority.sharedConfig, {
      currentBundle,
      loadPublicCard,
      hostLocalPayloads: roomStart?.hostLocalPayloads,
    });
    const synchronizedBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      useBattleStore.getState(),
    );
    if (!areArenaRoomSharedConfigsEqual(
      synchronizedBundle.sharedConfig,
      authority.sharedConfig,
    )) {
      throw new Error('房间 authority materialize 后仍不一致');
    }
    hostWorkspace.capturePublished(authority, synchronizedBundle);
    observedAuthorityRef.current = authority;
    setState({
      kind: 'synced',
      revision: authority.revision,
      message: action === 'auto'
        ? '房间配置已更新，并同步到 Arena 编辑区'
        : '已放弃本地冲突修改并同步当前房间配置',
    });
  }, [hostWorkspace]);

  const publishLocal = useCallback(async (): Promise<void> => {
    if (actionLockRef.current) return;
    const authority = currentAuthority(controller);
    if (!authority) return;
    actionLockRef.current = true;
    setState({ kind: 'synchronizing', action: 'publish' });
    try {
      const bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
        useBattleStore.getState(),
      );
      await controller.publishConfig({
        expectedRoomEpoch: authority.roomEpoch,
        expectedRevision: authority.revision,
        sharedConfig: bundle.sharedConfig,
      });
      const published = currentAuthority(controller);
      const controllerSnapshot = controller.getSnapshot();
      if (
        !published
        || controllerSnapshot.configPublishResultUnknown
        || !areArenaRoomSharedConfigsEqual(published.sharedConfig, bundle.sharedConfig)
      ) {
        throw new Error('配置发布结果尚未由房间 authority 确认');
      }
      hostWorkspace.capturePublished(published, bundle);
      observedAuthorityRef.current = published;
      setState({
        kind: 'synced',
        revision: published.revision,
        message: '房间配置已更新',
      });
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : '更新房间配置失败',
      });
    } finally {
      actionLockRef.current = false;
    }
  }, [controller, hostWorkspace]);

  const syncRoom = useCallback(async (): Promise<void> => {
    if (actionLockRef.current) return;
    const authority = currentAuthority(controller);
    if (!authority) return;
    actionLockRef.current = true;
    try {
      await installAuthority(authority, 'sync-room');
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : '同步房间配置失败',
      });
    } finally {
      actionLockRef.current = false;
    }
  }, [controller, installAuthority]);

  useEffect(() => {
    const authority = arenaRoomHostWorkspaceAuthorityFromSession(controllerState.session);
    if (!authority) {
      observedAuthorityRef.current = null;
      processingKeyRef.current = null;
      setState({ kind: 'idle' });
      return;
    }
    const previous = observedAuthorityRef.current;
    if (!previous || authorityIdentity(previous) !== authorityIdentity(authority)) {
      observedAuthorityRef.current = authority;
      processingKeyRef.current = null;
      setState({ kind: 'idle' });
      return;
    }
    if (authority.revision <= previous.revision || actionLockRef.current) return;
    const processingKey = `${authorityIdentity(authority)}\n${authority.revision}`;
    if (processingKeyRef.current === processingKey) return;
    processingKeyRef.current = processingKey;
    observedAuthorityRef.current = authority;

    let cancelled = false;
    void (async () => {
      try {
        const bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
          useBattleStore.getState(),
        );
        const comparison = hostWorkspace.compare(previous, bundle);
        if (cancelled) return;
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
        await installAuthority(authority, 'auto');
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : '房间配置 reconciliation 失败',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    controllerState.session,
    hostWorkspace,
    installAuthority,
  ]);

  return {
    state,
    publishLocal,
    syncRoom,
    dismiss() {
      setState({ kind: 'idle' });
    },
  };
};
