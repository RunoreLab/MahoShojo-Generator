// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MagicTeaPartyChatMessage } from '@mahoshojo/ui-web/magic-tea-party';
import { parseSillyTavernJsonl, stringifySillyTavernJsonl } from '@mahoshojo/domain/magic-tea-party/transfer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MagicTeaPartyMessage, MagicTeaPartySession } from '@/lib/magic-tea-party/types';
import type { ReadTextAndReasoningStreamOptions } from '@/lib/stream/read-text-and-reasoning-stream';
import { buildMagicTeaPartyHistory } from '@/lib/magic-tea-party/history';
import { DEFAULT_MAGIC_TEA_PARTY_PREFERENCES } from '@/lib/magic-tea-party/preferences';
import { useMagicTeaPartyChat, type UseMagicTeaPartyChatResult } from '@/lib/magic-tea-party/useMagicTeaPartyChat';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(), acquire: vi.fn(), put: vi.fn(), persist: vi.fn(), headers: vi.fn(),
  inputSafety: vi.fn(), quickCheck: vi.fn(), read: vi.fn(), notices: vi.fn(), sideChannels: vi.fn(), globalError: vi.fn(), shield: vi.fn(), selectChoice: vi.fn(), navigate: vi.fn(),
}));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: mocks.acquire }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: mocks.headers } }));
vi.mock('@/lib/magic-tea-party/storage', () => ({ putMagicTeaPartyMessage: mocks.put, deleteMagicTeaPartyMessages: vi.fn() }));
vi.mock('@/lib/content-safety/client', () => ({ getSensitiveWordRedirectTarget: mocks.inputSafety }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: mocks.quickCheck }));
vi.mock('@/lib/shield-word-filter', () => ({ applyShieldWords: mocks.shield }));
vi.mock('@/lib/stream/read-text-and-reasoning-stream', () => ({ readTextAndReasoningStreamFromResponse: mocks.read }));

const choices = [{ id: 'tea', text: '喝茶' }, { id: 'window', text: '看看窗外' }];
const rawChoices = JSON.stringify({ type: 'choices', items: choices });
const oldChoices = [{ id: 'old', text: '上次的选项' }];
const session: MagicTeaPartySession = {
  id: 'tea', title: '茶会', createdAt: 1, updatedAt: 1, roles: [], draft: '尚未发送的草稿', lastChoices: oldChoices,
  settings: { providerId: 'openai', modelId: 'selected-model', outputFormat: 'jsonl', choiceCount: 3,
    enableChoices: false, enableSummary: false, outputPlan: { choices: 'off', summary: 'off', updates: 'off' } },
};
const history = (id: string): MagicTeaPartyMessage[] => [{ id: `${id}-user`, sessionId: id, role: 'user', content: '我走进茶馆', createdAt: 1, status: 'done' }];
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let root: Root;
let container: HTMLDivElement;
let chat: UseMagicTeaPartyChatResult;
let shownMessages: MagicTeaPartyMessage[];
function Harness({ current = session, seed }: { current?: MagicTeaPartySession; seed?: MagicTeaPartyMessage[] }) {
  const [messages, setMessages] = useState(() => seed ?? history(current.id));
  useEffect(() => setMessages(seed ?? history(current.id)), [current.id, seed]);
  const currentChat = useMagicTeaPartyChat({
    activeSession: current, activeSessionId: current.id, messages, setMessages, persistSession: mocks.persist,
    preferences: { ...DEFAULT_MAGIC_TEA_PARTY_PREFERENCES, enableSummary: false },
    userProviderConfig: { providerId: 'openai', modelId: 'selected-model', apiKey: 'test-key' },
    onNotices: mocks.notices, onSideChannels: mocks.sideChannels, onGlobalError: mocks.globalError, router: { push: mocks.navigate },
  });
  useEffect(() => {
    shownMessages = messages;
    chat = currentChat;
  }, [messages, currentChat]);
  return <>{messages.map((message) => <MagicTeaPartyChatMessage key={message.id} message={message} session={current}
    preferences={DEFAULT_MAGIC_TEA_PARTY_PREFERENCES} isGenerating={currentChat.isGenerating} onSelectChoice={mocks.selectChoice} />)}</>;
}
const render = async (current = session, seed?: MagicTeaPartyMessage[]) => act(async () => root.render(<Harness current={current} seed={seed} />));
const savedAssistant = () => mocks.put.mock.calls.map(([message]) => message as MagicTeaPartyMessage).filter((message) => message.role === 'assistant').at(-1)!;

