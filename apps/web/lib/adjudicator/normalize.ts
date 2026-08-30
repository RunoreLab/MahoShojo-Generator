import type { AdjudicatorEvent } from '@/types/arena';

type IdFactory = (prefix: 'event' | 'outcome') => string;

export const createAdjudicatorId: IdFactory = (prefix) => {
  const cryptoObj = (globalThis as any)?.crypto as undefined | { randomUUID?: () => string };
  const uuid = typeof cryptoObj?.randomUUID === 'function' ? cryptoObj.randomUUID() : null;
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeStringId = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeOutcomeList = (
  input: unknown,
  createId: IdFactory
): { outcomes: AdjudicatorEvent['outcomes']; changed: boolean } => {
  if (!Array.isArray(input) || input.length === 0) {
    return { outcomes: input as any, changed: false };
  }

  const seen = new Set<string>();
  let changed = false;
  const outcomes = input.map((raw) => {
    const outcome = (raw ?? {}) as any;
    let next = outcome;

    const originalId = outcome.id;
    let id = normalizeStringId(originalId);
    if (!id || seen.has(id)) {
      id = createId('outcome');
      changed = true;
    }
    seen.add(id);
    if (id !== originalId) {
      next = { ...next, id };
      changed = true;
    }

    const chained = outcome.chainedEvent;
    if (chained && typeof chained === 'object' && 'event' in chained) {
      const normalized = normalizeAdjudicatorEvent((chained as any).event, createId);
      if (normalized !== (chained as any).event) {
        next = { ...next, chainedEvent: { event: normalized } };
        changed = true;
      }
    }

    return next;
  });

  return { outcomes: changed ? (outcomes as any) : (input as any), changed };
};

const normalizeAdjudicatorEvent = (input: unknown, createId: IdFactory): AdjudicatorEvent => {
  const event = (input ?? {}) as any;
  let next = event;
  let changed = false;

  const originalId = event.id;
  let id = normalizeStringId(originalId);
  if (!id) {
    id = createId('event');
    changed = true;
  }
  if (id !== originalId) {
    next = { ...next, id };
    changed = true;
  }

  const onSuccess = event.onSuccess;
  if (onSuccess && typeof onSuccess === 'object' && 'event' in onSuccess) {
    const normalized = normalizeAdjudicatorEvent((onSuccess as any).event, createId);
    if (normalized !== (onSuccess as any).event) {
      next = { ...next, onSuccess: { event: normalized } };
      changed = true;
    }
  }

  const onFailure = event.onFailure;
  if (onFailure && typeof onFailure === 'object' && 'event' in onFailure) {
    const normalized = normalizeAdjudicatorEvent((onFailure as any).event, createId);
    if (normalized !== (onFailure as any).event) {
      next = { ...next, onFailure: { event: normalized } };
      changed = true;
    }
  }

  const { outcomes, changed: outcomesChanged } = normalizeOutcomeList(event.outcomes, createId);
  if (outcomesChanged) {
    next = { ...next, outcomes };
    changed = true;
  }

  return (changed ? next : event) as AdjudicatorEvent;
};

/**
 * 规范化“随机判定器事件链”的 id：
 * - 事件 id：缺失则补齐；同一层级重复则重写后者，避免 React key 冲突。
 * - 结果 id：同上（并递归修复 chainedEvent / onSuccess / onFailure）。
 *
 * 若输入本身已经满足约束，则返回原引用，避免无意义的重渲染。
 */
export const normalizeAdjudicationEvents = (
  events: AdjudicatorEvent[],
  options?: { createId?: IdFactory }
): AdjudicatorEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return events;
  const createId = options?.createId ?? createAdjudicatorId;

  const seen = new Set<string>();
  let changed = false;
  const next = events.map((evt) => {
    const originalId = (evt as any)?.id;
    let id = normalizeStringId(originalId);
    const needsRewrite = !id || seen.has(id);
    if (needsRewrite) {
      id = createId('event');
      changed = true;
    }
    seen.add(id);

    let normalized = normalizeAdjudicatorEvent(evt, createId);
    if ((normalized as any).id !== id) {
      normalized = { ...(normalized as any), id };
      changed = true;
    }

    if (normalized !== evt) changed = true;
    return normalized;
  });

  return changed ? next : events;
};

