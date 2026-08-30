import { describe, expect, it } from 'vitest';
import { D1IndeterminateOutcomeError as RootD1IndeterminateOutcomeError } from '@/lib/database/core';
import { D1IndeterminateOutcomeError as PackageD1IndeterminateOutcomeError } from '@mahoshojo/hosted-runtime/d1-http-client';

describe('root D1 compatibility seam', () => {
  it('re-exports the package-owned indeterminate error identity', () => {
    const error = new PackageD1IndeterminateOutcomeError(503);
    expect(error).toBeInstanceOf(RootD1IndeterminateOutcomeError);
    expect(error.code).toBe('D1_INDETERMINATE_OUTCOME');
    expect(error.name).toBe('D1IndeterminateOutcomeError');
    expect(error.status).toBe(503);
  });
});
