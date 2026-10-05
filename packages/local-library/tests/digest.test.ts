import { describe, expect, it } from 'vitest';

import {
  LOCAL_CARD_TRANSPORT_META_KEYS,
  deriveLocalDataCardIdV1,
  stripLocalCardTransportMeta,
} from '../src/digest';

describe('stripLocalCardTransportMeta', () => {
  it('只移除在线选卡的传输元字段，保留内容层的 _ 扩展字段', () => {
    // 这个区分是本函数存在的全部理由：`_battle_story` 是内容（章节结构），
    // `_cardId` 是展示层投影。把两者一起剥掉会静默改变所有情景卡的摘要。
    const cleaned = stripLocalCardTransportMeta({
      title: '固定章节情景',
      _battle_story: { total_chapters: 5, plan_mode: 'fixed' },
      elements: { scene: { time: '深夜' } },
      _cardId: 'card-1',
      _cardName: '固定章节情景',
      _author: 'alice',
      nested: {
        _battle_story: { total_chapters: 3, plan_mode: 'suggested' },
        _cardDescription: 'transport meta should be removed',
      },
    }) as Record<string, any>;

    expect(cleaned._cardId).toBeUndefined();
    expect(cleaned._cardName).toBeUndefined();
    expect(cleaned._author).toBeUndefined();
    expect(cleaned._battle_story).toEqual({ total_chapters: 5, plan_mode: 'fixed' });
    expect(cleaned.nested._cardDescription).toBeUndefined();
    expect(cleaned.nested._battle_story).toEqual({ total_chapters: 3, plan_mode: 'suggested' });
  });

  it('重建对象而不是就地删除，调用方持有的原对象不受影响', () => {
    const original = { _cardId: 'card-1', keep: 1 };
    const cleaned = stripLocalCardTransportMeta(original) as Record<string, unknown>;

    expect(cleaned).not.toBe(original);
    expect(original._cardId).toBe('card-1');
  });

  it('递归进入数组内的对象', () => {
    const cleaned = stripLocalCardTransportMeta([{ _cardId: 'a', v: 1 }, [{ _author: 'b', v: 2 }]]) as any[];
    expect(cleaned[0]).toEqual({ v: 1 });
    expect(cleaned[1][0]).toEqual({ v: 2 });
  });

  it('原样返回非对象值', () => {
    expect(stripLocalCardTransportMeta(null)).toBeNull();
    expect(stripLocalCardTransportMeta(7)).toBe(7);
    expect(stripLocalCardTransportMeta('x')).toBe('x');
  });

  it('导出传输元字段清单，使调用方与测试能对同一份定义断言', () => {
    // 清单本身是摘要算法的一部分：改动它等同于改动全部历史卡的摘要。
    expect(LOCAL_CARD_TRANSPORT_META_KEYS.has('_battle_story')).toBe(false);
    expect(LOCAL_CARD_TRANSPORT_META_KEYS.has('_cardId')).toBe(true);
  });
});

describe('deriveLocalDataCardIdV1', () => {
  it('取算法前缀之后的前 32 位十六进制并加 lc_ 前缀', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    expect(deriveLocalDataCardIdV1(digest)).toBe(`lc_${'a'.repeat(32)}`);
  });

  it('对同一摘要稳定，对不同摘要不同', () => {
    const one = deriveLocalDataCardIdV1(`sha256:${'1'.repeat(64)}`);
    const two = deriveLocalDataCardIdV1(`sha256:${'2'.repeat(64)}`);
    expect(one).toBe(deriveLocalDataCardIdV1(`sha256:${'1'.repeat(64)}`));
    expect(one).not.toBe(two);
  });
});
