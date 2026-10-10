/** Existing authoritative runtime algorithm, parameterized by the host random source. No IO or authority is granted here. */
type AdjudicationEvent = {
  type?: unknown;
  description?: unknown;
  probability?: unknown;
  outcomes?: unknown;
  onSuccess?: unknown;
  onFailure?: unknown;
};

export const resolveAdjudicationEvents = (
  value: unknown,
  random: () => number,
  depth = 0,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(value) || depth > 20) return [];
  const results: Array<Record<string, unknown>> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const event = raw as AdjudicationEvent;
    const roll = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 100) + 1;
    let outcome = '未知';
    let details = '';
    let next: unknown = null;
    if (event.type === 'binary' && typeof event.probability === 'number') {
      const success = roll <= event.probability;
      outcome = success ? '成功' : '失败';
      details = `掷骰(${roll}) vs 成功率(${event.probability}%)`;
      const branch = success ? event.onSuccess : event.onFailure;
      if (branch && typeof branch === 'object') next = (branch as { event?: unknown }).event;
    } else if (event.type === 'custom' && Array.isArray(event.outcomes)) {
      const candidates = event.outcomes.filter((item) => item && typeof item === 'object') as Array<{
        name?: unknown;
        probability?: unknown;
        chainedEvent?: { event?: unknown };
      }>;
      const total = candidates.reduce(
        (sum, item) => sum + (typeof item.probability === 'number' ? item.probability : 0),
        0,
      );
      let cumulative = 0;
      for (const candidate of candidates) {
        const probability = typeof candidate.probability === 'number' ? candidate.probability : 0;
        cumulative += probability * (100 / (total || 100));
        if (roll <= cumulative) {
          outcome = typeof candidate.name === 'string' ? candidate.name : '未知';
          details = `掷骰(${roll}) 命中概率区间`;
          next = candidate.chainedEvent?.event ?? null;
          break;
        }
      }
    }
    results.push({
      depth,
      description: typeof event.description === 'string' ? event.description : '',
      type: typeof event.type === 'string' ? event.type : 'unknown',
      roll,
      outcome,
      details,
    });
    if (next) results.push(...resolveAdjudicationEvents([next], random, depth + 1));
  }
  return results;
};

