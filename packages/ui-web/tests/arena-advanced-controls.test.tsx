// @vitest-environment jsdom
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdjudicatorSettingsPanel, AdvancedArenaHeaderView, AdvancedArenaPageView, ArenaEditorWorkspaceLayout, QuestionnaireLorePanel, type QuestionnaireLoreActionResult } from '../src/arena';
import { CollapsibleSection } from '../src/creator';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;
async function render(element: ReactElement) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(element)); }
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); localStorage.clear(); });
async function click(text: string) { const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text)); expect(button).toBeTruthy(); await act(async () => button!.click()); }
function selection(id: string): QuestionnaireSelection { return { selectionId: id, source: 'upload', questionnaire: { id, kind: 'magical-girl', title: id, questions: [], loreMarkdown: `Lore ${id}`, nativeAllowed: false } }; }
async function input(element: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
describe('advanced Arena shared controls', () => {
  it('keeps Web defaults and storage while controlled hosts own persistence', async () => {
    localStorage.setItem('web-existing-key', '0');
    function Page() { const [open, setOpen] = useState(true); return <AdvancedArenaPageView header="高级标题"><ArenaEditorWorkspaceLayout sections={[
      { kind: 'web', title: 'Web 折叠', description: '', column: 'left', storageKey: 'web-existing-key', content: <input aria-label="kept" defaultValue="draft" />, keepMounted: true },
      { kind: 'desktop', title: '本地折叠', description: '', column: 'right', storageKey: 'ignored', open, onOpenChange: setOpen, content: '本地内容' },
    ]} /></AdvancedArenaPageView>; }
    await render(<Page />); expect(container.querySelector('[aria-label="kept"]')?.parentElement?.hidden).toBe(true);
    await click('Web 折叠'); expect(localStorage.getItem('web-existing-key')).toBe('1');
    await click('本地折叠'); expect(container.textContent).not.toContain('本地内容'); expect(localStorage.getItem('ignored')).toBeNull(); expect(container.querySelector('.arena-page-shell')).not.toBeNull();
  });
  it('preserves Creator autoOpen and noncollapsible behavior', async () => {
    await render(<CollapsibleSection title="Creator" defaultOpen={false} autoOpen><input /></CollapsibleSection>); expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    await act(async () => root.render(<CollapsibleSection title="Creator" collapsible={false} defaultOpen={false}>fixed</CollapsibleSection>)); expect(container.textContent).toContain('fixed'); expect(container.querySelector('button')?.disabled).toBe(true);
  });
  it('disabled adjudicator blocks keyboard/form input and normalization writes', async () => {
    const changed = vi.fn(); await render(<AdjudicatorSettingsPanel events={[]} onEventsChange={changed} disabled />); const button = container.querySelector('fieldset button') as HTMLButtonElement;
    expect(button.matches(':disabled')).toBe(true); await act(async () => button.click()); expect(changed).not.toHaveBeenCalled();
  });
  it('Lore controls dispatch enable, order, details, remove and preset actions', async () => {
    const toggle = vi.fn(), move = vi.fn(), remove = vi.fn(), preset = vi.fn(), details = vi.fn();
    await render(<QuestionnaireLorePanel selectedQuestionnaires={[selection('A'), selection('B')]} presets={[{ id: 'preset', title: '预设' }]} referenceItemCount={2} maxReferenceItems={256} onAddPreset={preset} onPaste={vi.fn()} onClear={vi.fn()} onRemove={remove} onToggleLore={toggle} onMove={move} onDetails={details} />);
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); expect(toggle).toHaveBeenCalledWith('A', false);
    await act(async () => (container.querySelector('[aria-label="下移 A"]') as HTMLButtonElement).click()); expect(move).toHaveBeenCalledWith('A', 'down');
    await click('详情'); expect(details).toHaveBeenCalledWith(selection('A')); await click('移除'); expect(remove).toHaveBeenCalledWith('A');
    await act(async () => { const select = container.querySelector('select')!; select.value = 'preset'; select.dispatchEvent(new Event('change', { bubbles: true })); }); expect(preset).toHaveBeenCalledWith('preset');
  });
  it('Lore paste protects dirty text, reports busy and rejects repeated imports', async () => {
    let reject!: (reason: Error) => void; const paste = vi.fn(() => new Promise<void>((_resolve, failed) => { reject = failed; })); const dirty = vi.fn(), busy = vi.fn(), discard = vi.fn(() => false);
    await render(<QuestionnaireLorePanel selectedQuestionnaires={[]} presets={[]} referenceItemCount={0} maxReferenceItems={256} onAddPreset={vi.fn()} onPaste={paste} onClear={vi.fn()} onRemove={vi.fn()} onToggleLore={vi.fn()} onDirtyChange={dirty} onBusyChange={busy} requestDiscard={discard} />);
    await click('粘贴 JSON'); const textarea = container.querySelector('textarea')!; await input(textarea, '{"lore":"draft"}'); expect(dirty).toHaveBeenLastCalledWith(true);
    await click('收起粘贴'); expect(discard).toHaveBeenCalledOnce(); expect(textarea.value).toContain('draft'); await click('导入'); await click('导入'); expect(paste).toHaveBeenCalledOnce(); expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => reject(new Error('保留输入'))); expect(textarea.value).toContain('draft'); expect(container.textContent).toContain('保留输入'); expect(busy).toHaveBeenLastCalledWith(false);
  });
  it('Lore discard confirmation locks controls until the asynchronous decision returns', async () => {
    let decide!: (approved: boolean) => void;
    const discard = vi.fn(() => new Promise<boolean>((resolve) => { decide = resolve; }));
    const paste = vi.fn(), busy = vi.fn();
    await render(<QuestionnaireLorePanel selectedQuestionnaires={[]} presets={[]} referenceItemCount={0} maxReferenceItems={256} onAddPreset={vi.fn()} onPaste={paste} onClear={vi.fn()} onRemove={vi.fn()} onToggleLore={vi.fn()} onBusyChange={busy} requestDiscard={discard} />);
    await click('粘贴 JSON'); const field = container.querySelector('textarea')!; await input(field, 'protected source');
    await click('收起粘贴'); expect(field.disabled).toBe(true); expect(busy).toHaveBeenLastCalledWith(true);
    await click('收起粘贴'); await click('导入'); expect(discard).toHaveBeenCalledOnce(); expect(paste).not.toHaveBeenCalled();
    await act(async () => decide(false)); expect(field.disabled).toBe(false); expect(field.value).toBe('protected source'); expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('cancelled Lore import retains dirty paste without errors and allows explicit retry', async () => {
    let finish!: (result: QuestionnaireLoreActionResult) => void;
    const paste = vi.fn(() => new Promise<QuestionnaireLoreActionResult>((resolve) => { finish = resolve; }));
    const dirty = vi.fn(), busy = vi.fn();
    await render(<QuestionnaireLorePanel selectedQuestionnaires={[]} presets={[]} referenceItemCount={0} maxReferenceItems={256} onAddPreset={vi.fn()} onPaste={paste} onClear={vi.fn()} onRemove={vi.fn()} onToggleLore={vi.fn()} onDirtyChange={dirty} onBusyChange={busy} />);
    await click('粘贴 JSON'); const field = container.querySelector('textarea')!; await input(field, '{"lore":"retained source"}');
    await click('导入'); expect(field.disabled).toBe(true); expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => finish({ cancelled: true }));
    expect(field.value).toBe('{"lore":"retained source"}'); expect(field.disabled).toBe(false);
    expect(dirty).toHaveBeenLastCalledWith(true); expect(busy).toHaveBeenLastCalledWith(false); expect(container.querySelector('.text-red-600')).toBeNull();
    expect(paste).toHaveBeenCalledOnce();
    await click('导入'); expect(paste).toHaveBeenCalledTimes(2); expect(paste).toHaveBeenLastCalledWith('{"lore":"retained source"}');
    await act(async () => finish(undefined)); expect(container.querySelector('textarea')).toBeNull(); expect(dirty).toHaveBeenLastCalledWith(false); expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('advanced hero shares full markup and controlled guide without lite chrome or storage writes', async () => {
    function Header() { const [open, setOpen] = useState(true); return <AdvancedArenaHeaderView logo={<span>full logo</span>} description="高级单次" guideChildren={<a href="/battle">简洁页入口</a>} guideOpen={open} onGuideOpenChange={setOpen} guideStorageKey="unused" />; }
    await render(<Header />); expect(container.querySelector('.subtitle')?.textContent).toBe('高级单次'); expect(container.querySelector('.battle-lite-hero-card')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/battle'); await click('使用须知'); expect(container.querySelector('a')).toBeNull(); expect(localStorage.getItem('unused')).toBeNull();
  });

});
