export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const deepClone = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as T;
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) result[key] = deepClone(value[key]);
    return result as T;
  }
  return value;
};

export const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    if (leftKeys.some((key) => !Object.prototype.hasOwnProperty.call(right, key))) return false;
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
};

export const isOnlineRef = (value: unknown): value is { id: string; kind: string; versionToken: string } => (
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.kind === 'string'
  && typeof value.versionToken === 'string'
);

export const canonicalDataCardKey = (id: string): string => `data-card:${id}`;

export const isCanonicalDataCardKey = (key: string, id: string): boolean => key === canonicalDataCardKey(id);

export const hasVersionDrift = (expected: unknown, current: unknown): boolean => (
  isOnlineRef(expected)
  && isOnlineRef(current)
  && expected.id === current.id
  && expected.kind === current.kind
  && expected.versionToken !== current.versionToken
);

export const arrayEqual = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
);
