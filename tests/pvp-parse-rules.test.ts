import { describe, expect, test } from 'bun:test';

import { DEFAULT_PVP_RULES } from '@/lib/pvp/defaults';
import { parsePvpRules } from '@/lib/pvp/validate';

describe('pvp: parsePvpRules', () => {
  test('默认值包含 showAllSubmissions/shuffleDecks', () => {
    const parsed = parsePvpRules({});
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.showAllSubmissions).toBe(true);
    expect(parsed.rules.shuffleDecks).toBe(true);
  });

  test('默认值包含 dealWhenEmpty/recycleUsedCards', () => {
    const parsed = parsePvpRules({});
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.dealWhenEmpty).toBe(DEFAULT_PVP_RULES.dealWhenEmpty);
    expect(parsed.rules.recycleUsedCards).toBe(DEFAULT_PVP_RULES.recycleUsedCards);
  });

  test('默认值包含 drawSource', () => {
    const parsed = parsePvpRules({});
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.drawSource).toBe(DEFAULT_PVP_RULES.drawSource);
  });

  test('默认值包含 allowSpectators（默认开启观战）', () => {
    const parsed = parsePvpRules({});
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.allowSpectators).toBe(true);
  });

  test('可显式关闭 allowSpectators', () => {
    const parsed = parsePvpRules({ allowSpectators: false });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.allowSpectators).toBe(false);
  });

  test('可显式关闭 showAllSubmissions/shuffleDecks', () => {
    const parsed = parsePvpRules({ showAllSubmissions: false, shuffleDecks: false });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.showAllSubmissions).toBe(false);
    expect(parsed.rules.shuffleDecks).toBe(false);
  });

  test('允许“每人提交数量”与“每人初始手牌数量”任意组合（不再要求提交 > 发牌）', () => {
    const parsed = parsePvpRules({ cardsPerPlayer: 3, dealPerPlayer: 10 });
    expect('error' in parsed).toBe(false);
  });

  test('允许“每人提交数量=0”（跳过提交阶段）', () => {
    const parsed = parsePvpRules({ cardsPerPlayer: 0 });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.rules.cardsPerPlayer).toBe(0);
  });

  test('允许设置 drawSource', () => {
    const parsed = parsePvpRules({ drawSource: 'preset+public' });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.rules.drawSource).toBe('preset+public');
  });

  test('非法 drawSource 回退到默认', () => {
    const parsed = parsePvpRules({ drawSource: 'nope' });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.rules.drawSource).toBe(DEFAULT_PVP_RULES.drawSource);
  });

  test('非布尔值回退到默认', () => {
    const parsed = parsePvpRules({ showAllSubmissions: 1, shuffleDecks: 'nope' });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.showAllSubmissions).toBe(DEFAULT_PVP_RULES.showAllSubmissions);
    expect(parsed.rules.shuffleDecks).toBe(DEFAULT_PVP_RULES.shuffleDecks);
  });

  test('默认值包含“对局生成设置”（默认全关/留空）', () => {
    const parsed = parsePvpRules({});
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.readArenaHistory).toBe(false);
    expect(parsed.rules.writeArenaHistory).toBe(false);
    expect(parsed.rules.readCurrentState).toBe(false);
    expect(parsed.rules.writeCurrentState).toBe(false);
    expect(parsed.rules.selectedLevel).toBe('');
    expect(parsed.rules.userGuidance).toBe('');
    expect(parsed.rules.storyLength).toBe('default');
    expect(parsed.rules.language).toBe('');
    expect(parsed.rules.adjudicationEvents).toEqual([]);
  });

  test('非法“对局生成设置”回退/截断为安全值', () => {
    const parsed = parsePvpRules({
      selectedLevel: 'nope',
      storyLength: 'x',
      language: 'x'.repeat(999),
      userGuidance: 'a'.repeat(999),
      adjudicationEvents: new Array(999).fill('nope'),
      readArenaHistoryLimit: 99999,
    });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.selectedLevel).toBe(DEFAULT_PVP_RULES.selectedLevel);
    expect(parsed.rules.storyLength).toBe(DEFAULT_PVP_RULES.storyLength);
    expect(parsed.rules.language.length).toBeLessThanOrEqual(32);
    expect(parsed.rules.userGuidance.length).toBeLessThanOrEqual(50);
    expect(parsed.rules.adjudicationEvents.length).toBeLessThanOrEqual(50);
    expect(parsed.rules.readArenaHistoryLimit).toBeLessThanOrEqual(999);
  });
});
