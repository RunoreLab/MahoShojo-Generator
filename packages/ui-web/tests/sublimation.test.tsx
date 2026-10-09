// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SublimationPageFrame, SublimationPageHeader, SublimationTargetField, SublimationGuidanceField, SublimationNarrativeField, SublimationPreserveFields, SublimationCurrentStateFieldset, SublimationArenaHistoryStrategyFieldset, getDefaultPreserveFields, getPersonalityPreset } from '../src/sublimation';
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Web/Desktop actual Sublimation views', () => {
  it('keeps host result outside the input card, slots footer and uses the same brand and handbook links', () => {
    const navigate = vi.fn();
    act(() => root.render(<SublimationPageFrame afterContainer={<footer>页脚</footer>}><div className="card"><SublimationPageHeader onNavigate={navigate} resolveInternalHref={(href) => `#${href}`} loreEnabled={false} /></div><section aria-label="result">结果</section></SublimationPageFrame>));
    expect(container.querySelector('.container > .card')!.contains(container.querySelector('[aria-label="result"]'))).toBe(false);
    expect(container.querySelector('footer')!.parentElement?.className).toBe('magic-background-white');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/sublimation.svg');
    expect(container.textContent).not.toContain('Lore');
    const link = container.querySelector<HTMLAnchorElement>('a[href="#/encyclopedia/sublimation"]')!;
    act(() => link.click()); expect(navigate).toHaveBeenCalledWith('/encyclopedia/sublimation');
  });
  it('shares target choices and cross-template warnings through a controlled callback', () => {
    const onChange = vi.fn(); act(() => root.render(<SublimationTargetField targetTemplate="general" sourceTemplateLabel="残兽" hasCrossTemplateSelection disabled={false} onChange={onChange} />));
    expect([...container.querySelectorAll('option')].map((item) => item.value)).toEqual(['magical-girl', 'canshou', 'general']);
    expect(container.textContent).toContain('系统已自动取消所有');
    const select = container.querySelector('select')!; act(() => { select.value = 'magical-girl'; select.dispatchEvent(new Event('change', { bubbles: true })); }); expect(onChange).toHaveBeenCalledWith('magical-girl');
    expect(container.querySelector('label')?.htmlFor).toBe(select.id);
  });
  it('keeps growth guidance autofill protections and host warnings alongside narrative actions', () => {
    const clear = vi.fn(); act(() => root.render(<><SublimationGuidanceField value="守护" onChange={clear} disabled={false}><p>签名来源提醒</p></SublimationGuidanceField><SublimationNarrativeField value="经历" onChange={vi.fn()} disabled={false}><button>选择本地历史</button></SublimationNarrativeField></>));
    const input = container.querySelector('input')!; expect(input.maxLength).toBe(200); expect(input.autocomplete).toBe('new-password'); expect(input.getAttribute('data-1p-ignore')).toBe('true');
    act(() => container.querySelector('button')!.click()); expect(clear).toHaveBeenCalledWith('');
    expect(container.querySelector('textarea')?.value).toBe('经历'); expect(container.textContent).toContain('签名来源提醒'); expect(container.textContent).toContain('选择本地历史');
  });
  it('retains Web preserve presets and disables every preservation control while busy', () => {
    const preset = vi.fn(); const props = { expanded: true, hasSource: true, disabled: false, onToggle: vi.fn(), targetTemplate: 'general' as const, fieldsToPreserve: ['name'], allowReshapeNames: false, onAllowReshapeNamesChange: vi.fn(), onFieldChange: vi.fn(), onPreset: preset };
    act(() => root.render(<SublimationPreserveFields {...props} />)); expect(getDefaultPreserveFields('magical-girl')).toEqual(['wonderlandRule', 'blooming']); expect(getPersonalityPreset('general')).toEqual(['name']);
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '完全重塑')!.click()); expect(preset).toHaveBeenCalledWith('full');
    act(() => root.render(<SublimationPreserveFields {...props} disabled />)); expect([...container.querySelectorAll('input,button')].every((item) => item.matches(':disabled'))).toBe(true);
  });
  it('stream mode discloses the unchanged state boundary and leaves the non-stream write preference intact', () => {
    const props = { readCurrentState: true, writeCurrentState: true, disabled: false, onReadChange: vi.fn(), onWriteChange: vi.fn() };
    act(() => root.render(<SublimationCurrentStateFieldset {...props} streamMode />)); const inputs = container.querySelectorAll('input'); expect(inputs[0]?.disabled).toBe(false); expect(inputs[1]?.disabled).toBe(true); expect(inputs[1]?.checked).toBe(false); expect(container.textContent).toContain('不根据 Markdown 更新结构化状态');
    act(() => root.render(<SublimationCurrentStateFieldset {...props} />)); expect(container.querySelectorAll('input')[1]?.checked).toBe(true); expect(props.onWriteChange).not.toHaveBeenCalled();
  });
  it('retention options use the shared domain labels and host callbacks', () => {
    const retention = vi.fn(); act(() => root.render(<SublimationArenaHistoryStrategyFieldset readArenaHistory writeArenaHistory retentionStrategy="keep-all" disabled={false} onReadArenaHistoryChange={vi.fn()} onWriteArenaHistoryChange={vi.fn()} onRetentionStrategyChange={retention} />));
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    act(() => container.querySelector<HTMLInputElement>('input[value="reset-all"]')!.click()); expect(retention).toHaveBeenCalledWith('reset-all');
  });
});
