// @vitest-environment jsdom
import { act, useId, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TavernTabs, TavernTabPanels, parseTavernLogoViewBoxRatio, type TavernTab } from '../src/tavern';
let root: Root; let container: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('shared Tavern tab lifecycle', () => {
  it('mounts only visited panels and preserves edits with isolated ARIA IDs', () => {
    const mounted = vi.fn();
    function Editor() { const [text, setText] = useState('original'); mounted(); return <input aria-label="draft" value={text} onChange={(event) => setText(event.target.value)} />; }
    function Harness() { const id = useId(); const [tab, setTab] = useState<TavernTab>('import'); return <><TavernTabs idPrefix={id} tab={tab} onChange={setTab} /><TavernTabPanels idPrefix={id} tab={tab} importPanel={<p>import data</p>} exportPanel={<Editor />} /></>; }
    act(() => root.render(<><Harness /><Harness /></>)); expect(mounted).not.toHaveBeenCalled();
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role=tab]')]; expect(new Set(tabs.map((tab) => tab.id)).size).toBe(4);
    act(() => tabs[1].click()); const draft = container.querySelector<HTMLInputElement>('input')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(draft, 'edited'); draft.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => tabs[0].click()); expect(draft.closest<HTMLElement>('[role=tabpanel]')!.hidden).toBe(true);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById(tabs[0].getAttribute('aria-controls')!)?.getAttribute('aria-labelledby')).toBe(tabs[0].id);
    act(() => tabs[1].click()); expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('edited');
  });
  it('supports arrow navigation and blocks switching during an operation', () => {
    function Harness() { const id = useId(); const [tab, setTab] = useState<TavernTab>('import'); const [busy, setBusy] = useState(false); return <><button onClick={() => setBusy(true)}>busy</button><TavernTabs idPrefix={id} tab={tab} onChange={setTab} disabled={busy} /><TavernTabPanels idPrefix={id} tab={tab} importPanel="import" exportPanel="export" /></>; }
    act(() => root.render(<Harness />)); const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    act(() => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(tabs[1]);
    act(() => container.querySelector('button')!.click()); expect(tabs.every((tab) => tab.disabled)).toBe(true);
    act(() => tabs[0].click()); expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });
  it('parses actual SVG viewBox whitespace and defaults invalid dimensions', () => {
    expect(parseTavernLogoViewBoxRatio('<svg viewBox="0 0 200 100"/>')).toBe(0.5);
    expect(parseTavernLogoViewBoxRatio('<svg viewBox = "0,0,100,200"/>')).toBe(2);
    expect(parseTavernLogoViewBoxRatio('<svg viewBox="0 0 0 10"/>')).toBe(1);
  });
});
