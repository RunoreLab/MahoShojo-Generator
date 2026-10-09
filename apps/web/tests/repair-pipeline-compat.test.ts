import { expect, it } from 'vitest';
import { repairNormalizeValidate as shared } from '@mahoshojo/ai-core/repair-pipeline';
import { repairNormalizeValidate as web } from '@/lib/repair-pipeline';
it('keeps all Web repair consumers on the same legacy implementation', () => {
  expect(web).toBe(shared);
});
