const randomUint32 = (): number => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
};

export const randomIntInclusive = (min: number, max: number): number => {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
    throw new Error('无效的随机范围');
  }

  const range = hi - lo + 1;
  if (range <= 1) return lo;

  const maxUnbiased = Math.floor(0xffffffff / range) * range - 1;
  while (true) {
    const r = randomUint32();
    if (r <= maxUnbiased) return lo + (r % range);
  }
};

export const shuffleInPlace = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomIntInclusive(0, i);
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
  return arr;
};

