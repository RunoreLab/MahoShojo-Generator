import 'vitest';

declare module 'vitest' {
  interface Assertion<T = unknown> {
    toBeNumber(): T;
    toBeString(): T;
  }

  interface AsymmetricMatchersContaining {
    toBeNumber(): unknown;
    toBeString(): unknown;
  }
}
