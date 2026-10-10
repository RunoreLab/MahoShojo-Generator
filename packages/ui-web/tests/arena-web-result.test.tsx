// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebPackageRiskProfile } from '@mahoshojo/web-package/security';
import { ArenaReportFormatSelectorView, ArenaWebResultView, StreamingBattleReportCard, WebPackageRiskSummary, type ArenaWebResultViewProps } from '../src/arena-report';

let container: HTMLDivElement;
let root: Root;
const source = '<!doctype html><html><body><script>fetch("https://external.test")</script><img src="https://external.test/a.png"></body></html>';
const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!;
const render = async (props: Partial<ArenaWebResultViewProps> = {}) => {
  await act(async () => root.render(<ArenaWebResultView source={source} ready {...props} />));
};
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('Arena Web safe report chrome', () => {
  it('owns the existing result-card surface for white actions and notes, regardless of the host page theme', async () => {
    await render({ prelude: '安全附言' });
    const card = container.querySelector('[data-testid="arena-web-result"]')!;
    expect(card.classList.contains('result-card')).toBe(true);
    expect(card.classList.contains('before:hidden')).toBe(true);
    const content = card.querySelector(':scope > .result-content')!;
    expect(content).not.toBeNull();
    expect(content.contains(button('运行 Web 战报'))).toBe(true);
    expect(content.querySelector('[data-testid="arena-web-notes"]')).not.toBeNull();
    expect(content.querySelector('.text-gray-500')).toBeNull();
    const notices = [...content.querySelectorAll('p')].filter((node) => node.textContent?.includes('隔离运行待验') || node.textContent?.includes('导出的 HTML'));
    expect(notices).toHaveLength(2);
    expect(notices.every((node) => node.classList.contains('text-white/90'))).toBe(true);
    expect(card.querySelector('iframe,script,img')).toBeNull();
    const safeBackground = (card as HTMLElement).style.background;
    expect(safeBackground).toContain('linear-gradient');
    await act(async () => root.render(<StreamingBattleReportCard content="" reportContent={<div>宿主内容</div>} />));
    const webCard = container.querySelector<HTMLElement>('.result-card')!;
    expect(webCard.style.background).toBe(safeBackground);
    expect(webCard.style.padding).toBe('0px');
    await act(async () => root.render(<StreamingBattleReportCard content="# 普通战报" />));
    const ordinaryCard = container.querySelector<HTMLElement>('.result-card')!;
    expect(ordinaryCard.style.background).not.toBe(safeBackground);
    expect(ordinaryCard.style.padding).toBe('1.5rem');
  });

  it('shows source and notes as text without media, scripts, frames or implicit execution', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await render({ prelude: '[打开](https://external.test) ![图片](https://external.test/b.png)', epilogue: '<img onerror="alert(1)" src="x">' });
    expect(container.querySelector('pre')?.textContent).toBe(source);
    expect(button('运行 Web 战报').disabled).toBe(true);
    expect(container.textContent).toContain('隔离运行待验');
    await act(async () => button('AI 附言').click());
    expect(container.textContent).toContain('![图片](https://external.test/b.png)');
    expect(container.textContent).toContain('<img onerror="alert(1)" src="x">');
    expect(container.querySelector('iframe,script,img,a,object,embed')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires an available execution port and ready output, and revokes the button with the capability', async () => {
    const onRun = vi.fn();
    await render({ ready: false, execution: { available: true, onRun } });
    await act(async () => button('运行 Web 战报').click());
    expect(onRun).not.toHaveBeenCalled();
    await render({ execution: { available: true, onRun, notice: '每次运行由宿主确认' } });
    expect(onRun).not.toHaveBeenCalled();
    await act(async () => button('运行 Web 战报').click());
    expect(onRun).toHaveBeenCalledOnce();
    await render({ execution: { available: false, reason: '当前宿主隔离运行尚未验收' } });
    await act(async () => button('运行 Web 战报').click());
    expect(onRun).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('当前宿主隔离运行尚未验收');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('does not fabricate download or save capability and preserves explicit independent actions for partial output', async () => {
    const download = vi.fn();
    await render({ ready: false, status: '结果未完成' });
    expect(container.querySelectorAll('button')).toHaveLength(1);
    await render({ ready: false, actions: [{ id: 'source', label: '导出完整原文', onClick: download }, { id: 'save', label: '保存结果', disabled: true, onClick: vi.fn() }] });
    expect(download).not.toHaveBeenCalled();
    await act(async () => button('导出完整原文').click());
    expect(download).toHaveBeenCalledOnce();
    expect(button('保存结果').disabled).toBe(true);
    expect(container.textContent).toContain('不受应用隔离保护');
  });

  it('keeps incomplete scan evidence explicit without treating declarations or origins as capabilities', async () => {
    const riskProfile: WebPackageRiskProfile = {
      packageRef: { id: 'test.risk', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` },
      scannerVersion: 2, policyVersion: 1, fingerprint: 'test-risk', status: 'partial',
      declared: ['audio'], categories: ['scripts', 'network'], externalOrigins: ['https://external.test'],
      uncertainty: ['二进制资源未扫描'],
      findings: [{ category: 'network', source: 'overlay', path: 'story.js', evidence: '<img src="https://external.test">' }],
    };
    await render({ riskProfile });
    expect(container.textContent).toContain('部分内容未扫描');
    expect(container.textContent).toContain('不是安全认证');
    expect(container.textContent).toContain('作者未声明，但预检检测到：脚本执行、网络访问');
    expect(container.textContent).toContain('二进制资源未扫描');
    const uncertainty = () => [...container.querySelectorAll('p')].find((node) => node.textContent?.includes('二进制资源未扫描'))!;
    expect(uncertainty().classList.contains('text-amber-300')).toBe(true);
    expect(uncertainty().classList.contains('text-amber-700')).toBe(false);
    expect(container.querySelector('img,a')).toBeNull();
    expect(button('运行 Web 战报').disabled).toBe(true);
    await act(async () => root.render(<WebPackageRiskSummary profile={riskProfile} />));
    expect(uncertainty().classList.contains('text-amber-700')).toBe(true);
    expect(uncertainty().classList.contains('dark:text-amber-300')).toBe(true);
  });

  it('keeps format choice controlled and independent of runtime consent, without choosing on mount', async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<ArenaReportFormatSelectorView value="markdown" onChange={onChange}><span>共享包选择</span></ArenaReportFormatSelectorView>));
    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('共享包选择');
    await act(async () => button('Web（实验性）').click());
    expect(onChange).toHaveBeenCalledWith('web');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.render(<ArenaReportFormatSelectorView value="web" disabled onChange={onChange}><span>共享包选择</span></ArenaReportFormatSelectorView>));
    expect(container.textContent).toContain('共享包选择');
    await act(async () => button('Markdown').click());
    expect(onChange).toHaveBeenCalledOnce();
  });
});
