// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { SublimationLoreSelection, type SublimationLoreSelectionProps } from '../src/sublimation';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function selection(overrides: Partial<QuestionnaireSelection> = {}): QuestionnaireSelection {
  return {
    source: 'preset',
    selectionId: 'selection-1',
    questionnaire: {
      id: 'lore-1',
      kind: 'magical-girl',
      title: '星海设定',
      loreMarkdown: '星海中的守护者',
      nativeAllowed: true,
      questions: [],
    },
    ...overrides,
  };
}

function props(overrides: Partial<SublimationLoreSelectionProps> = {}): SublimationLoreSelectionProps {
  return {
    expanded: true,
    onExpandedChange: vi.fn(),
    disabled: false,
    selections: [],
    presets: [{ id: 'preset-1', kind: 'magical-girl', title: '基础设定' }, { id: 'preset-2', kind: 'canshou', title: '残兽设定' }],
    onSelectPreset: vi.fn(),
    onUpload: vi.fn(),
    onOpenPicker: vi.fn(),
    onToggleLore: vi.fn(),
    onRemove: vi.fn(),
    onDetails: vi.fn(),
    pasteExpanded: false,
    onPasteExpandedChange: vi.fn(),
    pasteText: '',
    onPasteTextChange: vi.fn(),
    onPasteImport: vi.fn(),
    onPasteClear: vi.fn(),
    ...overrides,
  };
}

