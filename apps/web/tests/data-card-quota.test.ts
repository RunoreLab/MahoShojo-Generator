import { describe, expect, it } from 'vitest';
import {
  getDataCardBaseSlotCostFromBytes,
  getDataCardChargedSlotsFromBytes,
  getDataCardSlotUsage,
} from '@/lib/data-card-quota';
import { DATA_CARD_SLOT_BYTES, MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';

describe('data-card quota', () => {
it('uses 300KiB as one slot', () => {
    // `MAX_DATA_CARD_BYTES === 1MiB` 原本在这里也断言了一次，与
    // `tests/data-card-size.test.ts` 逐字重复。两处留一处即可：那条不变量属于
    // `data-card-size`，本文件只管「多少字节算几个槽」。
    expect(DATA_CARD_SLOT_BYTES).toBe(300 * 1024);
  });

  it('charges by started 300KiB blocks', () => {
    expect(getDataCardBaseSlotCostFromBytes(1)).toBe(1);
    expect(getDataCardBaseSlotCostFromBytes(DATA_CARD_SLOT_BYTES)).toBe(1);
    expect(getDataCardBaseSlotCostFromBytes(DATA_CARD_SLOT_BYTES + 1)).toBe(2);
    expect(getDataCardBaseSlotCostFromBytes(900 * 1024)).toBe(3);
    expect(getDataCardBaseSlotCostFromBytes(MAX_DATA_CARD_BYTES)).toBe(4);
  });

  it('hot cards waive only one base slot', () => {
    expect(getDataCardChargedSlotsFromBytes(100 * 1024, true)).toBe(0);
    expect(getDataCardChargedSlotsFromBytes(700 * 1024, true)).toBe(2);
    expect(getDataCardChargedSlotsFromBytes(700 * 1024, false)).toBe(3);
  });

  it('reserves the larger of current and pending data', () => {
    expect(getDataCardSlotUsage({
      data: 'a'.repeat(100 * 1024),
      pendingData: 'a'.repeat(700 * 1024),
      favoriteCount: 0,
      usageCount: 0,
    })).toBe(3);
  });
});
