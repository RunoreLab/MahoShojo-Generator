// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BasicCardDetailsModal, CardDetailsActions, CardDetailsBody } from '../src/card-details';
import { BaseModal } from '../src/modal';
const card = { id: 'same', name: '通用详情', description: '原简介', type: 'history' as const, data: '{"content":"正文"}', isPublic: false, author: '本机作者', createdAt: '2026-01-01T01:02:00Z', updatedAt: '2026-02-01T01:02:00Z' };
const markdown = (content: string) => <p>{content}</p>;
let root: Root; let container: HTMLDivElement;
const renderHtml = (node: ReactNode) => { act(() => root.render(node)); return container.innerHTML; };
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('共源基础详情', () => {
  it('依能力显示下载/保存动作，保持主次、禁用状态与回执边界', () => {
    const download = vi.fn();
    const save = vi.fn();
    renderHtml(<CardDetailsActions onDownload={download} onSave={save} />);
    const downloadButton = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('下载 JSON'))!;
    const saveButton = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('存到本地库'))!;
    expect(downloadButton.className).toContain('--secondary');
    expect(saveButton.className).toContain('--primary');
    expect(saveButton.disabled).toBe(false);
    expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
    act(() => downloadButton.click());
    act(() => saveButton.click());
    expect(download).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();

    renderHtml(<CardDetailsActions onDownload={download} onSave={save} saveBusy />);
    expect([...container.querySelectorAll('button')][1]?.disabled).toBe(true);
    expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();

    renderHtml(<CardDetailsActions onDownload={download} />);
    const downloadOnly = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('下载 JSON'))!;
    expect(container.textContent).not.toContain('存到本地库');
    expect(downloadOnly.className).toContain('--primary');
    expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
    act(() => downloadOnly.click());
    expect(download).toHaveBeenCalledTimes(2);
  });
  it.each(['character', 'scenario', 'history', 'questionnaire'] as const)('保留 %s 通用正文、作者日期和显式来源，无宿主动作不造按钮', async (type) => {
    await act(async () => root.render(<BasicCardDetailsModal isOpen onClose={() => {}} card={{ ...card, type }} source={{ kind: 'cache', lastSuccessAt: '2026-03-01T00:00:00Z' }} renderMarkdown={markdown} />));
    expect(container.textContent).toContain('本机作者'); expect(container.textContent).toContain('缓存快照'); expect(container.textContent).toContain('正文'); expect(container.querySelector('[title="2026-01-01T01:02:00Z"]')).not.toBeNull(); expect(container.textContent).not.toContain('下载 JSON'); expect(container.textContent).not.toContain('存到本地库');
  });
  it('详情正文采用共源滚动区域，键盘可聚焦阅读且长标题不挤占关闭操作', () => {
    const longName = 'LongUnbrokenCardName'.repeat(8);
    renderHtml(<BasicCardDetailsModal isOpen card={{ ...card, name: longName }} source={{ kind: 'local' }} onClose={() => {}} renderMarkdown={markdown} />);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const region = dialog.querySelector<HTMLElement>('[role="region"]')!;
    expect(region).not.toBeNull();
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute('aria-labelledby')).toBe(dialog.getAttribute('aria-labelledby'));
    expect(region.className).toContain('overscroll-contain');
    region.focus();
    expect(document.activeElement).toBe(region);
    const title = dialog.querySelector('h2')!;
    expect(title.className).toContain('truncate');
    expect(title.getAttribute('title')).toBe(longName);
    expect(dialog.className).toContain('max-h-[min(90dvh,calc(100dvh-2rem))]');
  });
  it('缩短页脚并在正文后折叠日期元信息', () => {
    renderHtml(<BasicCardDetailsModal isOpen card={card} source={{ kind: 'local' }} onClose={() => {}} renderMarkdown={markdown} />);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const detailHeading = [...dialog.querySelectorAll('h3')].find(heading => heading.textContent === '内容')!;
    const dateDetails = dialog.querySelector('details')!;
    expect(dateDetails.querySelector('summary')?.textContent).toBe('创建与更新时间');
    // 共享焦点圈留通过显式 tabindex 纳入原生 summary，不能在正文区提前环绕。
    expect(dateDetails.querySelector('summary')?.tabIndex).toBe(0);
    expect(detailHeading.compareDocumentPosition(dateDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog.querySelectorAll('button[aria-label^="关闭"]')).toHaveLength(1);
    expect(dialog.querySelector('button')?.textContent).not.toContain('关闭');
  });
  it.each(['oops', 'null', '12', '"text"'])('无效正文 %s 明确报错', (data) => {
    const html = renderHtml(<CardDetailsBody data={data} renderMarkdown={markdown} />);
    expect(html).toContain('role="alert"'); expect(html).not.toContain('暂无详细设定');
  });
  it('隐藏递归内部字段，原型名称不崩溃/不泄露函数，深度有界', () => {
    const html = renderHtml(<CardDetailsBody data='{"name":"可见","nested":{"metadata":"秘密A","userAnswers":"秘密B","_hidden":"秘密C","__proto__":"秘密D","constructor":"秘密E","hasOwnProperty":"正常扩展"}}' renderMarkdown={markdown} />);
    expect(html).toContain('正常扩展'); expect(html).not.toContain('秘密'); expect(html).not.toContain('native code');
    let data: unknown = '终点'; for (let i = 0; i < 100; i++) data = { nested: data };
    expect(renderHtml(<CardDetailsBody data={JSON.stringify(data)} renderMarkdown={markdown} />)).toContain('内容过深');
    expect(renderHtml(<CardDetailsBody data={JSON.stringify(Array.from({ length: 1001 }, () => 'x'))} renderMarkdown={markdown} />)).not.toContain('截断');
    expect(renderHtml(<CardDetailsBody data={JSON.stringify(Array.from({ length: 3000 }, () => 'x'))} renderMarkdown={markdown} />)).toContain('截断');
  });
  it.each([false, true])('嵌套详情（头部动作：%s）保留初始焦点、双向 Tab 与顶层 Escape', async (withHeaderAction) => {
    const parent = vi.fn(); const child = vi.fn(); let open = false;
    const render = () => root.render(<BaseModal isOpen title="父层" onClose={parent}><button id="trigger">打开详情</button>{open && <BasicCardDetailsModal isOpen card={card} source={{ kind: 'local' }} onClose={() => { child(); open = false; render(); }} renderMarkdown={markdown} headerActions={withHeaderAction ? <button type="button">更多</button> : undefined} />}</BaseModal>);
    await act(async () => render());
    const trigger = document.querySelector<HTMLButtonElement>('#trigger')!;
    trigger.focus();
    open = true; await act(async () => render());
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
    expect(dialogs).toHaveLength(2);
    const details = dialogs.at(-1)!;
    const close = details.querySelector<HTMLButtonElement>('button[aria-label="关闭历史详情"]')!;
    expect(close).not.toBeNull();
    expect(document.activeElement).toBe(close);
    const focusable = [...details.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.matches(':disabled') && !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    expect(details.querySelector('button[aria-label^="关闭"]')).toBe(close);
    expect(details.querySelector('button[aria-label="更多操作"]')).toBeNull();
    expect(details.querySelector('[data-card-actions]')).toBeNull();
    expect(last).not.toBe(close);
    if (withHeaderAction) {
      expect(first.textContent).toBe('更多');
      expect(first).not.toBe(close);
      expect(focusable[1]).toBe(close);
      const middleTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      await act(async () => close.dispatchEvent(middleTab));
      expect(middleTab.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(close);
    } else {
      expect(first).toBe(close);
    }
    last.focus();
    const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => last.dispatchEvent(forwardTab));
    expect(forwardTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const reverseTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => first.dispatchEvent(reverseTab));
    expect(reverseTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(child).toHaveBeenCalledOnce(); expect(parent).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(parent).toHaveBeenCalledOnce();
  });
});
