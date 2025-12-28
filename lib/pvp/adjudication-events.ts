import type { AdjudicatorEvent } from '@/types/arena';

export const isLegacyAdjudicatorFormat = (events: unknown): boolean => {
  if (!Array.isArray(events) || events.length === 0) return false;
  const firstEvent = events[0] as any;
  return (
    typeof firstEvent === 'object' &&
    firstEvent !== null &&
    typeof firstEvent.event === 'string' &&
    typeof firstEvent.probability === 'number' &&
    typeof firstEvent.type === 'undefined'
  );
};

const normalizeEventId = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const mergeAdjudicationEvents = (current: unknown, incoming: unknown): AdjudicatorEvent[] => {
  const base = Array.isArray(current) ? (current as AdjudicatorEvent[]) : [];
  const next = Array.isArray(incoming) ? (incoming as AdjudicatorEvent[]) : [];
  if (next.length === 0) return base;
  if (isLegacyAdjudicatorFormat(next)) return base;

  const seen = new Set<string>();
  const merged: AdjudicatorEvent[] = [];
  for (const evt of base) {
    const id = normalizeEventId((evt as any)?.id);
    if (id) seen.add(id);
    merged.push(evt);
  }
  for (const evt of next) {
    const id = normalizeEventId((evt as any)?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(evt);
  }
  return merged;
};

export const extractScenarioAdjudicationEvents = (scenarioPayload: unknown): AdjudicatorEvent[] => {
  if (!scenarioPayload || typeof scenarioPayload !== 'object') return [];
  const raw = (scenarioPayload as any).adjudicationEvents;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (isLegacyAdjudicatorFormat(raw)) return [];
  return raw as AdjudicatorEvent[];
};

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
  return extractScenarioAdjudicationEvents(input.scenarioPayload);
};