function button(label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

describe('Sublimation shared Lore selection', () => {
  it('uses host-controlled accessible disclosures, with stable unique targets', () => {
    const input = props({ expanded: false });
    act(() => root.render(<SublimationLoreSelection {...input} />));
    const disclosure = container.querySelector('button')!;
    const panelId = disclosure.getAttribute('aria-controls')!;
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(panelId)?.hidden).toBe(true);
    expect(container.querySelector('select')).toBeNull();
    act(() => disclosure.click());
    expect(input.onExpandedChange).toHaveBeenCalledWith(true);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');

    act(() => root.render(<SublimationLoreSelection {...input} expanded />));
    expect(disclosure.getAttribute('aria-controls')).toBe(panelId);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(panelId)?.hidden).toBe(false);
    expect(container.textContent).toContain('暂无设定来源');
    const pasteDisclosure = button('粘贴导入 JSON');
    expect(pasteDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(pasteDisclosure.getAttribute('aria-controls')!)?.hidden).toBe(true);
    act(() => pasteDisclosure.click());
    expect(input.onPasteExpandedChange).toHaveBeenCalledWith(true);
    expect(container.querySelector('textarea')).toBeNull();

    act(() => root.render(<><SublimationLoreSelection {...input} expanded pasteExpanded /><SublimationLoreSelection {...input} expanded pasteExpanded /></>));
    const ids = [...container.querySelectorAll('[id]')].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const control of container.querySelectorAll('[aria-controls]')) {
      expect(document.getElementById(control.getAttribute('aria-controls')!)).not.toBeNull();
    }
  });

  it('shows selection provenance and forwards instance-specific controls without mutating selection', () => {
    const first = selection();
    const second = selection({ selectionId: 'selection-2', source: 'database', dataCardAuthor: '作者', useLore: false });
    const input = props({ selections: [first, second] });
    act(() => root.render(<SublimationLoreSelection {...input} />));
    expect(container.textContent).toContain('来源：预设 · 原生许可');
    expect(container.textContent).toContain('来源：云端问卷 · 作者：作者 · 原生许可');
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    act(() => checkboxes[1].click());
    expect(input.onToggleLore).toHaveBeenCalledWith('selection-2', true);
    const details = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="查看"]');
    const remove = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="移除"]');
    act(() => { details[1].click(); remove[1].click(); });
    expect(input.onDetails).toHaveBeenCalledWith(second);
    expect(input.onRemove).toHaveBeenCalledWith('selection-2');
    expect(second.useLore).toBe(false);
    expect(input.selections).toHaveLength(2);
  });

  it('falls back to the questionnaire id and disables only empty Lore, not non-native Lore', () => {
    const empty = selection({ selectionId: undefined, questionnaire: { ...selection().questionnaire, loreMarkdown: '  ' } });
    const uploaded = selection({ selectionId: 'upload-1', source: 'upload' });
    const input = props({ selections: [empty, uploaded] });
    act(() => root.render(<SublimationLoreSelection {...input} />));
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes[0].disabled).toBe(true);
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].disabled).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    expect(container.textContent).toContain('无设定');
    expect(container.textContent).toContain('来源：本地上传 · 非原生');
    expect(container.textContent).not.toContain('来源：本地上传 · 原生许可');
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label^="移除"]')!.click());
    expect(input.onRemove).toHaveBeenCalledWith('lore-1');
  });

  it('forwards presets, file imports and library opening, allowing repeated imports', () => {
    const input = props({ pickerLabel: '从本地/公共卡库选择' });
    act(() => root.render(<SublimationLoreSelection {...input} />));
    const select = container.querySelector('select')!;
    expect(select.getAttribute('aria-label')).toBe('选择预设问卷/设定卡');
    expect([...select.options].map((option) => option.textContent)).toEqual(['选择预设问卷/设定卡', '魔法少女 · 基础设定', '残兽 · 残兽设定']);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      act(() => {
        select.value = 'preset-2';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(select.value).toBe('');
    }
    expect(input.onSelectPreset).toHaveBeenNthCalledWith(1, 'preset-2');
    expect(input.onSelectPreset).toHaveBeenNthCalledWith(2, 'preset-2');
    const upload = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(upload.classList.contains('hidden')).toBe(false);
    expect(upload.closest('label')?.textContent).toContain('上传问卷 JSON');
    const file = new File(['{"loreMarkdown":"星海"}'], 'lore.json', { type: 'application/json' });
    Object.defineProperty(upload, 'files', { configurable: true, value: [file] });
    act(() => upload.dispatchEvent(new Event('change', { bubbles: true })));
    expect(input.onUpload).toHaveBeenCalledWith(file);
    expect(upload.value).toBe('');
    Object.defineProperty(upload, 'files', { configurable: true, value: [] });
    act(() => upload.dispatchEvent(new Event('change', { bubbles: true })));
    expect(input.onUpload).toHaveBeenLastCalledWith(null);
    act(() => button('从本地/公共卡库选择').click());
    expect(input.onOpenPicker).toHaveBeenCalledOnce();
  });

  it('keeps paste text, parsing, clearing, and errors under host control', () => {
    const input = props({ pasteExpanded: true, pasteText: '{invalid}', pasteError: 'JSON 格式错误', loadError: '预设加载失败' });
    act(() => root.render(<SublimationLoreSelection {...input} />));
    const textarea = container.querySelector('textarea')!;
    expect(textarea.value).toBe('{invalid}');
    expect(container.querySelector(`label[for="${textarea.id}"]`)?.textContent).toBe('粘贴问卷 JSON');
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(textarea.getAttribute('aria-describedby')!)?.textContent).toBe('JSON 格式错误');
    expect([...container.querySelectorAll('[role="alert"]')].map((item) => item.textContent)).toEqual(['JSON 格式错误', '预设加载失败']);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '{"loreMarkdown":"星海"}');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.onPasteTextChange).toHaveBeenCalledWith('{"loreMarkdown":"星海"}');
    act(() => { button('解析并载入').click(); button('清空').click(); button('收起粘贴导入').click(); });
    expect(input.onPasteImport).toHaveBeenCalledOnce();
    expect(input.onPasteClear).toHaveBeenCalledOnce();
    expect(input.onPasteExpandedChange).toHaveBeenCalledWith(false);
    expect(textarea.value).toBe('{invalid}');
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    act(() => root.render(<SublimationLoreSelection {...input} pasteText="" pasteError={null} loadError={null} />));
    expect(textarea.value).toBe('');
    expect(textarea.hasAttribute('aria-invalid')).toBe(false);
    expect(textarea.hasAttribute('aria-describedby')).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders host token guidance and native warning without blocking source selection', () => {
    const input = props({ selections: [selection({ source: 'upload' })], tokenIndicator: <p>估算 120 tokens</p>, warnNonNative: true });
    act(() => root.render(<SublimationLoreSelection {...input} />));
    expect(container.textContent).toContain('估算 120 tokens');
    expect(container.textContent).toContain('已注入非原生许可的问卷设定');
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(false);
    act(() => root.render(<SublimationLoreSelection {...input} tokenIndicator={null} warnNonNative={false} />));
    expect(container.textContent).not.toContain('估算 120 tokens');
    expect(container.textContent).not.toContain('已注入非原生许可的问卷设定');
  });

  it('disables all mutation controls while generating and restores them afterwards', () => {
    const input = props({ disabled: true, selections: [selection()], pasteExpanded: true });
    act(() => root.render(<SublimationLoreSelection {...input} />));
    const controls = container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input,select,textarea,button');
    expect(controls.length).toBeGreaterThan(8);
    expect([...controls].every((control) => control.disabled)).toBe(true);
    act(() => container.querySelectorAll('button').forEach((control) => control.click()));
    for (const value of Object.values(input)) {
      if (typeof value === 'function') expect(value).not.toHaveBeenCalled();
    }
    act(() => root.render(<SublimationLoreSelection {...input} disabled={false} />));
    expect([...container.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')].every((control) => !control.disabled)).toBe(true);
    act(() => button('解析并载入').click());
    expect(input.onPasteImport).toHaveBeenCalledOnce();
  });

  it('only offers an editor when the host provides navigation and preserves modified link clicks', () => {
    const input = props();
    act(() => root.render(<SublimationLoreSelection {...input} />));
    expect(container.querySelector('a')).toBeNull();
    const onNavigate = vi.fn();
    act(() => root.render(<SublimationLoreSelection {...input} editorNavigation={{ onNavigate }} />));
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/questionnaire-editor');
    act(() => link.click());
    expect(onNavigate).toHaveBeenCalledWith('/questionnaire-editor');
    onNavigate.mockClear();
    const prevented: boolean[] = [];
    const preventBrowserNavigation = (event: Event) => { prevented.push(event.defaultPrevented); event.preventDefault(); };
    container.addEventListener('click', preventBrowserNavigation);
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      act(() => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true })));
    }
    expect(onNavigate).not.toHaveBeenCalled();
    expect(prevented).toEqual([false, false, false, false]);
    container.removeEventListener('click', preventBrowserNavigation);
  });
});
