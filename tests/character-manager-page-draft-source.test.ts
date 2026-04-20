import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

describe('character manager page draft source wiring', () => {
  test('character manager page wires local draft helpers and visible draft controls', () => {
    const source = readFileSync('pages/character-manager.tsx', 'utf8');

    expect(source).toContain('readCharacterManagerPageDraft');
    expect(source).toContain('writeCharacterManagerPageDraft');
    expect(source).toContain('clearCharacterManagerPageDraft');
    expect(source).toContain('已自动保存于');
    expect(source).toContain('清空本地草稿');
    expect(source).toContain('handleLoadOtherData');
  });
});
