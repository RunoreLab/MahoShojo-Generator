import { describe, expect, it } from 'vitest';
import * as sharedSchema from '@mahoshojo/hosted-runtime/db/schema';
import * as webSchema from '@/lib/db/schema';
import { users } from '@/lib/db/schema/business';
import { baUsers } from '@/lib/db/schema/auth';
import { aiChannelAvailabilityBuckets } from '@/lib/db/schema/ai-availability';

describe('Web canonical schema compatibility', () => {
  it('reexports the same tables through aggregate and existing domain paths', () => {
    expect(Object.keys(webSchema).sort()).toEqual(Object.keys(sharedSchema).sort());
    for (const name of Object.keys(sharedSchema) as Array<keyof typeof sharedSchema>) {
      expect(webSchema[name]).toBe(sharedSchema[name]);
    }
    expect(users).toBe(sharedSchema.users);
    expect(baUsers).toBe(sharedSchema.baUsers);
    expect(aiChannelAvailabilityBuckets).toBe(sharedSchema.aiChannelAvailabilityBuckets);
  });
});
