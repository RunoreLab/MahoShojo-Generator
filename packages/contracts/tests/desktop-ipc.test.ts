import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESKTOP_SECRET_REF_PATTERN,
  DesktopSecretRefSchema,
  DesktopSecretStoreErrorSchema,
  MAX_DESKTOP_SECRET_REF_LENGTH,
  MAX_DESKTOP_SECRET_VALUE_BYTES,
  isDesktopSecretRef,
} from '../src/desktop-ipc';

interface SecretRefFixture {
  validRefs: string[];
  invalidRefs: string[];
  maxRefLength: number;
  maxValueBytes: number;
}

/**
 * 这份 fixture 同时被 Rust 侧在编译期 `include_str!` 读取，是 DESK-033 的最小实例：
 * 两侧对同一条 secret 引用必须给出相同的接受/拒绝结论。
 */
const fixture: SecretRefFixture = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', 'fixtures', 'desktop-secret-refs.json'),
    'utf8',
  ),
) as SecretRefFixture;

describe('DesktopSecretRef', () => {
  it('mirrors the shared fixture limits', () => {
    expect(fixture.maxRefLength).toBe(MAX_DESKTOP_SECRET_REF_LENGTH);
    expect(fixture.maxValueBytes).toBe(MAX_DESKTOP_SECRET_VALUE_BYTES);
  });

  it('accepts every reference the fixture marks valid', () => {
    expect(fixture.validRefs.length).toBeGreaterThan(0);
    for (const ref of fixture.validRefs) {
      expect(isDesktopSecretRef(ref), `${JSON.stringify(ref)} must be accepted`).toBe(true);
      expect(DesktopSecretRefSchema.safeParse(ref).success).toBe(true);
    }
  });

  it('rejects every reference the fixture marks invalid', () => {
    expect(fixture.invalidRefs.length).toBeGreaterThan(0);
    for (const ref of fixture.invalidRefs) {
      expect(isDesktopSecretRef(ref), `${JSON.stringify(ref)} must be rejected`).toBe(false);
      expect(DesktopSecretRefSchema.safeParse(ref).success).toBe(false);
    }
  });

  it('keeps the length ceiling authoritative for both valid and invalid inputs', () => {
    const atLimit = 'a'.repeat(MAX_DESKTOP_SECRET_REF_LENGTH);
    const overLimit = 'a'.repeat(MAX_DESKTOP_SECRET_REF_LENGTH + 1);

    expect(DesktopSecretRefSchema.safeParse(atLimit).success).toBe(true);
    expect(DesktopSecretRefSchema.safeParse(overLimit).success).toBe(false);
    expect(isDesktopSecretRef(overLimit)).toBe(false);
  });

  it('never admits whitespace, path separators, control characters or non-ASCII', () => {
    // 引用会直接成为操作系统凭据存储的目标名，因此字符集必须是最小可辩护的子集。
    expect(DESKTOP_SECRET_REF_PATTERN.test(' ')).toBe(false);
    expect(DESKTOP_SECRET_REF_PATTERN.test('/')).toBe(false);
    expect(DESKTOP_SECRET_REF_PATTERN.test('\\')).toBe(false);
    expect(DESKTOP_SECRET_REF_PATTERN.test('\n')).toBe(false);
    expect(DESKTOP_SECRET_REF_PATTERN.test('é')).toBe(false);
  });
});

describe('DesktopSecretStoreError', () => {
  it('projects a stable, non-secret error shape', () => {
    const parsed = DesktopSecretStoreErrorSchema.parse({
      code: 'secret-store-unavailable',
      message: 'operating system credential store is unavailable',
    });
    expect(parsed.code).toBe('secret-store-unavailable');

    expect(
      DesktopSecretStoreErrorSchema.safeParse({ code: 'unknown-code', message: 'x' }).success,
    ).toBe(false);
    expect(
      DesktopSecretStoreErrorSchema.safeParse({ code: 'secret-store-failure', message: 'x', extra: 1 })
        .success,
    ).toBe(false);
  });
});
