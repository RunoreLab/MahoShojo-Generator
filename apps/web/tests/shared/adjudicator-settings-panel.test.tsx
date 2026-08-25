import { renderToStaticMarkup } from 'react-dom/server';
import { vi, describe, expect, test } from 'vitest';

vi.mock('@/components/AdjudicatorEditor', () => ({
  default() {
    return <div data-testid="adjudicator-editor" />;
  },
}));

import { AdjudicatorSettingsPanel } from '@/components/shared/AdjudicatorSettingsPanel';

describe('AdjudicatorSettingsPanel', () => {
  test('renders clear button when events exist and a clear handler is provided', () => {
    const html = renderToStaticMarkup(
      <AdjudicatorSettingsPanel
        events={[{ id: 'evt-1', description: 'A', type: 'binary', probability: 50 } as any]}
        onEventsChange={() => {}}
        onClearEvents={() => {}}
      />
    );

    expect(html).toContain('清空全部');
    expect(html).toContain('aria-label="清空全部判定事件"');
  });

  test('does not render clear button when there are no events', () => {
    const html = renderToStaticMarkup(
      <AdjudicatorSettingsPanel events={[]} onEventsChange={() => {}} onClearEvents={() => {}} />
    );

    expect(html).not.toContain('清空全部');
  });
});
