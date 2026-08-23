import { JsonValueSchema } from '../src/json-value';

describe('JsonValueSchema', () => {
  it('rejects sparse arrays and non-plain JSON object forms', () => {
    const sparse = new Array(3);
    sparse[0] = 1;
    sparse[2] = 2;
    expect(() => JsonValueSchema.parse(sparse)).toThrow();

    const withSymbol = {};
    Object.defineProperty(withSymbol, 'secret', {
      value: 'x',
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const symbolKey = Symbol('k');
    Object.defineProperty(withSymbol, symbolKey, {
      value: 'x',
      enumerable: true,
    });
    expect(JsonValueSchema.safeParse(withSymbol).success).toBe(false);
    const arrayWithSymbol = [1];
    Object.defineProperty(arrayWithSymbol, Symbol('secret'), {
      value: 'x',
      enumerable: true,
    });
    expect(JsonValueSchema.safeParse(arrayWithSymbol).success).toBe(false);
    const accessor = {
      get secret() {
        return 'x';
      },
    };
    expect(JsonValueSchema.safeParse(accessor).success).toBe(false);
    const nonEnumerable = {};
    Object.defineProperty(nonEnumerable, 'x', {
      value: 1,
      enumerable: false,
    });
    expect(JsonValueSchema.safeParse(nonEnumerable).success).toBe(false);
    expect(JsonValueSchema.safeParse(new Date()).success).toBe(false);
  });

  it('rejects cyclic structures without throwing RangeError', () => {
    const a: Record<string, unknown> = { child: null };
    a.child = a;
    expect(JsonValueSchema.safeParse(a).success).toBe(false);
    expect(() => JsonValueSchema.safeParse(a)).not.toThrow();

    const shared = { value: 1 };
    const root = { a: shared, b: shared };
    expect(JsonValueSchema.parse(root)).toMatchObject({ a: { value: 1 }, b: { value: 1 } });
  });

  it('survives deep traversal without stack overflow', () => {
    const nested: Record<string, unknown> = {};
    let cursor = nested;
    for (let i = 0; i < 20000; i += 1) {
      cursor.next = { index: i };
      cursor = cursor.next as Record<string, unknown>;
    }
    expect(() => JsonValueSchema.parse(nested)).not.toThrow();
  });
});
