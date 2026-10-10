// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BattleReportCard, { type NewsReport } from '@/components/BattleReportCard';
import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';
const host = vi.hoisted(() => ({ capture: vi.fn(), download: vi.fn(), createUrl: vi.fn(), auth: { isAuthenticated: true, loading: false, user: { id: 1, username: '生成者甲' }, userBadges: [] } }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => host.auth }));
vi.mock('@/lib/client/snapdomCapture', () => ({ capturePngBlob: host.capture }));
vi.mock('@/lib/client/blobUrl', () => ({ createBlobUrl: host.createUrl, downloadBlob: host.download }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const report: NewsReport = {
  headline: '破晓战报', reporterInfo: { name: '记者甲', publication: '报社' },
  article: { body: '正文\n\n[原生外链](https://example.com/report)\n\n|角色|状态|\n|---|---|\n|翠雀|胜利|\n\n![许可](http://i.imgur.com/good.png)\n\n![拒绝](https://untrusted.example/bad.png)', analysis: '点评' },
  officialReport: { winner: '翠雀', conclusion: '守住舞台' }, userGuidance: '雨夜', characterGuidances: [{ characterName: '翠雀', guidance: '保护队友' }],
  adjudicationResults: [{ description: '命中', type: 'binary', roll: 42, outcome: '成功', details: '42', depth: 0 }],
  aiModel: 'model-test', aiUsage: { promptTokens: 100, reasoningTokens: 20, completionTokens: 50, textTokens: 30 },
  aiReasoning: { status: 'done', source: 'sdk', text: '独立推理', summary: '推理摘要' },
};
let container: HTMLDivElement; let root: Root;
const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text))!;
const readBlob = (blob: Blob): Promise<string> => new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  host.auth.isAuthenticated = true; host.capture.mockResolvedValue(new Blob(['png'], { type: 'image/png' })); host.createUrl.mockReturnValue('blob:preview');
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Desktop Test');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('real Web report wrappers consume shared rendering and explicit host ports', () => {
  it('retains content/metadata, battle tables, media policy, generator auth and Markdown export', async () => {
    await act(async () => root.render(<BattleReportCard report={report} mode="scenario" cardWidthPx={720} />));
    expect(container.textContent).toContain('翠雀'); expect(container.textContent).toContain('model-test'); expect(container.querySelector('table')).not.toBeNull();
    const external = container.querySelector<HTMLAnchorElement>('a[href="https://example.com/report"]')!;
    expect(external.target).toBe('_blank'); expect(external.rel).toBe('noopener noreferrer'); expect(external.hasAttribute('role')).toBe(false);
    expect(container.querySelector('img[src="https://i.imgur.com/good.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="https://untrusted.example/bad.png"]')).toBeNull(); expect(container.textContent).toContain('https://untrusted.example/bad.png');
    expect(container.querySelector('.logo-placeholder')?.textContent).toContain('生成者甲');
    expect(container.querySelector('[style*="720px"]')).not.toBeNull();
    await act(async () => button('下载战斗记录').click());
    expect(host.download.mock.calls[0][1]).toBe('魔法少女速报_破晓战报.md');
    const markdown = await readBlob(host.download.mock.calls[0][0]);
    for (const value of ['# 破晓战报', '记者甲', '## 新闻正文', '## 官方通报', '## 故事引导', '保护队友', '## 随机判定记录']) expect(markdown).toContain(value);
    host.auth.isAuthenticated = false;
    await act(async () => root.render(<BattleReportCard report={report} />));
    expect(container.querySelector('.logo-placeholder')?.textContent).not.toContain('生成者甲');
  });
  it('preserves screenshot preparation, desktop download and restoration on success and failure', async () => {
    let resolve!: (blob: Blob) => void;
    host.capture.mockImplementationOnce((element: HTMLElement, options: unknown) => {
      expect(element.querySelector<HTMLElement>('.buttons-container')!.style.display).toBe('none');
      expect(element.querySelector<HTMLElement>('.logo-placeholder')!.style.display).toBe('flex');
      expect(element.querySelector<HTMLElement>('.ai-reasoning-panel')!.style.display).toBe('none');
      expect(options).toMatchObject({ scale: 1, dprMax: 2, exclude: ['audio', 'video'], excludeMode: 'remove' });
      return new Promise<Blob>((yes) => { resolve = yes; });
    });
    await act(async () => root.render(<BattleReportCard report={report} onSaveImage={vi.fn()} />));
    await act(async () => button('保存为图片').click());
    expect(button('生成中').disabled).toBe(true);
    await act(async () => resolve(new Blob(['png'])));
    expect(host.download.mock.calls[0][1]).toBe('魔法少女速报_破晓战报.png');
    expect(container.querySelector<HTMLElement>('.buttons-container')!.style.display).toBe('flex');
    expect(container.querySelector<HTMLElement>('.logo-placeholder')!.style.display).toBe('none');
    expect(container.querySelector<HTMLElement>('.ai-reasoning-panel')!.style.display).toBe('');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host.capture.mockRejectedValueOnce(new Error('capture unavailable'));
    await act(async () => button('保存为图片').click());
    expect(window.alert).toHaveBeenCalledWith('生成图片失败，请重试'); expect(button('保存为图片').disabled).toBe(false);
    expect(container.querySelector<HTMLElement>('.buttons-container')!.style.display).toBe('flex');
  });
  it('keeps stop events, stopping disabled state, timeout text and isolated Web-output actions', async () => {
    const stop = vi.fn();
    await act(async () => root.render(<StreamingBattleReportCard content={"# 破晓战报\n\n正文"} isStreaming onStopGeneration={stop} onSaveImage={vi.fn()} softTimeoutWarning="仍在等待" />));
    expect(container.textContent).toContain('仍在等待');
    await act(async () => button('停止生成').click()); expect(stop).toHaveBeenCalledOnce(); expect(host.capture).not.toHaveBeenCalled();
    await act(async () => root.render(<StreamingBattleReportCard content={"# 标题"} isStreaming onStopGeneration={stop} onSaveImage={vi.fn()} stopGenerationDisabled />));
    expect(button('正在停止').disabled).toBe(true);
    await act(async () => root.render(<StreamingBattleReportCard content={"# 标题"} disableExport reportContent={<div data-testid="host-web-output">isolated output</div>} additionalActions={<button>原 Web 操作</button>} />));
    expect(container.querySelector('[data-testid="host-web-output"]')).not.toBeNull(); expect(button('原 Web 操作')).toBeTruthy(); expect(button('下载记录')).toBeUndefined();
  });
  it('streaming mobile shares when supported and falls back to original image callback when sharing rejects', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mobi Test');
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true }); Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    const preview = vi.fn();
    try {
      await act(async () => root.render(<StreamingBattleReportCard content={"# 战斗战报\n正文"} onSaveImage={preview} />));
      await act(async () => button('保存为图片').click());
      expect(share).toHaveBeenCalledOnce(); expect(preview).not.toHaveBeenCalled(); expect(host.download).not.toHaveBeenCalled();
      vi.spyOn(console, 'warn').mockImplementation(() => {}); share.mockRejectedValueOnce(new Error('cancel share'));
      await act(async () => button('保存为图片').click()); expect(preview).toHaveBeenCalledWith('blob:preview');
      await act(async () => root.render(<BattleReportCard report={report} onSaveImage={preview} />));
      await act(async () => button('保存为图片').click()); expect(share).toHaveBeenCalledTimes(2); expect(preview).toHaveBeenCalledTimes(2);
    } finally { Reflect.deleteProperty(navigator, 'share'); Reflect.deleteProperty(navigator, 'canShare'); }
  });
  it('retains legacy Web image/stop visibility when no image callback is provided', async () => {
    await act(async () => root.render(<StreamingBattleReportCard content={"# 标题"} isStreaming onStopGeneration={vi.fn()} />));
    expect(button('停止生成')).toBeUndefined(); expect(button('保存为图片')).toBeUndefined(); expect(button('下载记录')).toBeTruthy();
  });
});
