// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopQuestionnaireDetailsModal } from '../src/features/questionnaire/questionnaire-details-modal';

const openContent = vi.fn();
vi.mock('../src/features/external-links/external-links-provider', () => ({
  useExternalLinks: () => ({ openContent }),
}));

const questionnaire: QuestionnaireSelection['questionnaire'] = {
  id: 'same-id', kind: 'magical-girl', title: '当前标题', description: '当前简介', nativeAllowed: true,
  loreMarkdown: '# 纯设定\n\n[外链](https://example.com/lore) ![外图](https://example.com/image.png)',
  questions: [],
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn());
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each([
  { source: 'preset', selectionId: 'builtin:same-id', expected: '此客户端内置预设版本' },
  { source: 'upload', selectionId: 'local:same-id', expected: '本地上传/本地库' },
  { source: 'upload', selectionId: 'cache:same-id', expected: '公开库缓存快照' },
  { source: 'database', selectionId: 'cloud:same-id', expected: '选自云端数据卡' },
] as const)('$selectionId retains provenance without giving the copy cloud authority', async ({ source, selectionId, expected }) => {
  const selection: QuestionnaireSelection = {
    source, selectionId, questionnaire, useLore: false,
    // 即使有追溯 ID，详情也不得推断服务器权限或发起在线查询。
    dataCardId: '00000000-0000-4000-8000-000000000001', dataCardName: '选中卡名', dataCardAuthor: '原作者',
  };
  const original = JSON.stringify(selection);
  await act(async () => root.render(<DesktopQuestionnaireDetailsModal selection={selection} onClose={() => {}} />));
  expect(container.textContent).toContain('当前问卷副本');
  expect(container.textContent).toContain(expected);
  expect(container.textContent).toContain('原作者');
  expect(container.textContent).toContain('题目 0 道');
  expect(container.textContent).toContain('含设定');
  expect(container.textContent).toContain('原生签名许可声明：允许');
  expect(container.textContent).toContain('不代表当前服务器资格');
  expect(container.textContent).not.toContain('我的云端数据卡正文');
  expect(container.textContent).not.toContain('公开数据卡正文');
  expect([...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((node) => node.textContent)).toContain('纯设定');
  expect(container.querySelector('img, audio, video, iframe')).toBeNull();
  const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="关闭问卷详情"]');
  expect(closeButton).not.toBeNull();
  expect([...container.querySelectorAll('button')]).toEqual([closeButton]);
  expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(questionnaire, null, 2));
  if (selectionId.startsWith('cache:')) {
    expect(container.textContent).toContain('最近成功读取：未知');
    expect(container.textContent).toContain('不代表当前公开状态');
  }
  await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
  expect(openContent).toHaveBeenCalledExactlyOnceWith('https://example.com/lore');
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(selection)).toBe(original);
});

it('keeps the complete normalized JSON when the readable tree is truncated, and clears it on close', async () => {
  const large = { ...questionnaire, questions: Array.from({ length: 2100 }, (_, index) => ({ id: String(index), question: `问题 ${index}` })) };
  const render = (selection: QuestionnaireSelection | null) => act(async () => root.render(
    <DesktopQuestionnaireDetailsModal selection={selection} onClose={() => {}} />,
  ));
  await render({ source: 'upload', selectionId: 'local:large', questionnaire: large });
  expect(container.textContent).toContain('较长列表已截断展示');
  expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(large, null, 2));
  await render(null);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await render({ source: 'upload', selectionId: 'local:same-id', questionnaire: { ...questionnaire, nativeAllowed: null } });
  expect(container.textContent).toContain('原生签名许可声明：未声明');
  expect(container.textContent).not.toContain('问题 2099');
  expect(container.querySelector('details')?.open).toBe(false);
});
