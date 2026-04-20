import { describe, expect, test } from 'bun:test';

import * as BaseModalModule from '@/components/shared/BaseModal';

describe('BaseModal layout helpers', () => {
  test('exposes viewport-constrained layout classes and accepts custom z-index', () => {
    const getBaseModalLayoutClassNames = (BaseModalModule as { getBaseModalLayoutClassNames?: unknown })
      .getBaseModalLayoutClassNames;

    expect(typeof getBaseModalLayoutClassNames).toBe('function');
    if (typeof getBaseModalLayoutClassNames !== 'function') return;

    const classes = getBaseModalLayoutClassNames({
      zIndexClassName: 'z-[60]',
      maxWidthClassName: 'max-w-2xl',
    });

    expect(classes.rootClassName).toContain('fixed inset-0');
    expect(classes.rootClassName).toContain('z-[60]');
    expect(classes.panelClassName).toContain('max-h-[calc(100dvh-2rem)]');
    expect(classes.panelClassName).toContain('flex-col');
    expect(classes.panelClassName).toContain('max-w-2xl');
    expect(classes.bodyClassName).toContain('min-h-0 flex-1 overflow-auto');
    expect(classes.footerClassName).toContain('shrink-0');
  });

  test('falls back to the default z-index and max width when options are omitted', () => {
    const getBaseModalLayoutClassNames = (BaseModalModule as { getBaseModalLayoutClassNames?: unknown })
      .getBaseModalLayoutClassNames;

    expect(typeof getBaseModalLayoutClassNames).toBe('function');
    if (typeof getBaseModalLayoutClassNames !== 'function') return;

    const classes = getBaseModalLayoutClassNames();

    expect(classes.rootClassName).toContain('z-50');
    expect(classes.panelClassName).toContain('max-w-4xl');
  });
});
