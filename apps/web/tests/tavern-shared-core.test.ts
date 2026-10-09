import { describe, expect, it } from 'vitest';
import * as shared from '@mahoshojo/domain/tavern-card';
import * as web from '@/lib/tavern-card';

describe('Tavern Web 回用共享纯核', () => {
  it('生产出口直接使用同一实现而非双份转换器', () => {
    for (const name of ['parseTavernCardFromPngBytes', 'normalizeTavernCard', 'createTavernV3Card', 'writeTavernCardToPngBytes', 'recommendTavernExportFields', 'buildArenaWorldbook', 'buildTavernScenarioFragment'] as const) {
      expect(web[name]).toBe(shared[name]);
    }
  });
  it('未知扩展和未验证签名字段在 PNG 往返中原样保留，不改来源权威', () => {
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '测试', description: '说明', extensions: { unknown: { nested: [1, '二'] } } }, signature: 'unverified-input', vendor: { extra: true } };
    const result = shared.parseTavernCardFromPngBytes(web.writeTavernCardToPngBytes(shared.getPlaceholderPngBytes(), card));
    if ('code' in result) throw new Error(result.message);
    expect(result.selected.parsed).toEqual(card);
    expect(result.selected.parsed).not.toHaveProperty('provenance');
  });
});
