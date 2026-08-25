import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('Arena resumable generation schema contract', () => {
  it('keeps transient lifecycle out of D1 and reuses the terminal battle-report schema', () => {
    const bootstrap = read('lib/database/schema.sql');
    const drizzle = read('lib/db/schema/business.ts');
    const finalization = read('packages/hosted-runtime/src/arena-generation/d1-finalization.ts');

    for (const table of ['arena_generation_reservations', 'arena_generation_effects']) {
      expect(bootstrap).not.toContain(table);
      expect(drizzle).not.toContain(table);
      expect(finalization).not.toContain(table);
    }
    expect(existsSync('drizzle/0014_arena_resumable_generation.sql')).toBe(false);
    expect(bootstrap).toContain('CREATE TABLE IF NOT EXISTS battle_report_generations');
    expect(drizzle).toContain("sqliteTable('battle_report_generations'");
    expect(finalization).toContain('INSERT OR IGNORE INTO battle_report_generations');
    expect(finalization).toContain('generationPayloadHash');
    expect(finalization).toContain('localCardReconciliation');
    expect(finalization).not.toContain("status = 'finalizing'");
    expect(finalization).not.toContain('producerToken');
  });
});
