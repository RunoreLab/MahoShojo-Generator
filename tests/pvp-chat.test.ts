import { describe, expect, test } from 'bun:test';

import { normalizePvpChatSendBody, validateAndBuildPvpChatMessage } from '@/lib/pvp/chat';

describe('pvp: chat message normalize/validate', () => {
  test('允许仅发送 emoji', () => {
    const body = normalizePvpChatSendBody({ emoji: '☺️' });
    const built = validateAndBuildPvpChatMessage(body);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.emoji).toBeTruthy();
    expect(built.value.renderedText).toBe(null);
    expect(built.value.stickerId).toBe(null);
  });

  test('允许仅发送表情包', () => {
    const built = validateAndBuildPvpChatMessage({ stickerId: 'sparkle' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.stickerId).toBe('sparkle');
    expect(built.value.renderedText).toBe(null);
  });

  test('允许仅发送快捷消息', () => {
    const built = validateAndBuildPvpChatMessage({ quickTextId: 'agree' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.quickTextId).toBe('agree');
    expect(built.value.renderedText).toBe('同意');
  });

  test('允许仅发送句式文字', () => {
    const built = validateAndBuildPvpChatMessage({
      phrase: { patternId: 'status', selections: { subject: 'me', state: 'ready' } },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.renderedText).toBe('我准备好了');
  });

  test('拒绝同时发送句式与快捷消息', () => {
    const built = validateAndBuildPvpChatMessage({
      phrase: { patternId: 'status', selections: { subject: 'me', state: 'ready' } },
      quickTextId: 'agree',
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe('TEXT_CONFLICT');
  });
});

