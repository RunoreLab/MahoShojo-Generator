// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattleStoryContentPreview, BATTLE_STORY_CONTENT_PREVIEW_CHARACTERS, formatBattleStoryDisplayTitle } from '../src/arena-story-session';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('story content display guard', () => {
  it('renders ordinary content and the exact threshold without an extra DOM wrapper', async () => {
    await act(async () => root.render(<BattleStoryContentPreview characterCount={BATTLE_STORY_CONTENT_PREVIEW_CHARACTERS}><article>原卡片</article></BattleStoryContentPreview>));
    expect(container.innerHTML).toBe('<article>原卡片</article>');
  });

  it('does not mount a large child until explicitly opened, preserves every character, and supports collapse', async () => {
    const content = '原'.repeat(BATTLE_STORY_CONTENT_PREVIEW_CHARACTERS + 1) + '结尾';
    const parsed = vi.fn(); const exported = vi.fn();
    function Card() { parsed(content); return <article>{content}</article>; }
    const render = (id: string) => root.render(<BattleStoryContentPreview key={id} characterCount={content.length} exportAction={<button onClick={() => exported(content)}>直接导出</button>}><Card /></BattleStoryContentPreview>);
    await act(async () => render('A'));
    expect(parsed).not.toHaveBeenCalled(); expect(container.querySelector('article')).toBeNull();
    expect(container.textContent).toContain('正文完整保留');
    await act(async () => container.querySelectorAll('button')[1]!.click());
    expect(exported).toHaveBeenCalledExactlyOnceWith(content); expect(parsed).not.toHaveBeenCalled();
    await act(async () => container.querySelector('button')!.click());
    expect(parsed).toHaveBeenCalledExactlyOnceWith(content); expect(container.querySelector('article')?.textContent).toBe(content);
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('article')).toBeNull();
    await act(async () => container.querySelector('button')!.click());
    await act(async () => render('B'));
    expect(container.querySelector('article')).toBeNull(); expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('collapses when an unexpanded live stream crosses the display threshold', async () => {
    const render = (count: number) => root.render(<BattleStoryContentPreview characterCount={count}><article>当前流</article></BattleStoryContentPreview>);
    await act(async () => render(BATTLE_STORY_CONTENT_PREVIEW_CHARACTERS)); expect(container.querySelector('article')).not.toBeNull();
    await act(async () => render(BATTLE_STORY_CONTENT_PREVIEW_CHARACTERS + 1)); expect(container.querySelector('article')).toBeNull();
  });
});

describe('bounded story display titles', () => {
  it.each(['', '普通标题', 'a'.repeat(192), '😀'.repeat(48)])('keeps fitting original text unchanged', (value) => {
    expect(formatBattleStoryDisplayTitle(value)).toBe(value);
  });

  it.each(['a'.repeat(193), '标题'.repeat(80), 'a'.repeat(170) + '😀'.repeat(20), '\ud800'.repeat(65)])('fits the UTF-8 display budget with an explicit marker', (value) => {
    const display = formatBattleStoryDisplayTitle(value);
    expect(new TextEncoder().encode(display).length).toBeLessThanOrEqual(192);
    expect(display.endsWith('…（标题已缩短）')).toBe(true); expect(display).not.toBe(value);
  });

  it('only scans a bounded prefix of a multi-MiB title and does not split emoji', () => {
    const original = '😀'.repeat(1024 * 1024) + '保留末尾';
    const scan = vi.spyOn(String.prototype, 'codePointAt');
    const display = formatBattleStoryDisplayTitle(original);
    expect(scan.mock.calls.length).toBeLessThan(100);
    expect(display.endsWith('…（标题已缩短）')).toBe(true);
    expect(new TextDecoder().decode(new TextEncoder().encode(display))).toBe(display);
    expect(original.endsWith('保留末尾')).toBe(true);
  });
});
