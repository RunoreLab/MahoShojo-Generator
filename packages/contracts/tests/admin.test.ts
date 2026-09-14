import { describe, expect, it } from 'vitest';
import { ADMIN_RESOURCES, AdminQuerySchema, AdminResourceSchema } from '../src/admin';

describe('Admin read contracts', () => {
  it('bounds pagination and rejects undeclared query fields', () => {
    expect(AdminQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(AdminQuerySchema.parse({ limit: '100', visibility: '-1' })).toEqual({ limit: 100, visibility: -1 });
    for (const query of [{ limit: 101 }, { limit: 0 }, { limit: '' }, { sort: 'auth_key' }, { visibility: 2 }]) {
      expect(AdminQuerySchema.safeParse(query).success).toBe(false);
    }
  });
  it('accepts only declared resources', () => {
    for (const resource of ADMIN_RESOURCES) expect(AdminResourceSchema.parse(resource)).toBe(resource);
    expect(AdminResourceSchema.safeParse('ba_account').success).toBe(false);
  });
});
