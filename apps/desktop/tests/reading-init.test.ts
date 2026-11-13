import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getReadingPreferenceInitScript } from '@mahoshojo/ui-web/device-preferences-init';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('reading preference bootstrap in production hosts', () => {
  it('restores Desktop reading preferences before application modules run', () => {
    const html = readFileSync(resolve(desktopRoot, 'index.html'), 'utf8');
    const script = getReadingPreferenceInitScript();
    expect(html).toContain(script);
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
  });
});
