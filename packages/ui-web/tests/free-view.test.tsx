// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FreePageLayout, FreeSchemaFields, FreePromptField, FreeLanguageField, FreeAttachmentPanel, FreeResultPanel, FreeResultActions, FreeJsonResult, type UseFreeAttachmentsResult, type AttachmentReadResult, useFreeAttachments, freeSchemaOptionsForMode } from '../src/free/index';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('shares input/preview layout without a runtime flag and replaces the empty preview with real output', () => {
  act(() => root.render(<FreePageLayout controls={<textarea defaultValue="保留输入" />} footer={<footer>页脚</footer>} />));
  const preview = container.querySelector('[data-testid="free-preview"]')!;
  expect(preview.textContent).toContain('预览区');
  expect(preview.parentElement?.className).toContain('lg:grid-cols-2');
  expect(preview.parentElement?.parentElement?.className).toContain('lg:!max-w-[1200px]');
  expect(container.querySelector('.container > footer')).not.toBeNull();
  act(() => root.render(<FreePageLayout controls={<textarea defaultValue="保留输入" />} result={<div role="status">部分输出</div>} />));
  expect(preview.textContent).not.toContain('预览区');
  expect(preview.textContent).toContain('部分输出');
  expect(container.querySelector('textarea')?.value).toBe('保留输入');
});

it('renders the effective schema options and delegates selection and guide actions without resetting inputs', () => {
  const change = vi.fn(); const toggle = vi.fn();
  act(() => root.render(<FreeSchemaFields schemaId="general" options={freeSchemaOptionsForMode('stream')} onChange={change} showFieldGuide={false} onToggleFieldGuide={toggle} />));
  const select = container.querySelector('select')!;
  expect([...select.options].map((option) => option.value)).toEqual(['general', 'general-scenario']);
  act(() => { select.value = 'general-scenario'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(change).toHaveBeenCalledWith('general-scenario');
  act(() => container.querySelector('button')!.click());
  expect(toggle).toHaveBeenCalledOnce();
  act(() => root.render(<FreeSchemaFields schemaId="magical-girl" options={freeSchemaOptionsForMode('non-stream')} onChange={change} showFieldGuide onToggleFieldGuide={toggle} disabled />));
  expect(container.querySelector('select')!.options).toHaveLength(5);
  expect(container.querySelector('select')!.disabled).toBe(true);
  expect(container.textContent).toContain('codename');
});

it('keeps long prompt content, host actions and transport-limit explanations visible', () => {
  const prompt = '长提示词'.repeat(5000); const change = vi.fn(); const save = vi.fn();
  act(() => root.render(<FreePromptField value={prompt} onChange={change} actions={<button onClick={save}>保存</button>} hint="本次请求上限" />));
  expect(container.querySelector('textarea')!.value).toBe(prompt);
  expect(container.querySelector('textarea')!.hasAttribute('maxlength')).toBe(false);
  expect(container.textContent).toContain(`字符数：${prompt.length}`);
  expect(container.textContent).toContain('本次请求上限');
  act(() => container.querySelector('button')!.click()); expect(save).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
});

it('keeps language choices controlled and the host-provided fallback intact', () => {
  const change = vi.fn();
  act(() => root.render(<FreeLanguageField value="zh-CN" languages={[{ code: 'zh-CN', name: '中文' }]} expanded onToggle={vi.fn()} onChange={change} />));
  expect(container.querySelector('select')!.value).toBe('zh-CN');
  act(() => root.render(<FreeLanguageField value="zh-CN" languages={[]} expanded={false} onToggle={vi.fn()} onChange={change} />));
  expect(container.querySelector('select')).toBeNull();
  expect(change).not.toHaveBeenCalled();
});


it('renders the same attachment metadata and keeps discard actions available during a read', () => {
  const state: UseFreeAttachmentsResult = {
    items: [{ id: 'a', name: '参考.txt', type: 'text/plain', size: 20, includedBytes: 3, content: 'abc', truncated: true }],
    isReading: true, error: null, inputRef: createRef<HTMLInputElement>(), totalChars: 3, totalBytes: 3,
    addFiles: vi.fn(async () => {}), remove: vi.fn(), clear: vi.fn(),
  };
  act(() => root.render(<FreeAttachmentPanel state={state} />));
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
  expect(container.textContent).toContain('参考.txt');
  expect(container.textContent).toContain('已截断');
  expect(container.textContent).toContain('text/plain');
  expect(container.textContent).toContain('正在读取附件');
  const buttons = [...container.querySelectorAll('button')];
  act(() => buttons.find((button) => button.textContent === '移除')!.click());
  act(() => buttons.find((button) => button.textContent === '清空附件')!.click());
  expect(state.remove).toHaveBeenCalledWith('a'); expect(state.clear).toHaveBeenCalledOnce();
  act(() => root.render(<FreeAttachmentPanel state={{ ...state, error: '读取失败' }} disabled errorContent={<p role="alert">宿主错误帮助</p>} />));
  expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  expect(container.textContent).toContain('宿主错误帮助');
});

it('keeps result bytes and save destinations in host-controlled slots without dispatching on render', () => {
  const save = vi.fn();
  act(() => root.render(<FreeResultPanel title="情景" label="保存原始数据">
    <FreeJsonResult data={{ title: '长夜', content: '保留原值' }} />
    <FreeResultActions sizeIndicator={<p>本地记录上限 4 MiB</p>}><button disabled onClick={save}>本地保存</button></FreeResultActions>
  </FreeResultPanel>));
  expect(container.querySelector('section[aria-label="保存原始数据"]')).not.toBeNull();
  expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify({ title: '长夜', content: '保留原值' }, null, 2));
  expect(container.textContent).toContain('本地记录上限 4 MiB');
  expect(container.textContent).not.toContain('云端');
  act(() => container.querySelector('button')!.click()); expect(save).not.toHaveBeenCalled();
  act(() => root.render(<FreeResultActions sizeIndicator={<p>云端上限</p>}><button onClick={save}>保存到云端</button></FreeResultActions>));
  act(() => container.querySelector('button')!.click()); expect(save).toHaveBeenCalledOnce();
});


it('can clear the first pending attachment read without accepting its late result', async () => {
  let resolveRead!: (value: AttachmentReadResult) => void;
  const pending = new Promise<AttachmentReadResult>((resolve) => { resolveRead = resolve; });
  const read = vi.fn(() => pending);
  function PendingAttachments() {
    const state = useFreeAttachments(read);
    return <><FreeAttachmentPanel state={state} /><button disabled={state.isReading}>生成</button></>;
  }
  act(() => root.render(<PendingAttachments />));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['正文'], 'first.txt')] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const clear = [...container.querySelectorAll('button')].find((button) => button.textContent === '清空附件')!;
  expect(clear.disabled).toBe(false);
  act(() => clear.click());
  expect([...container.querySelectorAll('button')].find((button) => button.textContent === '生成')!.disabled).toBe(false);
  await act(async () => {
    resolveRead({ added: [{ id: 'late', name: 'late.txt', type: 'text/plain', size: 3, includedBytes: 3, content: 'abc' }], skipped: 0 });
    await pending;
  });
  expect(container.textContent).not.toContain('late.txt');
  expect(container.textContent).not.toContain('正在读取附件');
});

