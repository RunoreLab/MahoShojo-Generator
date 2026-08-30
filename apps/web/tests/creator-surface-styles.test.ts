import { expect, test } from 'vitest';

import {
  CREATOR_INPUT_CLASS,
  CREATOR_PANEL_SURFACE_CLASS,
  CREATOR_SUBPANEL_ACTIVE_CLASS,
  CREATOR_SUBPANEL_SURFACE_CLASS,
} from '@/components/creator/surfaceStyles';

test('creator workbench surface 使用独立的高对比 token，避免浅色模式边框消失', () => {
  expect(CREATOR_PANEL_SURFACE_CLASS).toContain('border-[var(--creator-panel-border)]');
  expect(CREATOR_PANEL_SURFACE_CLASS).toContain('bg-[var(--creator-panel-bg)]');

  expect(CREATOR_SUBPANEL_SURFACE_CLASS).toContain('border-[var(--creator-subpanel-border)]');
  expect(CREATOR_SUBPANEL_SURFACE_CLASS).toContain('bg-[var(--creator-subpanel-bg)]');

  expect(CREATOR_SUBPANEL_ACTIVE_CLASS).toContain('ring-violet-400/25');

  expect(CREATOR_INPUT_CLASS).toContain('border-[var(--creator-input-border)]');
  expect(CREATOR_INPUT_CLASS).toContain('bg-[var(--creator-input-bg)]');
});
