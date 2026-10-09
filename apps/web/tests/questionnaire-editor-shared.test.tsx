// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cloudData: null as unknown, download: vi.fn(), clipboard: vi.fn(), reload: vi.fn() }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href}>{children}</a> }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: ({ data }: { data: unknown }) => { mocks.cloudData = data; return <button>保存云问卷</button>; } }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/CharManager/DataCardsModal', () => ({ default: () => null }));
vi.mock('@/components/CharManager/RecycleBinModal', () => ({ default: () => null }));
vi.mock('@/components/shared/TokenIndicator', () => ({ TokenIndicator: () => null }));
vi.mock('@/components/shared/JsonSizeIndicator', () => ({ JsonSizeIndicator: () => null }));
vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: mocks.download }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));
vi.mock('@/lib/use-data-card-summary-page', () => ({ useDataCardSummaryPage: () => ({ reload: mocks.reload, status: 'idle' }) }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: vi.fn() }));
import { QuestionnaireEditorPage } from '../components/creation/QuestionnaireEditorPage';
let container: HTMLDivElement; let root: Root;
function button(text: string) { const result = [...container.querySelectorAll('button')].find((item) => item.textContent === text); if (!result) throw new Error(text); return result; }
async function click(text: string) { await act(async () => button(text).click()); }
function input(node: HTMLInputElement | HTMLTextAreaElement, text: string) { act(() => { Object.getOwnPropertyDescriptor(node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); }); }
const card = (title: string) => ({ id: 'x', kind: 'magical-girl', title, nativeAllowed: true, signature: 'unverified', extra: { keep: true }, questions: [{ id: 'q1', question: '题目', options: [{ label: 'A', value: 'A', extra: true }], displayIf: { questionId: 'q0', questionnaireId: 'scope', value: ['A|B'] } }] });
beforeEach(() => { vi.clearAllMocks(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: mocks.clipboard } }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); act(() => root.render(<QuestionnaireEditorPage />)); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('Web questionnaire host uses shared core and real controls', () => {
  it('imports extensions and complex rules through shared controls and retains raw source download', async () => {
    const raw = JSON.stringify(card('源问卷'));
    input(container.querySelector('textarea')!, raw); await click('应用粘贴内容');
    expect(mocks.cloudData).toMatchObject({ title: '源问卷', nativeAllowed: false, extra: { keep: true }, questions: [{ options: [{ extra: true }], displayIf: card('源问卷').questions[0].displayIf }] });
    expect(mocks.cloudData).not.toHaveProperty('signature'); expect(container.textContent).toContain('高级 JSON 中的条件');
    await click('下载原始来源'); expect(mocks.download).toHaveBeenCalledTimes(1);
    const titleLabel = [...container.querySelectorAll('label')].find((node) => node.textContent === '问卷标题')!;
    input(titleLabel.nextElementSibling as HTMLInputElement, '已修改'); expect(mocks.cloudData).toHaveProperty('title', '已修改');
  });
  it('ignores a late clipboard import after newer edits or paste', async () => {
    let resolve!: (text: string) => void; mocks.clipboard.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await click('从剪贴板导入'); input(container.querySelector('textarea')!, JSON.stringify(card('较新来源'))); await click('应用粘贴内容');
    await act(async () => resolve(JSON.stringify(card('过时来源')))); expect(mocks.cloudData).toHaveProperty('title', '较新来源');
  });
  it('ignores a late file read after changing a question', async () => {
    let resolve!: (buffer: ArrayBuffer) => void;
    const file = { size: 100, arrayBuffer: () => new Promise<ArrayBuffer>((done) => { resolve = done; }) };
    const upload = container.querySelector('input[type="file"]')!;
    Object.defineProperty(upload, 'files', { configurable: true, value: [file] }); await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
    const label = [...container.querySelectorAll('label')].find((node) => node.textContent === '题目内容')!;
    input(label.nextElementSibling as HTMLInputElement, '保留最新编辑');
    await act(async () => resolve(new TextEncoder().encode(JSON.stringify(card('旧文件'))).buffer));
    expect(mocks.cloudData).toMatchObject({ questions: [{ question: '保留最新编辑' }] });
  });
});
