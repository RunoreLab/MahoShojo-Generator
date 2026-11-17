// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { GenerationRankingQueueResult } from '@mahoshojo/contracts/arena-generation-ranking';
import { ArenaRankingQueueFeedback } from '../src/arena';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let roots: Root[] = [];
afterEach(() => { for (const root of roots) act(() => root.unmount()); roots = []; });

const result = (patch: Partial<GenerationRankingQueueResult> = {}): Readonly<GenerationRankingQueueResult> => Object.freeze({
  eligible: true, ineligibleReasons: [], eventStatus: 'applied', skipReason: null,
  rating: 1012, games: 1, tier: null, delta: 12, rank: null, total: null, rankDelta: null, ...patch,
});
const render = (value: Readonly<GenerationRankingQueueResult> | null, fallbackRating?: number | null, queue: 'strict' | 'free' = 'strict') => {
  const element = document.createElement('div');
  const root = createRoot(element); roots.push(root);
  act(() => root.render(<ArenaRankingQueueFeedback queue={queue} result={value} fallbackRating={fallbackRating} />));
  return element;
};

it.each(['strict', 'free'] as const)('explains server entity-binding failures for %s', (queue) => {
  for (const [skipReason, message] of [
    ['entity-binding-missing', '缺少服务器角色来源校验，本局不计分'],
    ['entity-body-mismatch', '角色正文与所选来源不一致，本局不计分'],
    ['entity-reference-unavailable', '角色来源当前不可验证，本局不计分'],
    ['entity-version-changed', '生成后角色来源已更新，本局不计分'],
  ]) {
    const element = render(result({ eventStatus: 'skipped', skipReason }), undefined, queue);
    expect(element.querySelector('[title]')?.getAttribute('title')).toBe(message);
  }
});

describe('shared Arena ranking queue feedback', () => {
  it('explains a rejected Strict ownership check in the report', () => {
    const element = render(result({ eventStatus: 'skipped', skipReason: 'strict-no-owned-combatant' }));
    expect(element.querySelector('[title]')?.getAttribute('title'))
      .toBe('严格排位要求两名参战者中至少一名为当前账号的线上角色卡');
    expect(element.textContent).not.toContain('strict-no-owned-combatant');
  });
  it.each([true, false])('uses the recorded event outcome before eligibility=%s', eligible => {
    const common = { eligible, ineligibleReasons: ['need-login'] };
    for (const [eventStatus, expected] of [['applied', '已计分'], ['pending', '结算中'], ['skipped', '未计分'], ['failed', '结算失败']] as const) {
      const element = render(result({ ...common, eventStatus, skipReason: 'winner-empty' }));
      expect(element.textContent).toContain(expected);
      expect(element.textContent).not.toContain('不符合计分资格');
      expect(element.textContent).not.toContain('需登录');
      if (eventStatus === 'failed') expect(element.textContent).not.toContain('未计分');
      if (eventStatus !== 'applied') expect(element.textContent).not.toContain('本局变化');
      expect(element.querySelector('[role="status"], [aria-live]')).toBeNull();
    }
  });

  it.each([12, -3, 0, 0.25, -0.5, 1e20])('preserves finite delta %s with an explicit signed label', delta => {
    const element = render(result({ delta, eligible: false }));
    const signed = delta >= 0 ? `+${delta}` : String(delta);
    expect(element.textContent).toContain(`已计分；本局变化：Δ${signed}`);
    expect(element.querySelector(`[title="本局变化：${signed}"]`)).not.toBeNull();
  });

  it.each([true, false])('keeps applied with null delta scored for eligibility=%s without inventing zero', eligible => {
    const element = render(result({ eligible, delta: null, rating: null }));
    expect(element.textContent).toBe('严格：-（已计分；本局变化未返回）');
    expect(element.textContent).not.toContain('Δ');
  });

  it('distinguishes missing eligible records from ineligible records and supplies an empty-reason fallback', () => {
    expect(render(result({ eventStatus: 'missing' })).textContent).toBe('严格：1012（暂无结算记录，状态待确认）');
    const ineligible = render(result({ eventStatus: 'missing', eligible: false, ineligibleReasons: ['free-disabled', 'need-login'] }));
    expect(ineligible.querySelector('.sr-only')?.textContent).toBe('（不符合计分资格：未开启自由排位、需登录；暂无结算记录）');
    expect(ineligible.textContent).not.toContain('结算中');
    expect(render(result({ eventStatus: 'missing', eligible: false })).querySelector('.sr-only')?.textContent)
      .toBe('（不符合计分资格：未返回原因；暂无结算记录）');
  });

  it('preserves null result and rating fallbacks, including zero', () => {
    expect(render(null).textContent).toBe('严格：-');
    expect(render(null, 0, 'free').textContent).toBe('自由：0');
    expect(render(result({ rating: null }), 777).textContent).toContain('严格：777');
    expect(render(result({ rating: 0 }), 777).textContent).toContain('严格：0');
    expect(render(result({ rating: -0.25 }), 777).textContent).toContain('严格：-0.25');
  });

  it('retains full long reasons for assistive text and title while shortening only the visible text', () => {
    const reason = '今日严格排位次数已达上限（按 UTC 00:00/北京时间 08:00 刷新）';
    const element = render(result({ eventStatus: 'skipped', skipReason: 'daily-limit' }));
    expect(element.querySelector('.sr-only')?.textContent).toBe(`（未计分：${reason}）`);
    expect(element.querySelector('[title]')?.getAttribute('title')).toBe(reason);
    expect(element.querySelector('[aria-hidden="true"]')?.textContent).toBe(`（未计分：${Array.from(reason).slice(0, 18).join('')}…）`);
    expect(render(result({ eventStatus: 'failed' })).querySelector('.sr-only')?.textContent).toBe('（结算失败：未知原因）');
  });

  it.each(['__proto__', 'constructor', 'toString', '<script>alert("ranking")</script><img src="x">', '😀'.repeat(20)])('renders unknown reason %s as literal text', reason => {
    for (const value of [
      result({ eventStatus: 'failed', skipReason: reason }),
      result({ eventStatus: 'missing', eligible: false, ineligibleReasons: [reason] }),
    ]) {
      const element = render(value);
      expect(element.querySelector('.sr-only')?.textContent).toContain(reason);
      expect(element.querySelector('[title]')?.getAttribute('title')).toBe(reason);
      expect(element.querySelector('script, img')).toBeNull();
      expect(element.querySelector('[aria-hidden="true"]')?.textContent).toContain(Array.from(reason).slice(0, 18).join(''));
    }
  });
});
