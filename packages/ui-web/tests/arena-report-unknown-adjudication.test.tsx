// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { resolveAdjudicationEvents } from '@mahoshojo/domain/arena-adjudication';
import { ArenaCompanionAdjudicationResultSchema } from '@mahoshojo/contracts/arena-companion';
import { BattleReportCard, StreamingBattleReportCard, type NewsReport } from '../src/arena-report';
it('both shared report views display a checked unknown-type result from the actual resolver unchanged', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const adjudicationResults = resolveAdjudicationEvents([{ type: 'legacy-unknown', description: '未知类型仍需展示' }], () => 0.5)
    .map(value => ArenaCompanionAdjudicationResultSchema.parse(value));
  const report: NewsReport = { headline: '标题', reporterInfo: { name: '记者', publication: '日报' }, article: { body: '正文', analysis: '分析' },
    officialReport: { winner: '角色', conclusion: '结束' }, adjudicationResults };
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<BattleReportCard report={report} />));
    expect(container.textContent).toContain('未知类型仍需展示'); expect(container.textContent).toContain('判定结果: 未知');
    await act(async () => root.render(<StreamingBattleReportCard content="正文" adjudicationResults={adjudicationResults} />));
    expect(container.textContent).toContain('未知类型仍需展示'); expect(container.textContent).toContain('判定结果: 未知');
    expect(adjudicationResults[0]!.type).toBe('legacy-unknown');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
