// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScenarioMarkdownPreview, ScenarioResultContent, GeneralScenarioEditor, GeneralScenarioCard } from '../src/scenario';
import { escapedScenarioPreview } from '../src/scenario/ScenarioMarkdownPreview';
import { MarkdownBlock } from '../src/markdown';
import { BasicCardDetailsModal, CardDetailsBody } from '../src/card-details/BasicCardDetailsModal';

// Synthetic reproduction of the visible escape pattern, not a user's story.
const escaped = '# 简报\\n\\n---\\n\\n## 任务\\n记录星轨。\\n\\n- 观察\\n- 记录';
const decoded = '# 简报\n\n---\n\n## 任务\n记录星轨。\n\n- 观察\n- 记录';
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const preview = (content: string) => act(() => root.render(<ScenarioMarkdownPreview content={content} />));
const toggle = () => act(() => container.querySelector<HTMLButtonElement>('button')!.click());

it('reproduces the one-heading failure, then offers reversible preview without changing the source', () => {
  preview(escaped);
  expect(container.querySelectorAll('h2')).toHaveLength(1);
  expect(container.querySelector('h2')?.textContent).toContain('\\n\\n## 任务');
  expect(container.querySelector('h3, hr, ul')).toBeNull();
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
  toggle();
  expect(container.querySelector('h2')?.textContent).toBe('简报');
  expect(container.querySelector('h3')?.textContent).toBe('任务');
  expect(container.querySelector('hr')).not.toBeNull();
  expect(container.querySelectorAll('li')).toHaveLength(2);
  expect(container.querySelector('button')?.textContent).toBe('恢复原文预览');
  toggle();
  expect(container.querySelector('h3')).toBeNull();
  expect(container.querySelector('h2')?.textContent).toContain('\\n');
  expect(escaped).toBe('# 简报\\n\\n---\\n\\n## 任务\\n记录星轨。\\n\\n- 观察\\n- 记录');
});

it('renders genuine LF and CRLF Markdown directly without offering repair', () => {
  for (const content of [decoded, decoded.replace(/\n/g, '\r\n')]) {
    preview(content);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('任务');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(escapedScenarioPreview(content)).toBeNull();
  }
  expect(escapedScenarioPreview(escaped.replace(/\\n/g, '\\r\\n'))).toBe(decoded);
});

it.each([
  '# 文档\n\n`\\n` 是转义字符。',
  '# 文档\n\n```json\n{"line":"a\\nb"}\n```',
  escaped + '\\n\\n`line\\nnext`',
  escaped + '\\n\\n```json\\n{"line":"a\\nb"}\\n```',
  escaped + '\\n\\n~~~text\\nline\\n~~~',
  escaped + '\\n\\n{"line":"a\\nb"}',
  escaped + '\\n\\nC:\\notes\\new',
  escaped + '\\n\\n\\\\network\\new',
  escaped + '\n实际换行',
  escaped + '\\t保留制表符',
  escaped + '\\n\\n    indented\\ncode',
  escaped + '\\n\\n$x\\neq y$',
  '# 说明\\n一行普通文字',
])('does not guess at code, JSON, paths, other escapes or mixed content: %s', (content) => {
  expect(escapedScenarioPreview(content)).toBeNull();
  preview(content);
  expect(container.querySelector('button')).toBeNull();
});

it('keeps ordinary Markdown backslashes and fenced JSON unchanged', () => {
  const content = '# 文档\n\n`C:\\notes\\new`\n\n```json\n{"line":"a\\nb"}\n```';
  preview(content);
  expect([...container.querySelectorAll('code')].map((code) => code.textContent)).toEqual(['C:\\notes\\new', '{"line":"a\\nb"}\n']);
});

it('resets preview selection on replacement, including returning to an earlier card', () => {
  preview(escaped); toggle();
  preview(escaped + '新结果');
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
  preview(escaped);
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
});

