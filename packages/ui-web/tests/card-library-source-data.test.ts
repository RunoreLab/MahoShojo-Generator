import { describe, expect, it } from 'vitest';
import { mapPublicDataCardRowToBattleSelectionPayload, mapPublicDataCardRowToSourceData } from '../src/card-library/read-mappers';

describe('lossless library source snapshot separate from legacy battle metadata', () => {
  it.each(['object', 'json'] as const)('keeps colliding and nested underscore fields for %s data without trusting source identity', (format) => {
    const data = { templateId: '通用角色', name: '角色', content: '正文', _cardId: 'source-fictional-id', _cardName: 'source-name-extension', _author: { note: 'source-author-extension' }, extensions: { _nested: { retained: true } } };
    const original = structuredClone(data);
    const row = { id: 'real-cloud-id', name: '库标题', username: '库作者', type: 'character', is_public: 1, data: format === 'json' ? JSON.stringify(data) : data };
    const raw = mapPublicDataCardRowToSourceData(row);
    const battle = mapPublicDataCardRowToBattleSelectionPayload(row);
    expect(raw).toEqual(original);
    expect(battle).toMatchObject({ _cardId: 'real-cloud-id', _cardName: '库标题', _author: '库作者', _storageLocation: 'cloud' });
    (raw.extensions as { _nested: { retained: boolean } })._nested.retained = false;
    expect(data).toEqual(original);
    expect((battle.extensions as { _nested: { retained: boolean } })._nested.retained).toBe(true);
  });
});
