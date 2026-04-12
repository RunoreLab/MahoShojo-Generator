import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

describe('scenario page draft source wiring', () => {
  test('scenario page wires local draft helpers and visible draft controls', () => {
    const source = readFileSync('pages/scenario.tsx', 'utf8');

    expect(source).toContain('readScenarioPageDraft');
    expect(source).toContain('writeScenarioPageDraft');
    expect(source).toContain('clearScenarioPageDraft');
    expect(source).toContain('generalScenarioDraftEdited');
    expect(source).toContain('已自动保存于');
    expect(source).toContain('清空本地草稿');
  });
});
