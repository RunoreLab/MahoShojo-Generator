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
  ArenaRoomReconciliationAbortError,
  ArenaRoomReconciliationTransientError,
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

const DEFAULT_RECONCILE_RETRY_DELAY_MS = 400;

const loadPublicCard = async (id: string): Promise<unknown> => {
  const result = await fetchPublicDataCardRowById(id);
  if (result.kind === 'success') return result.card;
  throw result.kind === 'not-found'
    ? new Error(`公开数据卡 ${id} 已不存在`)
    : new ArenaRoomReconciliationTransientError(`公开数据卡 ${id} 暂时无法读取`);
};

/**
 * 语义 fence：host workspace bundle 只由这些 store 字段派生（见
 * buildArenaRoomHostWorkspaceBundle 的数据来源）。这些字段的引用不变即派生结果不变；
 * 不影响共享配置的 store 更新（流式文本、生成镜像、调试态等）不应中止正在进行的物化。
 * 之前用整个 useBattleStore state 对象做引用比较，任何无关更新都会让「需要异步拉取
 * 在线数据卡」的物化（例如成员随机匹配的公开角色）失败并停在半同步状态。
 */
const BUNDLE_SOURCE_FIELD_KEYS = [
  'battleMode',
  'combatants',
  'teams',
  'scenario',
  'auxScenarios',
  'materials',
  'storyLength',
  'customStoryLength',
  'selectedLanguage',
  'settings',
] as const;

const captureBundleSourceRefs = (
  state: ReturnType<typeof useBattleStore.getState>,
): readonly unknown[] => BUNDLE_SOURCE_FIELD_KEYS.map((key) => state[key]);

const sameBundleSourceRefs = (
  left: readonly unknown[],
  right: readonly unknown[],
): boolean => left.length === right.length
  && left.every((value, index) => value === right[index]);

const isRetryableReconciliationError = (error: unknown): boolean => (
  error instanceof ArenaRoomReconciliationAbortError
  || error instanceof ArenaRoomReconciliationTransientError
);

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
  retryDelayMs,
}: {
  readonly controller: ArenaRoomController;
  readonly controllerState: ArenaRoomControllerState;
  readonly hostWorkspace: ArenaRoomHostWorkspace;
  /** 自动同步重试间隔；测试可传 0。 */
  readonly retryDelayMs?: number;
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
    const sourceRefsAtStart = captureBundleSourceRefs(battleStateAtStart);
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
        && sameBundleSourceRefs(sourceRefsAtStart, captureBundleSourceRefs(useBattleStore.getState()))
        && isSameAuthorityRevision(currentAuthority(controller), authority)
      ),
    });
    if (
      operationGenerationRef.current !== operationGeneration
      || !isSameAuthorityRevision(currentAuthority(controller), authority)
    ) return;
    const synchronizedState = useBattleStore.getState();
    const synchronizedRefs = captureBundleSourceRefs(synchronizedState);
    const synchronizedBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      synchronizedState,
    );
    if (
      operationGenerationRef.current !== operationGeneration
      || !sameBundleSourceRefs(synchronizedRefs, captureBundleSourceRefs(useBattleStore.getState()))
      || !isSameAuthorityRevision(currentAuthority(controller), authority)
    ) {
      throw new ArenaRoomReconciliationAbortError('房间配置同步期间状态已变化，未覆盖新的本地修改');
    }
    if (!areArenaRoomSharedConfigsEqual(
      synchronizedBundle.sharedConfig,
      authority.sharedConfig,
    )) {
      // 写入后本地仍与权威不一致：交给重试重新判定 dirty/clean，
      // 真实本地修改会以 conflicted 呈现给房主，而不是永久卡在半同步。
      throw new ArenaRoomReconciliationAbortError('同步后的本地配置仍与当前房间配置不一致');
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
    // observed 只表示「看见过」；是否仍需同步以「已成功落定的基线」为准。
    // 若以 observed 判定，自动同步失败的当前 revision 会被视为已处理，
    // 瞬时错误后将永远无法对同一 revision 重试。
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
        // 同一 revision 的自动同步最多尝试 3 次：fence 中止或在线数据卡暂时读取失败时
        // 自动重试，避免「服务器已接受、房主工作区仍旧」的半同步状态；重试会重新判定
        // dirty/clean，真实本地修改会收敛为 conflicted，权威确实失效时保持 error。
        const maxAttempts = 3;
        for (let attempt = 1; ; attempt += 1) {
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
            return;
          } catch (error) {
            if (
              operationGenerationRef.current !== operationGeneration
              || !isSameAuthorityRevision(currentAuthority(controller), authority)
            ) return;
            if (attempt >= maxAttempts || !isRetryableReconciliationError(error)) {
              setState(reconciliationErrorState(error, '自动同步房间配置失败'));
              return;
            }
            await new Promise<void>((resolve) => {
              setTimeout(resolve, retryDelayMs !== undefined
                ? retryDelayMs
                : DEFAULT_RECONCILE_RETRY_DELAY_MS * attempt);
            });
            if (
              operationGenerationRef.current !== operationGeneration
              || !isSameAuthorityRevision(currentAuthority(controller), authority)
            ) return;
          }
        }
      } finally {
        if (inFlightKeyRef.current === key) inFlightKeyRef.current = null;
      }
    })();
  }, [controller, hostWorkspace, installAuthority, retryDelayMs]);

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
