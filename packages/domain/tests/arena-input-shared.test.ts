import { describe, expect, it, vi } from 'vitest';
import { parseCombatantsFromText } from '../src/arena-file-parser';
import { buildArenaMaterialState } from '../src/arena-materials';
import { convertWantuDataCardToGeneralCharacter } from '../src/wantu-card/wantu-data-card';
import { fromWantuCharacterCard, toWantuCharacterCard } from '../src/wantu-card/adapter';
const source = { templateId: '通用角色', name: '甲', content: '原始内容', custom: { deeply: ['保留', 1] } };
describe('shared Arena input compatibility', () => {
  it('keeps adjacent JSON and source objects; host verification remains independent', async () => {
    const verifyOrigin = vi.fn(async () => true);
    const text = `${JSON.stringify(source)}${JSON.stringify({ ...source, name: '乙' })}`;
    const parsed = await parseCombatantsFromText(text, { existingCount: 0, verifyOrigin });
    expect(parsed).toHaveLength(2); expect(parsed[0]?.data).toEqual(source); expect(parsed[0]?.isValid).toBe(true); expect(verifyOrigin).toHaveBeenCalledTimes(2);
    const desktop = await parseCombatantsFromText(JSON.stringify([source]), { existingCount: 0, maxCombatants: 32 });
    expect(desktop[0]?.isValid).toBe(false); expect(desktop[0]?.data.custom).toEqual(source.custom);
  });
  it('allows exactly 32 Desktop roles, rejects 33 atomically, preserves uncapped Web default', async () => {
    expect(await parseCombatantsFromText(JSON.stringify(Array(32).fill(source)), { existingCount: 0, maxCombatants: 32 })).toHaveLength(32);
    await expect(parseCombatantsFromText(JSON.stringify([source, source]), { existingCount: 31, maxCombatants: 32 })).rejects.toThrow('32');
    expect(await parseCombatantsFromText(JSON.stringify(Array(33).fill(source)), { existingCount: 0 })).toHaveLength(33);
  });
  it('keeps magical legacy correction and named compatibility', async () => {
    const warning = vi.fn();
    const cards = await parseCombatantsFromText(JSON.stringify([{ codename: '旧卡', appearance: '旧外观', signature: 'not-verified' }, { name: '仅名字' }]), { existingCount: 0, onWarn: warning });
    expect(cards).toHaveLength(2); expect(cards.every((card) => !card.isValid)).toBe(true); expect(warning).toHaveBeenCalled();
    await expect(parseCombatantsFromText('{"unknown":true}', { existingCount: 0 })).rejects.toThrow();
  });
  it('keeps Wantu data-card conversion and roundtrip; material uses same adapter', async () => {
    const payload = { format: 'wantu-data-card', card: { name: '万途角色', domains: { content: { kind: 'text', status: 'ready', value: '万途原文' } } } };
    const converted = convertWantuDataCardToGeneralCharacter(payload);
    const cards = await parseCombatantsFromText(JSON.stringify(payload), { existingCount: 0 });
    expect(cards[0]?.data).toEqual(converted);
    const wantu = toWantuCharacterCard(source, { mode: 'roundTrip' });
    expect(fromWantuCharacterCard(wantu).success).toBe(true);
    expect(buildArenaMaterialState({ payload: wantu, id: 'fixed' })).toMatchObject({ id: 'fixed', sourceKind: 'wantu-card', isNative: false, content: wantu });
    const material = buildArenaMaterialState({ payload: { ...source, _cardId: 'cloud-card', _cardName: 'Title' }, id: 'fixed' });
    expect(material.content).toEqual(source); expect(material.sourceDataCardId).toBe('cloud-card');
  });
});
