// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { BattleReportCard, StreamingBattleReportCard, type NewsReport } from '../src/arena-report';
const report: NewsReport = { headline: '标题', reporterInfo: { name: '记者', publication: '日报' }, article: { body: '![图](https://i.imgur.com/a.png)', analysis: '分析' }, officialReport: { winner: '角色', conclusion: '结束' } };
describe('shared report capabilities', () => {
  it('has no implicit media/auth/export host and supports a real stream stop without image capability', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<BattleReportCard report={report} showImageAction />));
      expect(container.querySelector('img[src="https://i.imgur.com/a.png"]')).toBeNull();
      expect(container.querySelector('.buttons-container')).toBeNull();
      expect(container.textContent).not.toContain('生成者');
      const stop = vi.fn(); const download = vi.fn();
      await act(async () => root.render(<StreamingBattleReportCard content={"# 流式\n正文"} isStreaming onStopGeneration={stop} ports={{ downloadMarkdown: download }} />));
      const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!;
      await act(async () => button('停止生成').click()); expect(stop).toHaveBeenCalledOnce();
      await act(async () => button('下载记录').click()); expect(download).toHaveBeenCalledWith('# 流式\n正文', '魔法少女速报_流式.md');
      await act(async () => root.render(<StreamingBattleReportCard content={"# 流式\n正文"} />));
      expect(container.querySelector('.buttons-container')).toBeNull();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
