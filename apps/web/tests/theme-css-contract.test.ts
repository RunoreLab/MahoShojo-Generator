import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const globalsCss = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8');
const blueThemeCss = readFileSync(new URL('../styles/blue-theme.css', import.meta.url), 'utf8');

describe('主题 CSS 契约', () => {
  test('Tailwind dark variant follows the resolved application color mode', () => {
    expect(globalsCss).toContain(
      "@custom-variant dark (&:where([data-color-mode='dark'], [data-color-mode='dark'] *));",
    );
  });

  test('only globals.css owns the Tailwind entrypoint', () => {
    const tailwindImport = '@import "tailwindcss";';

    expect(globalsCss.match(new RegExp(tailwindImport, 'g'))).toHaveLength(1);
    expect(blueThemeCss).not.toContain(tailwindImport);
  });
});
