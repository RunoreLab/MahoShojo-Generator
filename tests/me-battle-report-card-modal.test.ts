import { describe, expect, it } from 'bun:test';

import { shouldUseStreamingBattleReportCard } from '@/components/me/BattleReportCardModal';

describe('BattleReportCardModal', () => {
  it('only uses streaming card for stream generations with non-empty liveBody', () => {
    expect(
      shouldUseStreamingBattleReportCard({
        generationMode: 'stream',
        liveBody: '# 标题\n\n正文',
      }),
    ).toBe(true);

    expect(
      shouldUseStreamingBattleReportCard({
        generationMode: 'non-stream',
        liveBody: '# 标题\n\n正文',
      }),
    ).toBe(false);

    expect(
      shouldUseStreamingBattleReportCard({
        generationMode: 'stream',
        liveBody: '   ',
      }),
    ).toBe(false);
  });
});
