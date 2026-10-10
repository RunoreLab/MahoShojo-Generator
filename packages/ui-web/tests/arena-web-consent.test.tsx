// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebReportConsentDialogView, type WebReportConsentDialogViewProps } from '../src/arena-report';

let root: Root;
let container: HTMLDivElement;
const render = async (props: WebReportConsentDialogViewProps) => {
  await act(async () => root.render(<WebReportConsentDialogView {...props} />));
};
const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === label)!;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('controlled ordinary Web execution consent', () => {
  it('keeps risk copy shared and only reports explicit confirmation, without storage or execution', async () => {
    const props = { open: false, onAccept: vi.fn(), onCancel: vi.fn() };
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const fetch = vi.spyOn(globalThis, 'fetch');
    await render(props);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await render({ ...props, open: true });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('启用 Web 战报');
    expect(dialog.textContent).toContain('HTML、CSS 和 JavaScript');
    expect(dialog.textContent).toContain('第三方资源也可能接收到相关网络请求或页面发送的信息');
    expect(dialog.querySelector('input,iframe,script')).toBeNull();
    expect(props.onAccept).not.toHaveBeenCalled();
    await act(async () => button('继续使用 Web').click());
    expect(props.onAccept).toHaveBeenCalledExactlyOnceWith();
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the optional remember choice controlled across close and reopen', async () => {
    const onChange = vi.fn();
    const props = { open: true, onAccept: vi.fn(), onCancel: vi.fn(), remember: { checked: false, onChange } };
    await render(props);
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.closest('label')?.textContent).toContain('此浏览器不再提示（多人房间分别确认）');
    await act(async () => checkbox.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(checkbox.checked).toBe(false);
    expect(props.onAccept).not.toHaveBeenCalled();
    await render({ ...props, remember: { checked: true, onChange } });
    expect(checkbox.checked).toBe(true);
    await render({ ...props, open: false });
    await render(props);
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });

  it('treats Cancel, Escape and close as cancellation and renders host identity as inert text', async () => {
    const props = { open: true, title: '运行 Web 包（诊断）', executionDescription: '包名 <script>not executable</script> · 1.0.0', onAccept: vi.fn(), onCancel: vi.fn() };
    await render(props);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(props.executionDescription);
    expect(dialog.querySelector('script,input')).toBeNull();
    await act(async () => button('取消').click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!.click());
    expect(props.onCancel).toHaveBeenCalledTimes(3);
    expect(props.onAccept).not.toHaveBeenCalled();
  });
});