it('keeps full structured JSON, unknown fields and signatures exact through preview toggles', () => {
  const data = { title: '情景', description: escaped, elements: { events: '**事件**', development: ['*观察*'], roles: [{ name: '守夜人', description: '## 角色\n\n记录' }] }, extension: { nested: [1, 'x\\ny'] }, metadata: { signature: 'original' } };
  const original = JSON.stringify(data);
  act(() => root.render(<ScenarioResultContent data={data} />));
  toggle();
  expect(container.querySelector('h3')?.textContent).toBe('任务');
  expect(container.querySelector('strong')?.textContent).toBe('守夜人');
  expect(container.querySelector('em')?.textContent).toBe('观察');
  expect(container.querySelector('details pre')?.textContent).toBe(JSON.stringify(data, null, 2));
  expect(JSON.stringify(data)).toBe(original);
});

it('uses the existing safe Markdown renderer even after decoding', () => {
  preview(escaped + '\\n\\n<script>alert(1)</script>'); toggle();
  expect(container.querySelector('script, iframe, img')).toBeNull();
  expect(container.textContent).toContain('<script>alert(1)</script>');
  preview('# 安全\n\n![图片](https://external.test/image.png)\n\n[链接](javascript:alert(1))');
  expect(container.querySelector('img, iframe, script')).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});

it('does not call editor mutation handlers or alter the full technical view during recovery', () => {
  const onChange = vi.fn();
  const draft = { title: '原件', content: escaped, extension: ['保留'] };
  act(() => root.render(<GeneralScenarioEditor draft={draft} onChange={onChange} onCreate={vi.fn()} onConvert={vi.fn()} canConvert={false} />));
  act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '按换行预览')!.click());
  expect(container.querySelector('textarea')?.value).toBe(escaped);
  expect(container.querySelector('details pre')?.textContent).toBe(JSON.stringify(draft, null, 2));
  expect(onChange).not.toHaveBeenCalled();
});

it('supports the saved-card details host slot without changing serialized card data', () => {
  const data = JSON.stringify({ title: '情景', content: escaped });
  act(() => root.render(<CardDetailsBody data={data} renderMarkdown={(content) => <ScenarioMarkdownPreview content={content} renderMarkdown={(markdown) => <MarkdownBlock content={markdown} variant="light" mode="article" />} />} />));
  toggle();
  expect(container.querySelector('h3')?.textContent).toBe('任务');
  expect(JSON.parse(data).content).toBe(escaped);
});


it('resets structured-card recovery when a different card carries the same content', () => {
  act(() => root.render(<ScenarioResultContent data={{ title: '第一张', description: escaped }} />));
  toggle();
  act(() => root.render(<ScenarioResultContent data={{ title: '第二张', description: escaped }} />));
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
});

it('wires recovery only into scenario details and resets it for another card identity', () => {
  const renderDetails = (id: string, type: 'scenario' | 'character' = 'scenario') => act(() => root.render(
    <BasicCardDetailsModal isOpen onClose={vi.fn()} source={{ kind: 'local' }}
      card={{ id, name: '情景', type, description: '', data: JSON.stringify({ content: escaped }), isPublic: false }}
      renderMarkdown={(content) => <MarkdownBlock content={content} variant="light" mode="article" />} />,
  ));
  renderDetails('first');
  act(() => container.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
  expect(container.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('true');
  renderDetails('second');
  expect(container.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('false');
  renderDetails('second', 'character');
  expect(container.querySelector('button[aria-pressed]')).toBeNull();
});


it('renders recovery in the actual general scenario card and marks only controls for capture exclusion', () => {
  const scenario = { title: '情景', content: escaped };
  act(() => root.render(<GeneralScenarioCard scenario={scenario} />));
  const card = container.querySelector('.result-card')!;
  expect(card.querySelector('[data-scenario-preview-controls] button')).not.toBeNull();
  toggle();
  expect(card.querySelector('h3')?.textContent).toBe('任务');
  expect(card.querySelector('[data-scenario-preview-controls] h2, [data-scenario-preview-controls] h3')).toBeNull();
  expect(card.textContent).toContain('图片导出使用当前预览');
  expect(scenario.content).toBe(escaped);
  act(() => root.render(<GeneralScenarioCard scenario={{ ...scenario, title: '另一张卡' }} />));
  expect(card.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('false');
});
