import type { PvpMode, PvpScenarioSelection } from '@/lib/pvp/types';

/**
 * 构造用于 /api/pvp/rooms/:roomId/rules 的情景保存补丁。
 * 设计目标：当用户在“情景模式”面板保存/清空情景时，确保房间模式也一并落库为 scenario，
 * 避免出现“UI 看起来已切到情景，但实际对局仍按 classic 生成”的错觉。
 */
export const buildPvpScenarioRulesPatch = (input: { mode?: PvpMode | null; selection: PvpScenarioSelection | null }): Record<string, unknown> => {
  return {
    ...(input.mode === 'scenario' ? { mode: 'scenario' } : {}),
    _scenario: input.selection ?? null,
  };
};

