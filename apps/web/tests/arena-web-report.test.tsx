// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaReportFormatSelector, ArenaWebReport } from '@/components/arena/components/ArenaWebReport';
import { downloadBlob } from '@/lib/client/blobUrl';

vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: vi.fn() }));

const source = '<!doctype html><html><body><button onclick="this.textContent=123">互动</button></body></html>';
let container: HTMLDivElement;
let root: Root;
const click = async (text: string) => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
};
const viewer = (roomId: string, ready = true, content = source) => (
  <ArenaWebReport key={roomId} roomId={roomId} ready={ready} content={content}>
    {(web) => web ?? <div data-testid="ordinary">{content}</div>}
  </ArenaWebReport>
);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Web 战报的本地执行许可', () => {
  it('仅完整战报可下载 HTML；取消执行后仍可下载，保留脚本并移除机器 meta', async () => {
    const content = `${source}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"winner":"甲"}} -->`;
    await act(async () => root.render(viewer('download', false, content)));
    await click('🌐 下载 HTML');
    expect(downloadBlob).not.toHaveBeenCalled();
    await act(async () => root.render(viewer('download', true, content)));
    await click('取消');
    expect(container.textContent).toContain('不再受本站沙箱保护');
    await click('🌐 下载 HTML');
    expect(document.querySelector('iframe')).toBeNull();
    expect(downloadBlob).toHaveBeenCalledOnce();
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(filename).toMatch(/^魔法少女速报_[\dT-]+Z\.html$/);
    const downloaded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(downloaded).toBe(source);
    await click('Web 显示');
    await click('继续使用 Web');
    await click('🌐 下载 HTML');
    expect(downloadBlob).toHaveBeenCalledTimes(2);
    expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    await act(async () => root.render(viewer('download', false, content)));
    await click('🌐 下载 HTML');
    expect(downloadBlob).toHaveBeenCalledTimes(2);
  });

  it('生成期间禁用格式切换，不打开确认也不更改格式', async () => {
    const change = vi.fn();
    await act(async () => root.render(<ArenaReportFormatSelector value="markdown" onChange={change} disabled roomId="disabled-selector" />));
    await click('Web（实验性）');
    await click('Markdown');
    expect(change).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('Markdown');
  });

  it('选择 Web 可取消；确认与不再提示仅保存浏览器本地', async () => {
    const change = vi.fn();
    await act(async () => root.render(<ArenaReportFormatSelector value="markdown" onChange={change} roomId="selector" />));
    await click('Web（实验性）');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('第三方');
    expect(change).not.toHaveBeenCalled();
    await click('取消');
    expect(change).not.toHaveBeenCalled();
    await click('Web（实验性）');
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await click('继续使用 Web');
    expect(change).toHaveBeenCalledWith('web');
    expect(window.localStorage.getItem('arena.web-report-consent.v1.room.selector')).toBe('accepted');
    expect(window.localStorage.getItem('arena.web-report-consent.v1')).toBeNull();
  });

  it('未完成时不确认、不挂载；完成并确认后只用 allow-scripts，移除机器 meta', async () => {
    const content = `${source}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"winner":"甲"}} -->`;
    await act(async () => root.render(viewer('final-only', false, content)));
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.render(viewer('final-only', true, content)));
    expect(document.querySelector('iframe')).toBeNull();
    await click('继续使用 Web');
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.srcdoc).toBe(source);
    expect(frame.srcdoc).not.toContain('MAHOSHOJO_ARENA_META');
    expect(window.localStorage.length).toBe(0);
    await click('普通显示');
    expect(document.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[data-testid="ordinary"]')).toBeTruthy();
    await click('Web 显示');
    expect(document.querySelector('iframe')).toBeTruthy();
    const oldFrame = document.querySelector('iframe');
    await click('重新加载 Web');
    expect(document.querySelector('iframe')).not.toBe(oldFrame);
    await act(async () => root.render(viewer('final-only', false, content)));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('单人记忆不授权房间；拒绝可再次确认；房间之间隔离', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1', 'accepted');
    await act(async () => root.render(viewer('isolated-a')));
    expect(document.querySelector('iframe')).toBeNull();
    await click('取消');
    expect(container.querySelector('[data-testid="ordinary"]')).toBeTruthy();
    await click('Web 显示');
    await click('继续使用 Web');
    expect(document.querySelector('iframe')).toBeTruthy();
    await act(async () => root.render(viewer('isolated-b')));
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('已记忆的房间许可仍不能执行 incomplete 文档', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.remembered', 'accepted');
    await act(async () => root.render(viewer('remembered', false)));
    expect(document.querySelector('iframe')).toBeNull();
    await act(async () => root.render(viewer('remembered')));
    expect(document.querySelector('iframe')?.srcdoc).toBe(source);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('localStorage 不可用时仍能在当前页面确认', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await act(async () => root.render(viewer('storage-blocked')));
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await click('继续使用 Web');
    expect(document.querySelector('iframe')).toBeTruthy();
  });
});
