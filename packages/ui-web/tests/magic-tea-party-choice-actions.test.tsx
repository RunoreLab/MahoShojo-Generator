// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MagicTeaPartyMessage, MagicTeaPartyPreferences, MagicTeaPartySession } from '@mahoshojo/domain/magic-tea-party/types';
import { MagicTeaPartyChatComposer, MagicTeaPartyChatMessage } from '../src/magic-tea-party';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session: MagicTeaPartySession = { id: 'tea', title: '茶会', createdAt: 1, updatedAt: 1, roles: [], settings: { providerId: 'test', modelId: 'test' } };
const preferences = { outputFormat: 'jsonl', userDisplayName: '旅人' } as MagicTeaPartyPreferences;
const item = { id: 'tea', text: '喝茶' };
const rawOutput = JSON.stringify({ type: 'choices', items: [item] });
const message: MagicTeaPartyMessage = { id: 'm', sessionId: 'tea', role: 'assistant', content: '- 喝茶', createdAt: 1, status: 'done', segments: [{ type: 'choices', items: [item] }] };
let root: Root;
let container: HTMLDivElement;
const render = async (node: ReactNode) => act(async () => root.render(node));
const choiceButtons = () => [...container.querySelectorAll('button')].filter((button) => button.title === '选择该行动');
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('retains legacy choices and validates raw multi-block choices without treating true as authority', async () => {
  const choose = vi.fn();
  const second = { id: 'window', text: '看看窗外' };
  for (const value of [message, ...['completed', 'provider'].map((completion) => ({ ...message, meta: { rawOutput, choicesValid: true, completion } }))]) {
    await render(<MagicTeaPartyChatMessage message={value} session={session} preferences={preferences} isGenerating={false} onSelectChoice={choose} />);
    await act(async () => choiceButtons()[0].click());
  }
  expect(choose).toHaveBeenCalledTimes(3);
  const multi: MagicTeaPartyMessage = { ...message, segments: [...message.segments!, { type: 'choices', items: [second] }], meta: { rawOutput: `${rawOutput}\n${JSON.stringify({ type: 'choices', items: [second] })}`, notices: [{ level: 'warning', message: '提示' }] } };
  await render(<MagicTeaPartyChatMessage message={multi} session={session} preferences={preferences} isGenerating={false} onSelectChoice={choose} />);
  expect(choiceButtons()).toHaveLength(2);
  await act(async () => choiceButtons()[1].click());
  expect(choose).toHaveBeenLastCalledWith('看看窗外');
});

it('rejects stopped, failed, blocked, empty, error-notice and altered imported actions even with choicesValid=true', async () => {
  const choose = vi.fn();
  const variants: Partial<MagicTeaPartyMessage>[] = [
    { status: 'error' }, { status: 'blocked' }, { status: 'streaming' },
    { error: { code: 'failed', message: '明确失败' }, meta: { rawOutput, choicesValid: true } },
    ...['stopped', 'failed', 'discarded', 'blocked'].map((completion) => ({ meta: { choicesValid: true, completion } })),
    { meta: { choicesValid: false } },
    { meta: { choicesValid: true, notices: [{ level: 'error', message: '禁止行动' }] } },
    { meta: { choicesValid: true, rawOutput: '' } },
    { meta: { choicesValid: true, rawOutput: `${rawOutput}\n{"type":"notice","level":"error","message":"禁止行动"}` } },
    { meta: { choicesValid: true, rawOutput }, segments: [{ type: 'choices', items: [{ id: 'tea', text: '被篡改的行动' }] }] },
    { segments: [{ type: 'choices', items: [{ id: 'empty', text: '  ' }] }] },
  ];
  for (const variant of variants) {
    await render(<MagicTeaPartyChatMessage message={{ ...message, meta: { choicesValid: true }, ...variant }} session={session} preferences={preferences} isGenerating={false} onSelectChoice={choose} />);
    expect(choiceButtons()).toHaveLength(0);
  }
  expect(choose).not.toHaveBeenCalled();
});

it('keeps large raw output display-only within the host budget and disables actions while busy', async () => {
  const choose = vi.fn();
  await render(<MagicTeaPartyChatMessage message={{ ...message, meta: { rawOutput: rawOutput + ' '.repeat(1000), choicesValid: true } }}
    session={session} preferences={preferences} isGenerating={false} onSelectChoice={choose} renderBudget={{ characters: 100, segments: 10, rawPreviewCharacters: 100 }} />);
  expect(container.textContent).toContain('喝茶');
  expect(choiceButtons()).toHaveLength(0);
  await render(<MagicTeaPartyChatMessage message={{ ...message, meta: { rawOutput } }} session={session} preferences={preferences} isGenerating onSelectChoice={choose} />);
  expect(choiceButtons()[0].disabled).toBe(true);
  await act(async () => choiceButtons()[0].click());
  expect(choose).not.toHaveBeenCalled();
});

it('discloses the current model call and Token cost without modifying the draft', async () => {
  const generate = vi.fn(), edit = vi.fn();
  await render(<MagicTeaPartyChatComposer activeSession={session} preferences={preferences} draft="尚未发送的草稿" onDraftChange={edit}
    onSend={vi.fn()} onContinue={vi.fn()} onGenerateChoices={generate} isGenerating={false} hasMessages />);
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent === '生成选项')!;
  expect(button.title).toContain('当前模型'); expect(button.title).toContain('Token');
  await act(async () => button.click());
  expect(generate).toHaveBeenCalledOnce(); expect(edit).not.toHaveBeenCalled();
  expect(container.querySelector('textarea')?.value).toBe('尚未发送的草稿');
});

it('keeps superseded actions readable but never invokes their callback, while active actions remain selectable', async () => {
  const choose = vi.fn();
  for (const meta of [{ superseded: true }, { superseded: true, rawOutput, choicesValid: true, completion: 'completed' }]) {
    await render(<MagicTeaPartyChatMessage message={{ ...message, meta }} session={session} preferences={preferences} isGenerating={false} onSelectChoice={choose} />);
    expect(container.textContent).toContain('喝茶');
    expect(container.textContent).toContain('该条消息已被更新替换');
    expect(choiceButtons()).toHaveLength(0);
    const historicalAction = [...container.querySelectorAll('div')].find(node => node.textContent === '喝茶')!;
  expect(historicalAction).toBeTruthy(); await act(async () => historicalAction.click());
  }
  expect(choose).not.toHaveBeenCalled();
  await render(<MagicTeaPartyChatMessage message={{ ...message, meta: { superseded: false, rawOutput } }} session={session} preferences={preferences} isGenerating={false} onSelectChoice={choose} />);
  await act(async () => choiceButtons()[0].click());
  expect(choose).toHaveBeenCalledExactlyOnceWith('喝茶');
});
