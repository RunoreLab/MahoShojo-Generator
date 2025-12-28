import type { AdjudicatorEvent } from '@/types/arena';

/**
 * PVP 专用：解析本轮应使用的“随机判定器事件”列表。
 *
 * 设计目标：
 * - 优先使用房间规则中显式配置的 adjudicationEvents（可编辑、可覆盖）。
 * - 当房间未配置时，自动回退到情景数据卡（scenarioPayload）中的 adjudicationEvents。
 *
 * 说明：
 * - 这里只做“选择/回退”，不做去重或复杂合并，避免与竞技场页面（会主动把情景事件写入 adjudicationEvents）产生重复判定。
 */
export const resolvePvpAdjudicationEvents = (input: {
  roomEvents: unknown;
  scenarioPayload: unknown;
}): AdjudicatorEvent[] => {
  const roomEvents = Array.isArray(input.roomEvents) ? (input.roomEvents as AdjudicatorEvent[]) : [];
  if (roomEvents.length > 0) return roomEvents;

  const scenarioEvents =
    input.scenarioPayload && typeof input.scenarioPayload === 'object' && Array.isArray((input.scenarioPayload as any).adjudicationEvents)
      ? ((input.scenarioPayload as any).adjudicationEvents as AdjudicatorEvent[])
      : [];
  return scenarioEvents;
};

