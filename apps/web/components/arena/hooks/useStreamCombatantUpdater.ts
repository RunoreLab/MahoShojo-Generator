// components/arena/hooks/useStreamCombatantUpdater.ts

import { useState, useCallback } from 'react';
import { getLogger } from '@/lib/logger';
import { withArenaGenerationActorToken } from '@/lib/arena/resumable-generation-client';
import { authStorage } from '@/lib/auth';
import { buildGenerationApiHeaders } from '@/lib/hono-api-client';
import {
  buildArenaReconciliationRetryPayload,
  projectArenaReconciliationCombatants,
  type ArenaReconciliationRetryCombatant,
} from '@/lib/arena/reconciliation-retry';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, CombatantData } from '../types';

const log = getLogger('stream-combatant-updater');

interface UpdateCombatantsPayload {
  generationId?: string;
  combatants: any[];
}

interface UpdateCombatantsOptions {
  canCommit?: () => boolean;
}

/**
 * Hook：流式生成后安全更新角色数据
 */
export const useStreamCombatantUpdater = () => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const setCombatants = useBattleStore((state: BattleStoreState) => state.setCombatants);
  const setUpdatedCombatants = useBattleStore((state: BattleStoreState) => state.setUpdatedCombatants);

  /**
   * 安全地更新角色数据
   *
   * 流程：
   * 1. 调用服务端 API，在服务端验证原生性并重新签名
   * 2. 接收签名后的数据
   * 3. 更新本地状态
   */
  const updateCombatants = useCallback(async (
    payload: UpdateCombatantsPayload,
    options: UpdateCombatantsOptions = {},
  ) => {
    setIsUpdating(true);
    setUpdateError(null);

    try {
      const submittedSnapshot = JSON.stringify(projectArenaReconciliationCombatants(
        payload.combatants as ArenaReconciliationRetryCombatant[],
      ));
      const execute = async () => {
        const response = await fetch('/api/arena/update-combatants-after-stream', {
          method: 'POST',
          headers: withArenaGenerationActorToken(await buildGenerationApiHeaders(
            authStorage,
            { 'Content-Type': 'application/json' },
          )),
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          const details = Array.isArray(errorData.errors)
            ? errorData.errors.flatMap((value: unknown) => {
              if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
              const message = (value as { message?: unknown }).message;
              return typeof message === 'string' && message.trim() ? [message.trim()] : [];
            })
            : [];
          throw new Error([
            errorData.error || '更新角色数据失败',
            ...details,
          ].join('；'));
        }
        const result = await response.json();
        return result;
      };
      const result = await execute();

      const currentCombatants = useBattleStore.getState().combatants;
      const currentSnapshot = JSON.stringify(projectArenaReconciliationCombatants(
        currentCombatants.filter((combatant): combatant is CombatantData => 'data' in combatant),
      ));
      if ((options.canCommit && !options.canCommit()) || currentSnapshot !== submittedSnapshot) {
        throw new Error('角色更新上下文已变化，已丢弃过期的服务器响应。');
      }

      if (result.updatedCombatants && result.updatedCombatants.length > 0) {
        const indexedUpdates = result.updatedCombatants.flatMap((value: unknown) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const entry = value as {
            combatantIndex?: unknown;
            data?: unknown;
            isNative?: unknown;
          };
          return typeof entry.combatantIndex === 'number'
            && Number.isSafeInteger(entry.combatantIndex)
            && entry.combatantIndex >= 0
            && entry.data
            && typeof entry.data === 'object'
            && !Array.isArray(entry.data)
            ? [{
              combatantIndex: entry.combatantIndex,
              data: entry.data,
              isNative: entry.isNative === true,
            }]
            : [];
        });
        setUpdatedCombatants(indexedUpdates.map((entry: { data: any }) => entry.data));
        const updateByIndex = new Map<number, { data: any; isNative: boolean }>(indexedUpdates.map((entry: {
          combatantIndex: number;
          data: any;
          isNative: boolean;
        }) => [entry.combatantIndex, entry] as const));
        const updatedRoster = currentCombatants.map((combatant, combatantIndex) => {
          if (!('data' in combatant)) return combatant;
          const updated = updateByIndex.get(combatantIndex);
          return updated
            ? { ...combatant, data: updated.data, isValid: updated.isNative }
            : combatant;
        });

        setCombatants(updatedRoster);
        log.info('成功更新角色数据', { count: result.updatedCombatants.length });
      } else if (Array.isArray(result.updatedCombatants)) {
        setUpdatedCombatants([]);
      }

      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        const warningMessage = result.warnings.flatMap((value: unknown) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const message = (value as { message?: unknown }).message;
          return typeof message === 'string' && message.trim() ? [message.trim()] : [];
        }).join('；');
        if (warningMessage) {
          log.warn('部分角色未能同步', { warningMessage });
          setUpdateError(`部分角色未能同步：${warningMessage}`);
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      log.error('更新角色数据失败', { error: errorMessage });
      setUpdateError(errorMessage);
      throw error;
    } finally {
      setIsUpdating(false);
    }
  }, [setCombatants, setUpdatedCombatants]);

  /** generationId 对应的 report / impacts / 写入策略全部以服务器冻结值为准。 */
  const updateFromMarkdown = useCallback(
    async (
      _markdown: string,
      combatants: CombatantData[],
      _mode: string,
      _settings: {
        userGuidance: string;
        writeArenaHistory: boolean;
        writeCurrentState: boolean;
      },
      _scenario?: any,
      _metaOverride?: {
        report?: { headline?: string; winner?: string };
        impacts?: Array<{
          characterName: string;
          impact?: string;
          currentStateSummary?: string;
        }>;
      },
      generationId?: string | null,
    ) => {
      if (!generationId) throw new Error('缺少服务器 generationId，无法同步角色状态。');
      return updateCombatants(
        await buildArenaReconciliationRetryPayload(generationId, combatants),
      );
    },
    [updateCombatants]
  );

  const retryGenerationUpdate = useCallback(
    async (
      generationId: string,
      combatants: CombatantData[],
      canCommit?: () => boolean,
    ) => (
      updateCombatants(
        await buildArenaReconciliationRetryPayload(generationId, combatants),
        { canCommit },
      )
    ),
    [updateCombatants]
  );

  return {
    updateCombatants,
    updateFromMarkdown,
    retryGenerationUpdate,
    isUpdating,
    updateError,
  };
};
