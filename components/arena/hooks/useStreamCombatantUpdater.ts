// components/arena/hooks/useStreamCombatantUpdater.ts

import { useState, useCallback } from 'react';
import { getLogger } from '@/lib/logger';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, CombatantData } from '../types';

const log = getLogger('stream-combatant-updater');

interface UpdateCombatantsPayload {
  combatants: any[];
  report: {
    headline: string;
    mode: string;
    officialReport: {
      winner: string;
    };
  };
  impacts?: Array<{
    characterName: string;
    impact?: string;
    currentStateSummary?: string;
  }>;
  userGuidance?: string | null;
  scenario?: any | null;
  writeArenaHistory?: boolean;
  writeCurrentState?: boolean;
}

/**
 * 从流式生成的 Markdown 中提取战报信息
 *
 * 注意：这是一个简化的解析器，生产环境建议在服务端解析
 */
const parseMarkdownReport = (markdown: string, mode: string): { headline: string; winner: string } | null => {
  try {
    // 提取第一个一级标题作为 headline
    const headlineMatch = markdown.match(/^#\s+(.+)$/m);
    const headline = headlineMatch ? headlineMatch[1].trim() : '魔法少女速报';

    // 提取胜利者信息（根据不同模式有不同的关键词）
    let winner = '未知';

    if (mode === 'daily') {
      // 日常模式：查找 "参与者" 或类似字段
      const participantMatch = markdown.match(/参与(?:者|角色)[：:]\s*(.+)/);
      if (participantMatch) {
        winner = participantMatch[1].trim();
      }
    } else {
      // 竞技模式：查找 "胜利者" 或 "获胜者"
      const winnerMatch = markdown.match(/(?:胜利者|获胜者|优胜者)[：:]\s*(.+)/);
      if (winnerMatch) {
        winner = winnerMatch[1].trim();
      }
    }

    return { headline, winner };
  } catch (error) {
    log.error('解析 Markdown 失败', { error });
    return null;
  }
};

/**
 * Hook：流式生成后安全更新角色数据
 */
export const useStreamCombatantUpdater = () => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const setCombatants = useBattleStore((state: BattleStoreState) => state.setCombatants);

  /**
   * 安全地更新角色数据
   *
   * 流程：
   * 1. 调用服务端 API，在服务端验证原生性并重新签名
   * 2. 接收签名后的数据
   * 3. 更新本地状态
   */
  const updateCombatants = useCallback(async (payload: UpdateCombatantsPayload) => {
    setIsUpdating(true);
    setUpdateError(null);

    try {
      const response = await fetch('/api/arena/update-combatants-after-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '更新角色数据失败');
      }

      const result = await response.json();

      if (result.updatedCombatants && result.updatedCombatants.length > 0) {
        // 合并更新后的数据到当前角色列表
        const currentCombatants = useBattleStore.getState().combatants;
        const updatedRoster = currentCombatants.map((combatant) => {
          if (!('data' in combatant)) return combatant;

          const updated = result.updatedCombatants.find(
            (item: any) =>
              (item.codename || item.name) === (combatant.data.codename || combatant.data.name)
          );

          return updated ? { ...combatant, data: updated } : combatant;
        });

        setCombatants(updatedRoster);
        log.info('成功更新角色数据', { count: result.updatedCombatants.length });
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
  }, [setCombatants]);

  /**
   * 从 Markdown 内容更新角色（简化版）
   *
   * 注意：这个方法解析 Markdown 提取信息，然后调用安全更新
   */
  const updateFromMarkdown = useCallback(
    async (
      markdown: string,
      combatants: CombatantData[],
      mode: string,
      settings: {
        userGuidance: string;
        writeArenaHistory: boolean;
        writeCurrentState: boolean;
      },
      scenario?: any
    ) => {
      const parsed = parseMarkdownReport(markdown, mode);
      if (!parsed) {
        throw new Error('无法解析 Markdown 内容');
      }

      const payload: UpdateCombatantsPayload = {
        combatants: combatants.map((c) => ({
          type: c.type,
          data: c.data,
          isNative: c.isValid, // 使用 isValid 作为原生性标记
          isPreset: c.isPreset,
        })),
        report: {
          headline: parsed.headline,
          mode: mode,
          officialReport: {
            winner: parsed.winner,
          },
        },
        userGuidance: settings.userGuidance || null,
        scenario: scenario || null,
        writeArenaHistory: settings.writeArenaHistory,
        writeCurrentState: settings.writeCurrentState,
      };

      return await updateCombatants(payload);
    },
    [updateCombatants]
  );

  return {
    updateCombatants,
    updateFromMarkdown,
    isUpdating,
    updateError,
  };
};
