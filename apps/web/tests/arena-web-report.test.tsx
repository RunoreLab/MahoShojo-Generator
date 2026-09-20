// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaReportFormatSelector, ArenaWebReport } from '@/components/arena/components/ArenaWebReport';
import { downloadBlob } from '@/lib/client/blobUrl';
import { BattleResultPresentation } from '@/components/arena/components/BattleResultPresentation';

vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: vi.fn() }));

const source = '<!doctype html><html><body><button onclick="this.textContent=123">互动</button></body></html>';
const sourceWithNotes = [
  '下面是本场特别战报。',
  '',
  source,
  '',
  '希望你喜欢这场战斗。',
  '<!-- MAHOSHOJO_ARENA_META {"version":1} -->',
].join('\n');
let container: HTMLDivElement;
let root: Root;
const click = async (text: string) => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
};
const viewer = (roomId: string, ready = true, content = source) => (
  <ArenaWebReport key={roomId} roomId={roomId} ready={ready} content={content}>
    {(web, actions) => <section>
      {web ?? <div data-testid="ordinary">{content}</div>}
      <div className="buttons-container">{actions}</div>
    </section>}
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
  it('Web 与普通显示的操作均位于真实战报卡片的同一个底部操作栏', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.card-actions', 'accepted');
    await act(async () => root.render(<BattleResultPresentation
      report={{ format: 'stream-web', content: source, webReady: true, webConsentScope: 'card-actions' }}
      onSaveImage={vi.fn()}
    />));
    const frame = container.querySelector('iframe')!;
    const toolbar = container.querySelector('.buttons-container')!;
    expect(toolbar.parentElement?.contains(frame)).toBe(true);
    expect(toolbar.textContent).toContain('重新加载');
    expect(toolbar.textContent).toContain('下载 HTML');
    expect(toolbar.textContent).not.toContain('保存为图片');
    expect(toolbar.textContent).not.toContain('下载记录');
    await click('普通显示');
    expect(container.querySelectorAll('.buttons-container')).toHaveLength(1);
    expect(toolbar.isConnected).toBe(true);
    expect(toolbar.textContent).toContain('保存为图片');
    expect(toolbar.textContent).toContain('下载记录');
    expect(toolbar.textContent).toContain('下载 HTML');
    expect(toolbar.textContent).not.toContain('重新加载');
  });

  it('仅完整战报可下载 HTML；取消执行后仍可下载，保留脚本并移除机器 meta', async () => {
    const content = `${source}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"winner":"甲"}} -->`;
    await act(async () => root.render(viewer('download', false, content)));
    await click('🌐 下载 HTML');
    expect(downloadBlob).not.toHaveBeenCalled();
    await act(async () => root.render(viewer('download', true, content)));
    await click('取消');
    expect(container.querySelector('legend')?.textContent).toBe('显示方式');
    expect(container.querySelector('[data-testid="ordinary"]')?.nextElementSibling?.classList.contains('buttons-container')).toBe(true);
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

  it('只把 canonical HTML 放入 iframe 和下载文件，前后附言默认折叠但可展开', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.notes', 'accepted');
    await act(async () => root.render(viewer('notes', true, sourceWithNotes)));

    const frame = document.querySelector('iframe')!;
    expect(frame.srcdoc).toBe(source);
    expect(frame.srcdoc).not.toContain('下面是本场特别战报');
    expect(frame.srcdoc).not.toContain('MAHOSHOJO_ARENA_META');

    const notes = container.querySelector('[data-testid="arena-web-notes"]')!;
    expect(notes.textContent).toContain('AI 附言（2 段）');
    expect(notes.textContent).not.toContain('下面是本场特别战报');
    await act(async () => (notes.querySelector('button') as HTMLButtonElement).click());
    expect(notes.textContent).toContain('下面是本场特别战报');
    expect(notes.textContent).toContain('希望你喜欢这场战斗');

    await click('🌐 下载 HTML');
    const [blob] = vi.mocked(downloadBlob).mock.calls[0];
    const downloaded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(downloaded).toBe(source);
  });

  it('沉浸显示保持同一个 iframe，并在原生全屏不可用时保留 CSS fallback', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.immersive', 'accepted');
    await act(async () => root.render(viewer('immersive', true, source)));

    const originalFrame = document.querySelector('iframe');
    expect(originalFrame).toBeTruthy();
    await click('⛶ 沉浸显示');
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeTruthy();
    expect(document.querySelector('iframe')).toBe(originalFrame);
    expect(document.querySelector('iframe')?.getAttribute('allow')).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    expect(container.querySelector('.buttons-container')?.textContent).toBe('');

    await click('× 退出沉浸');
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeNull();
    expect(document.querySelector('iframe')).toBe(originalFrame);
    expect(document.body.style.overflow).toBe('');
    expect(container.querySelector('.buttons-container')?.textContent).toContain('⛶ 沉浸显示');
  });

  it('CSS 沉浸 fallback 可通过 Escape 退出', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.immersive-escape', 'accepted');
    await act(async () => root.render(viewer('immersive-escape', true, source)));
    await click('⛶ 沉浸显示');
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('战报离开可执行状态时会自动退出沉浸并恢复页面滚动', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.lifecycle', 'accepted');
    await act(async () => root.render(viewer('lifecycle', true, source)));
    await click('⛶ 沉浸显示');
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeTruthy();

    await act(async () => root.render(viewer('lifecycle', false, source)));
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
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
    expect(container.querySelector('.buttons-container')?.textContent).toContain('↻ 重新加载');
    await click('↻ 重新加载');
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

  it('完整但不含 HTML 的输出不会请求 Web 执行许可', async () => {
    await act(async () => root.render(viewer('malformed-ready', true, '这是一段普通说明。')));

    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="ordinary"]')).toBeTruthy();
    expect(container.textContent).toContain('没有包含完整的 HTML 文档');

    await click('Web 显示');
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
