import { describe, expect, it } from 'bun:test';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';

describe('ai-provider-catalog', () => {
  it('provider id 必须唯一', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const provider of AI_PROVIDER_CATALOG) {
      if (seen.has(provider.id)) duplicates.push(provider.id);
      seen.add(provider.id);
    }

    expect(duplicates).toEqual([]);
  });

  it('每个 provider 的 model value 必须唯一', () => {
    const errors: Array<{ providerId: string; duplicates: string[] }> = [];

    for (const provider of AI_PROVIDER_CATALOG) {
      const seen = new Set<string>();
      const duplicates = new Set<string>();

      for (const model of provider.models) {
        if (seen.has(model.value)) duplicates.add(model.value);
        seen.add(model.value);
      }

      if (duplicates.size > 0) {
        errors.push({ providerId: provider.id, duplicates: Array.from(duplicates) });
      }
    }

    expect(errors).toEqual([]);
  });
});
