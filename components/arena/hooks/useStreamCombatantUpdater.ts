// components/arena/hooks/useStreamCombatantUpdater.ts

import { useState, useCallback } from 'react';
import { getLogger } from '@/lib/logger';
import { extractHeadlineFromMarkdown, extractWinnerFromText } from '@/lib/arena/battle-report-log-utils';
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

const normalizeRosterNames = (combatants: CombatantData[]): string[] => {
  const names = combatants
    .map((c) => (c?.data?.codename || c?.data?.name || '').toString().trim())
    .filter(Boolean);
  return Array.from(new Set(names));
};

const normalizeNameToken = (name: string): string => {
  return name
    .trim()
    .replace(/^[“”"'「」『』《》【】\[\]（）()]+|[“”"'「」『』《》【】\[\]（）()]+$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
};

const matchRosterName = (candidate: string, rosterNames: string[]): string | null => {
  const c = normalizeNameToken(candidate);
  if (!c) return null;

  const exact = rosterNames.find((n) => normalizeNameToken(n) === c);
  if (exact) return exact;

  const includes = rosterNames.find((n) => normalizeNameToken(n).includes(c) || c.includes(normalizeNameToken(n)));
  return includes ?? null;
};

const normalizeImpactsForRoster = (
  impacts: UpdateCombatantsPayload['impacts'] | undefined,
  combatants: CombatantData[],
  settings: { writeArenaHistory: boolean; writeCurrentState: boolean }
): UpdateCombatantsPayload['impacts'] | undefined => {
  if (!Array.isArray(impacts) || impacts.length === 0) return undefined;

  const rosterNames = normalizeRosterNames(combatants);
  if (rosterNames.length === 0) return undefined;

  const byName = new Map<string, { characterName: string; impact?: string; currentStateSummary?: string }>();
  for (const raw of impacts) {
    const rawName = typeof raw?.characterName === 'string' ? raw.characterName.trim() : '';
    const matched = rawName ? matchRosterName(rawName, rosterNames) : null;
    if (!matched || byName.has(matched)) continue;

    const impact = typeof raw?.impact === 'string' ? raw.impact.trim() : undefined;
    const currentStateSummary =
      typeof raw?.currentStateSummary === 'string' ? raw.currentStateSummary.trim() : undefined;

    // 不在前端伪造内容：缺失字段就留空，交给服务端默认值/跳过写入策略处理。
    byName.set(matched, {
      characterName: matched,
      ...(settings.writeArenaHistory && impact ? { impact } : {}),
      ...(settings.writeCurrentState && currentStateSummary ? { currentStateSummary } : {}),
    });
  }

  const normalized = Array.from(byName.values());
  const missing = rosterNames.filter((n) => !byName.has(n));
  if (missing.length > 0) {
    log.warn('流式元数据 impacts 覆盖不完整，将仅对已匹配角色尝试更新', {
      missing,
      receivedCount: impacts.length,
      normalizedCount: normalized.length,
    });
  }

  return normalized.length > 0 ? normalized : undefined;
};

/**
 * 从流式生成的 Markdown 中提取战报信息
 *
 * 注意：这是一个简化的解析器，生产环境建议在服务端解析
 */
const parseMarkdownReport = (markdown: string, mode: string): { headline: string; winner: string } | null => {
  try {
    const normalized = markdown.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    // 提取第一个标题作为 headline（兼容 "#标题" / "# 标题" / "## 标题"）
    // 说明：流式输出偶尔会出现标题层级偏移（例如误输出为 ##），这里做容错以提升可用性。
    const headlineMatch = normalized.match(/^#{1,3}\s*(.+)$/m);
    const headline = headlineMatch?.[1]?.trim() || '魔法少女速报';

    const stripMarkdown = (text: string): string =>
      text
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^\s*[-*]\s+/, '')
        .trim();

    const extractSectionLines = (headingRegex: RegExp): string[] | null => {
      const startIndex = lines.findIndex((line) => headingRegex.test(line.trim()));
      if (startIndex === -1) return null;

      const sectionLines: string[] = [];
      for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^#{1,6}\s*/.test(line.trim())) {
          break;
        }
        sectionLines.push(line);
      }

      return sectionLines;
    };

    // 提取胜利者信息（根据不同模式有不同的关键词）
    let winner = '未知';

    const winnerSection = extractSectionLines(/^##\s*(?:胜利者|获胜者|优胜者)\s*$/);
    if (winnerSection) {
      const meaningful = winnerSection.map((line) => line.trim()).filter(Boolean);
      const bulletItems = meaningful
        .map((line) => {
          const match = line.match(/^\s*[-*]\s+(.+)$/);
          return match?.[1]?.trim() ?? null;
        })
        .filter((item): item is string => Boolean(item));

      if (bulletItems.length > 0) {
        winner = bulletItems.map(stripMarkdown).join('、');
      } else if (meaningful.length > 0) {
        winner = stripMarkdown(meaningful[0]);
      }
    } else {
      // 兼容旧版输出：使用 "胜利者: xxx" / "参与者: xxx" 的行内格式
      const inlineMatch =
        normalized.match(/(?:胜利者|获胜者|优胜者)[：:]\s*(.+)/) ??
        (mode === 'daily' ? normalized.match(/参与(?:者|角色)[：:]\s*(.+)/) : null);
      if (inlineMatch?.[1]) {
        winner = stripMarkdown(inlineMatch[1]);
      }
    }

    return { headline, winner };
  } catch (error) {
    log.error('解析 Markdown 失败', { error });
    return null;
  }
};

const getValidatedMarkdownReport = (
  markdown: string,
  mode: string
): { headline: string; winner: string } | null => {
  const trimmed = markdown.trim();
  if (!trimmed) return null;
  if (trimmed.length < 120) return null;
  if (!/^#{2,6}\s*/m.test(markdown)) return null;

  const parsed = parseMarkdownReport(markdown, mode);
  if (!parsed) return null;

  const headline = parsed.headline.trim();
  const winner = parsed.winner.trim();
  if (!headline || headline === '魔法少女速报') return null;
  if (!winner || winner === '未知') return null;

  return { headline, winner };
};

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
        setUpdatedCombatants(result.updatedCombatants);
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
      } else if (Array.isArray(result.updatedCombatants)) {
        setUpdatedCombatants([]);
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
      scenario?: any,
      metaOverride?: {
        report?: { headline?: string; winner?: string };
        impacts?: UpdateCombatantsPayload['impacts'];
      }
    ) => {
      const parsed = getValidatedMarkdownReport(markdown, mode);

      const fallbackHeadline =
        (typeof metaOverride?.report?.headline === 'string' ? metaOverride.report.headline.trim() : '') ||
        extractHeadlineFromMarkdown(markdown) ||
        '';
      const fallbackWinner =
        (typeof metaOverride?.report?.winner === 'string' ? metaOverride.report.winner.trim() : '') ||
        extractWinnerFromText(markdown) ||
        '';

      const headline = (parsed?.headline || fallbackHeadline).trim();
      const winner = (parsed?.winner || fallbackWinner).trim();

      const impactsOverride = normalizeImpactsForRoster(metaOverride?.impacts, combatants, settings);

      // 写入历战记录时，headline/winner 必须有效，否则服务端会拒绝写入。
      // 若只写当前状态，则允许使用兜底值继续尝试，避免“能更新但被校验拦住”。
      if (settings.writeArenaHistory) {
        if (!headline || headline === '魔法少女速报') {
          throw new Error('战报标题缺失或无效，已取消角色更新（请等待战报完整生成后重试）。');
        }
        if (!winner || winner === '未知') {
          throw new Error('胜利者信息缺失或无效，已取消角色更新（请等待战报完整生成后重试）。');
        }
      } else {
        // 仅写当前状态时，尽量不要因为标题/胜利者解析失败而直接放弃
        if (!headline) {
          // 不强制，留给服务端作为无关字段使用
        }
      }

      const payload: UpdateCombatantsPayload = {
        combatants: combatants.map((c) => ({
          type: c.type,
          data: c.data,
          isNative: c.isValid, // 使用 isValid 作为原生性标记
          isPreset: c.isPreset,
        })),
        report: {
          headline: headline || '魔法少女速报',
          mode: mode,
          officialReport: {
            winner: winner || '未知',
          },
        },
        ...(Array.isArray(impactsOverride) && impactsOverride.length > 0 ? { impacts: impactsOverride } : {}),
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