beforeEach(async () => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.acquire.mockImplementation(() => ({ dispatch: mocks.dispatch }));
  mocks.dispatch.mockImplementation(async () => new Response(rawChoices));
  mocks.put.mockResolvedValue(undefined); mocks.persist.mockResolvedValue(undefined); mocks.headers.mockResolvedValue({});
  mocks.inputSafety.mockResolvedValue(null); mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: false });
  mocks.shield.mockImplementation((text: string) => ({ filteredText: text }));
  mocks.read.mockImplementation(async (response: Response, options: ReadTextAndReasoningStreamOptions) => {
    const text = await response.text(); options.onText?.(text);
    return { text, reasoning: null, telemetry: null, meta: null, isSse: false };
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('Web manual choice generation', () => {
  it('dispatches once for same-tick double clicks and saves raw output and actual projected choices without changing draft/settings', async () => {
    await act(async () => { const generate = chat.generateChoices; await Promise.all([generate(), generate()]); });
    expect(mocks.acquire).toHaveBeenCalledOnce(); expect(mocks.dispatch).toHaveBeenCalledOnce();
    const [url, request] = mocks.dispatch.mock.calls[0];
    expect(url).toBe('/api/magic-tea-party/generate-choices?format=sse');
    const body = JSON.parse(request.body);
    expect(body.messages).toEqual([{ id: 'tea-user', role: 'user', content: '我走进茶馆' }]);
    expect(body.customProvider.modelId).toBe('selected-model');
    expect(body.settings.outputPlan).toEqual(session.settings.outputPlan);
    expect(shownMessages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(savedAssistant()).toMatchObject({ status: 'done', content: '- 喝茶\n- 看看窗外', choices,
      meta: { kind: 'choices', rawOutput: rawChoices, choicesValid: true, completion: 'completed' } });
    expect(mocks.persist.mock.calls.at(-1)?.[0]).toMatchObject({ lastChoices: choices, draft: session.draft, settings: session.settings });
    expect(mocks.notices.mock.calls.flatMap(([notices]) => notices)).toContainEqual(expect.objectContaining({ code: 'choices_count_adjusted' }));
    expect(mocks.sideChannels).not.toHaveBeenCalled();
  });

  it('persists only shielded JSONL and keeps the shielded action clickable through the shared view', async () => {
    const raw = JSON.stringify({ type: 'choices', items: [{ id: 'shielded', text: '原词行动' }] });
    const safe = raw.replaceAll('原词', '替换词');
    mocks.shield.mockImplementation((text: string) => ({ filteredText: text.replaceAll('原词', '替换词') }));
    mocks.dispatch.mockImplementation(async () => new Response(raw));
    await act(async () => chat.generateChoices());
    expect(savedAssistant()).toMatchObject({ status: 'done', choices: [{ id: 'shielded', text: '替换词行动' }],
      meta: { rawOutput: safe, choicesValid: true } });
    expect(JSON.stringify(mocks.put.mock.calls)).not.toContain('原词');
    expect(JSON.stringify(mocks.persist.mock.calls)).not.toContain('原词');
    expect(JSON.stringify(shownMessages)).not.toContain('原词');
    const choice = [...container.querySelectorAll('button')].find((button) => button.title === '选择该行动' && button.textContent === '替换词行动');
    expect(choice).toBeDefined(); expect(choice?.disabled).toBe(false);
    await act(async () => choice!.click());
    expect(mocks.selectChoice).toHaveBeenCalledExactlyOnceWith('替换词行动');
  });

  it.each(['', 'unstructured response', `${rawChoices}\n{"type":"notice","level":"error","message":"条件不满足"}`])('retains failed output without promoting previous or new choices: %j', async (raw) => {
    mocks.dispatch.mockImplementation(async () => new Response(raw));
    await act(async () => chat.generateChoices());
    expect(savedAssistant()).toMatchObject({ status: 'error', choices: [], meta: { rawOutput: raw, choicesValid: false } });
    expect(mocks.persist.mock.calls.every(([saved]) => saved.lastChoices === oldChoices)).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('reports a storage failure without relabeling completed generation or automatically retrying the model', async () => {
    mocks.put.mockImplementation(async (message: MagicTeaPartyMessage) => {
      if (message.status === 'done') throw new Error('quota');
    });
    await act(async () => chat.generateChoices());
    expect(savedAssistant()).toMatchObject({ status: 'done', choices, meta: { rawOutput: rawChoices } });
    expect(shownMessages.at(-1)).toMatchObject({ status: 'done', choices });
    expect(mocks.globalError).toHaveBeenLastCalledWith(expect.stringContaining('尚未完整保存'));
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('accepts a warning and ignores unsolicited summary/update side channels without extra model calls', async () => {
    const raw = `${rawChoices}\n{"type":"notice","level":"warning","message":"调整数量"}\n{"type":"summary","text":"不可自动应用"}\n{"type":"updates","drafts":[{"characterName":"旅人","impact":"变化"}]}`;
    mocks.dispatch.mockImplementation(async () => new Response(raw));
    await act(async () => chat.generateChoices());
    expect(savedAssistant()).toMatchObject({ status: 'done', choices, meta: { choicesValid: true, rawOutput: raw } });
    expect(mocks.sideChannels).not.toHaveBeenCalled(); expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it.each(['stopped', 'failed'] as const)('preserves a valid received prefix as display-only after %s', async (completion) => {
    const entered = deferred<void>(), finish = deferred<void>();
    mocks.read.mockImplementationOnce(async (_response: Response, options: ReadTextAndReasoningStreamOptions) => {
      options.onText?.(rawChoices); entered.resolve(); await finish.promise;
      throw new Error('connection closed');
    });
    let pending!: Promise<void>;
    await act(async () => { pending = chat.generateChoices(); await entered.promise; });
    await act(async () => { if (completion === 'stopped') chat.stopGenerating(); finish.resolve(); await pending; });
    expect(savedAssistant()).toMatchObject({ status: 'error', choices: [], content: '- 喝茶\n- 看看窗外',
      segments: [{ type: 'choices', items: choices }], meta: { choicesValid: false, completion, rawOutput: rawChoices } });
    expect(mocks.persist.mock.calls.every(([saved]) => saved.lastChoices === oldChoices)).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('never promotes a choice prefix retained before a safety block', async () => {
    const raw = `${rawChoices}\nunsafe`;
    mocks.dispatch.mockImplementation(async () => new Response(raw));
    mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: true, matchDetails: [{ startIndex: rawChoices.length + 1 }] });
    await act(async () => chat.generateChoices());
    expect(savedAssistant()).toMatchObject({ status: 'blocked', choices: [], meta: { choicesValid: false, completion: 'blocked', rawOutput: `${rawChoices}\n` } });
    expect(JSON.stringify(savedAssistant())).not.toContain('unsafe');
    expect(mocks.persist.mock.calls.every(([saved]) => saved.lastChoices === oldChoices)).toBe(true);
  });

  it.each(['put', 'persist', 'headers'] as const)('stopping during %s preparation causes zero model dispatches and releases the entry', async (stage) => {
    const entered = deferred<void>(), release = deferred<void>();
    mocks[stage].mockImplementationOnce(async () => { entered.resolve(); await release.promise; return stage === 'headers' ? {} : undefined; });
    let pending!: Promise<void>;
    await act(async () => { pending = chat.generateChoices(); await entered.promise; });
    await act(async () => { chat.stopGenerating(); release.resolve(); await pending; });
    expect(mocks.acquire).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(savedAssistant()).toMatchObject({ status: 'error', meta: { choicesValid: false, completion: 'stopped' } });
    expect(chat.isGenerating).toBe(false);
    await act(async () => chat.generateChoices());
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it.each(['stop', 'switch', 'completed'] as const)('rejects an in-flight preview safety check released after %s', async (outcome) => {
    const checking = deferred<void>(), checked = deferred<{ hasSensitiveWords: boolean }>();
    const reading = deferred<void>(), finishRead = deferred<void>();
    const early = `${rawChoices}\n{"type":"notice","level":"warning","message":"过期预览提示"}`;
    const final = '{"type":"choices","items":[{"id":"final","text":"终态行动"}]}';
    mocks.quickCheck.mockImplementationOnce(async () => { checking.resolve(); return checked.promise; });
    mocks.read.mockImplementationOnce(async (_response: Response, options: ReadTextAndReasoningStreamOptions) => {
      options.onText?.(early); reading.resolve(); await finishRead.promise;
      return { text: final, reasoning: null, telemetry: null, meta: null, isSse: false };
    });
    let pending!: Promise<void>;
    await act(async () => { pending = chat.generateChoices(); await reading.promise; await checking.promise; });
    if (outcome === 'switch') await render({ ...session, id: 'other' });
    await act(async () => { if (outcome === 'stop') chat.stopGenerating(); finishRead.resolve(); await pending; });
    const before = JSON.stringify(shownMessages);
    const noticeCount = mocks.notices.mock.calls.length;
    const stored = JSON.stringify(savedAssistant());
    await act(async () => { checked.resolve({ hasSensitiveWords: false }); await checked.promise; });
    expect(JSON.stringify(shownMessages)).toBe(before);
    expect(JSON.stringify(savedAssistant())).toBe(stored);
    expect(mocks.notices).toHaveBeenCalledTimes(noticeCount);
    expect(mocks.notices.mock.calls.flatMap(([notices]) => notices)).not.toContainEqual(expect.objectContaining({ message: '过期预览提示' }));
    if (outcome === 'switch') expect(shownMessages).toEqual(history('other'));
    else expect(shownMessages.at(-1)).toMatchObject({ status: outcome === 'stop' ? 'error' : 'done', content: '- 终态行动' });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('does not redirect a newer session after the blocked-message storage await finishes', async () => {
    const writing = deferred<void>(), finishWrite = deferred<void>();
    mocks.dispatch.mockImplementation(async () => Response.json({ shouldRedirect: true, reason: 'blocked' }, { status: 400 }));
    mocks.put.mockImplementation(async (message: MagicTeaPartyMessage) => {
      if (message.status === 'blocked') { writing.resolve(); await finishWrite.promise; }
    });
    let pending!: Promise<void>;
    await act(async () => { pending = chat.generateChoices(); await writing.promise; });
    await render({ ...session, id: 'other' });
    await act(async () => { finishWrite.resolve(); await pending; });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(shownMessages).toEqual(history('other'));
    expect(savedAssistant()).toMatchObject({ sessionId: 'tea', status: 'blocked' });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('saves the original terminal message without replaying its session snapshot after A→B→A during final storage', async () => {
    const writing = deferred<void>(), finishWrite = deferred<void>();
    mocks.put.mockImplementation(async (message: MagicTeaPartyMessage) => {
      if (message.role === 'assistant' && message.status === 'done') { writing.resolve(); await finishWrite.promise; }
    });
    let pending!: Promise<void>;
    await act(async () => { pending = chat.generateChoices(); await writing.promise; });
    const sessionWrites = mocks.persist.mock.calls.length;
    await render({ ...session, id: 'other', draft: 'B草稿' });
    await render({ ...session, draft: '新的A草稿', title: '新标题', updatedAt: 5 });
    await act(async () => { finishWrite.resolve(); await pending; });
    expect(mocks.persist).toHaveBeenCalledTimes(sessionWrites);
    expect(shownMessages).toEqual(history(session.id));
    expect(savedAssistant()).toMatchObject({ sessionId: session.id, status: 'done', choices });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('does not let a delayed old-session preparation overwrite the new view or dispatch', async () => {
    const entered = deferred<void>(), release = deferred<void>();
    mocks.put.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    let pending!: Promise<void>;
    await act(async () => { pending = chat.generateChoices(); await entered.promise; });
    await render({ ...session, id: 'other' });
    await act(async () => { release.resolve(); await pending; });
    expect(shownMessages).toEqual(history('other'));
    expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
    expect(savedAssistant()).toMatchObject({ sessionId: 'tea', status: 'error' });
  });
});

describe('Web selected-action entry', () => {
  it('writes one user message and dispatches one existing main-generation request for same-tick selection clicks', async () => {
    mocks.dispatch.mockImplementation(async () => new Response('{"type":"narration","text":"下一段剧情"}'));
    await act(async () => { const send = chat.sendMessage; await Promise.all([send('喝茶'), send('喝茶')]); });
    expect(mocks.put.mock.calls.filter(([message]) => message.role === 'user')).toHaveLength(1);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(mocks.dispatch.mock.calls[0][0]).toBe('/api/magic-tea-party/generate-stream?format=sse');
    expect(JSON.parse(mocks.dispatch.mock.calls[0][1].body).messages.at(-1)).toMatchObject({ role: 'user', content: '喝茶' });
    expect(mocks.persist.mock.calls.every(([saved]) => saved.draft === session.draft)).toBe(true);
    expect(savedAssistant()).toMatchObject({ status: 'done', content: '下一段剧情', choices: [], meta: { choicesValid: false, completion: 'completed' } });
  });

  it('retains the current safe prefix when the main stream fails, with choices still inert', async () => {
    mocks.read.mockImplementationOnce(async (_response: Response, options: ReadTextAndReasoningStreamOptions) => {
      options.onText?.(rawChoices); throw new Error('stream disconnected');
    });
    await act(async () => chat.sendMessage('喝茶'));
    expect(savedAssistant()).toMatchObject({ status: 'error', content: '- 喝茶\n- 看看窗外', choices: [],
      segments: [{ type: 'choices', items: choices }], meta: { rawOutput: rawChoices, completion: 'failed', choicesValid: false } });
    expect([...container.querySelectorAll('button')].filter((button) => button.title === '选择该行动')).toHaveLength(0);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it.each(['message', 'session'] as const)('preserves the completed main result when terminal %s storage fails', async (stage) => {
    if (stage === 'message') mocks.put.mockImplementation(async (message: MagicTeaPartyMessage) => {
      if (message.role === 'assistant' && message.status === 'done') throw new Error('quota');
    });
    else mocks.persist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('quota'));
    await act(async () => chat.sendMessage('喝茶'));
    expect(shownMessages.at(-1)).toMatchObject({ status: 'done', choices, meta: { rawOutput: rawChoices, completion: 'completed', choicesValid: true } });
    expect(savedAssistant()).toMatchObject({ status: 'done', choices });
    expect(mocks.globalError).toHaveBeenLastCalledWith(expect.stringContaining('保存'));
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('keeps the refreshed main terminal choices intact when an older safety preview finishes later', async () => {
    const checking = deferred<void>(), checked = deferred<{ hasSensitiveWords: boolean }>();
    const reading = deferred<void>(), finishRead = deferred<void>();
    const early = '{"type":"choices","items":[{"id":"old","text":"旧预览行动"}]}\n{"type":"notice","level":"warning","message":"旧主流提示"}';
    mocks.quickCheck.mockImplementationOnce(async () => { checking.resolve(); return checked.promise; });
    mocks.read.mockImplementationOnce(async (_response: Response, options: ReadTextAndReasoningStreamOptions) => {
      options.onText?.(early); reading.resolve(); await finishRead.promise;
      return { text: rawChoices, reasoning: null, telemetry: null, meta: null, isSse: false };
    });
    let pending!: Promise<boolean>;
    await act(async () => { pending = chat.sendMessage('喝茶'); await reading.promise; await checking.promise; });
    await act(async () => { finishRead.resolve(); expect(await pending).toBe(true); });
    const before = JSON.stringify(shownMessages), noticeCount = mocks.notices.mock.calls.length;
    await act(async () => { checked.resolve({ hasSensitiveWords: false }); await checked.promise; });
    expect(JSON.stringify(shownMessages)).toBe(before); expect(mocks.notices).toHaveBeenCalledTimes(noticeCount);
    expect(shownMessages.at(-1)).toMatchObject({ status: 'done', choices, meta: { rawOutput: rawChoices, choicesValid: true } });
    expect(container.textContent).not.toContain('旧预览行动');
    expect(mocks.notices.mock.calls.flatMap(([notices]) => notices)).not.toContainEqual(expect.objectContaining({ message: '旧主流提示' }));
  });

  it.each(['stopped', 'different-raw'] as const)('refreshes imported Desktop reply evidence after Web regeneration (%s)', async (previous) => {
    const oldItem = { id: 'old-choice', text: '旧的行动' };
    const oldRaw = JSON.stringify({ type: 'choices', items: [oldItem] });
    const desktopReply: MagicTeaPartyMessage = { id: 'desktop-reply', sessionId: session.id, role: 'assistant', createdAt: 2,
      content: '- 旧的行动', status: previous === 'stopped' ? 'error' : 'done',
      segments: [{ type: 'choices', items: [oldItem] }], choices: previous === 'stopped' ? [] : [oldItem],
      meta: { kind: 'reply', outputFormat: 'jsonl', rawOutput: oldRaw, choicesValid: previous !== 'stopped',
        completion: previous === 'stopped' ? 'stopped' : 'provider', notices: [{ type: 'notice', level: 'warning', message: '旧提示' }] } };
    let id = 0;
    const restored = parseSillyTavernJsonl({ sessionId: session.id, createId: () => `imported-${++id}`,
      text: stringifySillyTavernJsonl({ messages: [...history(session.id), desktopReply], userDisplayName: '旅人' }) });
    expect(restored.warnings).toEqual([]);
    await render(session, restored.messages);
    const freshRaw = `{ "type": "narration", "text": "新正文" }\n${rawChoices}`;
    mocks.dispatch.mockImplementation(async () => new Response(freshRaw));
    await act(async () => chat.regenerateMessage(restored.messages.at(-1)!));
    const fresh = savedAssistant();
    expect(fresh).toMatchObject({ status: 'done', choices, meta: { rawOutput: freshRaw, choicesValid: true, completion: 'completed' } });
    expect(fresh.meta?.notices).not.toContainEqual(expect.objectContaining({ message: '旧提示' }));
    const choice = [...container.querySelectorAll('button')].find((button) => button.title === '选择该行动' && button.textContent === '喝茶');
    expect(choice).toBeDefined(); expect(choice?.disabled).toBe(false);
    await act(async () => choice!.click());
    expect(mocks.selectChoice).toHaveBeenCalledExactlyOnceWith('喝茶');
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it.each(['stop', 'switch', 'aba'] as const)('does not clear a newer draft or overwrite its session after %s during main terminal storage', async (action) => {
    const writing = deferred<void>(), finishWrite = deferred<void>();
    mocks.dispatch.mockImplementation(async () => new Response('{"type":"narration","text":"已完成正文"}'));
    mocks.put.mockImplementation(async (message: MagicTeaPartyMessage) => {
      if (message.role === 'assistant' && message.status === 'done') { writing.resolve(); await finishWrite.promise; }
    });
    let currentDraft = '原来的草稿';
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = chat.sendMessage('喝茶').then((sent) => { if (sent) currentDraft = ''; return sent; });
      await writing.promise;
    });
    const sessionWrites = mocks.persist.mock.calls.length;
    if (action === 'stop') await act(async () => chat.stopGenerating());
    else {
      currentDraft = '新的B草稿';
      await render({ ...session, id: 'other', draft: currentDraft });
      if (action === 'aba') {
        currentDraft = '新的A草稿';
        await render({ ...session, draft: currentDraft, title: '新标题', updatedAt: 5 });
      }
    }
    const expectedDraft = currentDraft;
    await act(async () => { finishWrite.resolve(); expect(await pending).toBe(false); });
    expect(currentDraft).toBe(expectedDraft);
    expect(mocks.persist).toHaveBeenCalledTimes(sessionWrites);
    expect(savedAssistant()).toMatchObject({ sessionId: session.id, status: 'done', content: '已完成正文' });
    if (action !== 'stop') expect(shownMessages).toEqual(history(action === 'switch' ? 'other' : session.id));
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it.each(['stop', 'switch'] as const)('restores the original answer if its retirement write is interrupted by %s before a replacement exists', async (action) => {
    const original: MagicTeaPartyMessage = { id: 'original', sessionId: session.id, role: 'assistant', content: '原来的完整回答',
      createdAt: 2, status: 'done', sourceMessageId: 'tea-user', meta: { kind: 'reply' } };
    await render(session, [...history(session.id), original]);
    const writing = deferred<void>(), finishWrite = deferred<void>();
    mocks.put.mockImplementationOnce(async () => { writing.resolve(); await finishWrite.promise; });
    let pending!: Promise<void>;
    await act(async () => { pending = chat.regenerateMessage(original); await writing.promise; });
    if (action === 'switch') await render({ ...session, id: 'other' });
    await act(async () => { if (action === 'stop') chat.stopGenerating(); finishWrite.resolve(); await pending; });
    const stored = mocks.put.mock.calls.filter(([message]) => message.id === original.id).at(-1)![0] as MagicTeaPartyMessage;
    expect(stored).toEqual(original);
    expect(buildMagicTeaPartyHistory([...history(session.id), stored])).toContainEqual(expect.objectContaining({ id: original.id, content: original.content }));
    expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.acquire).not.toHaveBeenCalled();
    if (action === 'switch') expect(shownMessages).toEqual(history('other'));
    else expect(shownMessages.find((message) => message.id === original.id)).toEqual(original);
    expect(chat.isGenerating).toBe(false);
  });

  it.each(['stop', 'switch'] as const)('prevents delayed input-safety work from writing or dispatching after %s', async (action) => {
    const entered = deferred<void>(), release = deferred<null>();
    mocks.inputSafety.mockImplementationOnce(async () => { entered.resolve(); return release.promise; });
    let pending!: Promise<boolean>;
    await act(async () => { pending = chat.sendMessage('喝茶'); await entered.promise; });
    if (action === 'switch') await render({ ...session, id: 'other' });
    await act(async () => { if (action === 'stop') chat.stopGenerating(); release.resolve(null); expect(await pending).toBe(false); });
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(shownMessages).toEqual(history(action === 'switch' ? 'other' : 'tea'));
    expect(chat.isGenerating).toBe(false);
  });
});

it('renders superseded Web actions as history only without dispatching selection or a model request', async () => {
  const prior: MagicTeaPartyMessage = { id: 'old-choice', sessionId: session.id, role: 'assistant', content: '旧行动', createdAt: 2, status: 'done',
    choices, segments: [{ type: 'choices', items: choices }], meta: { superseded: true, rawOutput: rawChoices, choicesValid: true } };
  await render(session, [...history(session.id), prior]);
  expect(container.textContent).toContain('该条消息已被更新替换');
  expect(container.textContent).toContain('喝茶');
  expect([...container.querySelectorAll('button')].filter(button => button.title === '选择该行动')).toHaveLength(0);
  const historicalAction = [...container.querySelectorAll('div')].find(node => node.textContent === '喝茶')!;
  expect(historicalAction).toBeTruthy(); await act(async () => historicalAction.click());
  expect(mocks.selectChoice).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  await render(session, [{ ...prior, meta: { ...prior.meta, superseded: false } }]);
  const choice = [...container.querySelectorAll('button')].find(button => button.title === '选择该行动')!;
  await act(async () => choice.click());
  expect(mocks.selectChoice).toHaveBeenCalledExactlyOnceWith('喝茶');
});