// W3C APG Disclosure: native buttons retain Enter/Space activation; no custom key handler.
it.each(['language', 'schema'] as const)('exposes stable disclosure semantics and focus for %s without changing disabled fields', (kind) => {
  const toggle = vi.fn(); const change = vi.fn();
  const render = (expanded: boolean) => act(() => root.render(kind === 'language'
    ? <FreeLanguageField value="zh-CN" languages={[{ code: 'zh-CN', name: '中文' }]} expanded={expanded} onToggle={toggle} onChange={change} disabled />
    : <FreeSchemaFields schemaId="general" options={freeSchemaOptionsForMode('stream')} showFieldGuide={expanded} onToggleFieldGuide={toggle} onChange={change} disabled />));
  render(false);
  const button = container.querySelector('button')!;
  const panelId = button.getAttribute('aria-controls')!;
  expect(button.tagName).toBe('BUTTON');
  expect(button.type).toBe('button');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById(panelId)?.hidden).toBe(true);
  expect(button.className).toContain('focus-visible:outline-2');
  button.focus();
  act(() => button.click());
  expect(toggle).toHaveBeenCalledOnce();
  render(true);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(button.getAttribute('aria-controls')).toBe(panelId);
  expect(document.getElementById(panelId)?.hidden).toBe(false);
  expect(document.activeElement).toBe(button);
  expect(container.querySelector('select')!.disabled).toBe(true);
  render(false); render(true);
  expect(button.getAttribute('aria-controls')).toBe(panelId);
  expect(change).not.toHaveBeenCalled();
});

it('does not duplicate panel ids across disclosure instances', () => {
  act(() => root.render(<>{[0, 1].map((key) => <FreeLanguageField key={key} value="zh-CN" languages={[]} expanded={false} onToggle={vi.fn()} onChange={vi.fn()} />)}</>));
  const ids = [...container.querySelectorAll('button')].map((button) => button.getAttribute('aria-controls'));
  expect(new Set(ids).size).toBe(2);
  expect(ids.every((id) => id && document.getElementById(id))).toBe(true);
});
