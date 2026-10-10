import { describe, expect, it } from 'vitest';

import {
  applyArenaReconciliationUpdates,
  buildArenaReconciliationRetryPayload,
  projectArenaReconciliationCombatants,
} from '../src/arena-reconciliation';

const first = {
  type: 'general-character', filename: 'first.json', isPreset: false, isValid: true,
  data: { name: '同名角色', marker: 'first' },
};
const second = {
  ...first, filename: 'second.json', data: { name: '同名角色', marker: 'second' },
};

describe('Arena reconciliation 的客户端纯投影', () => {
  it('只投影当前卡片与稳定 wrapper，不重算签名、generation_id 或服务器冻结 effect', async () => {
    const data = {
      name: '同名角色', signature: 'server-signature',
      arena_history: { entries: [{ metadata: { generation_id: 'previous-generation' } }] },
      current_state: { generation_id: 'previous-generation', summary: '当前状态' },
    };
    const payload = await buildArenaReconciliationRetryPayload(' generation-current ', [{
      ...first, data, filename: ' first.json ', sourceDataCardId: ' source-1 ', dataCardId: 'fallback',
      sourceDataCardUpdatedAt: 'not-an-authority-token', roomCombatantKey: ' room-1 ',
      arenaRoomKey: 'room-fallback', characterGuidance: '服务器应使用冻结值',
    }]);
    expect(payload).toEqual({
      generationId: 'generation-current',
      combatants: [{
        type: first.type, data, isPreset: false, filename: 'first.json',
        sourceDataCardId: 'source-1', roomCombatantKey: 'room-1',
      }],
    });
    expect(payload.combatants[0].data).toBe(data);
    expect(projectArenaReconciliationCombatants([{
      ...first, filename: ' ', sourceDataCardId: ' ', dataCardId: ' card-fallback ',
      roomCombatantKey: '', arenaRoomKey: ' room-fallback ',
    }])[0]).toEqual({
      type: first.type, data: first.data, isPreset: false,
      dataCardId: 'card-fallback', roomCombatantKey: 'room-fallback',
    });
  });

  it('生成后先重排再重试时，index 指本次当前可读角色数组而不是生成时位置或名字', () => {
    const roster = [second, first];
    const updatedData = { name: '改名后的角色', marker: 'second-updated', signature: 'server-result' };
    const result = applyArenaReconciliationUpdates(roster, [{
      combatantIndex: 0, data: updatedData, isNative: true,
    }]);
    expect(result.combatants).toEqual([{ ...second, data: updatedData, isValid: true }, first]);
    expect(result.combatants[1]).toBe(first);
    expect(result.updatedCombatants).toEqual([updatedData]);
    expect(roster).toEqual([second, first]);
  });

  it('占位符不占 index，缺失角色不会按名字补回，未返回角色保持原引用', () => {
    const placeholder = { type: 'random-magical-girl', id: 'slot-1' };
    const updatedData = { name: '同名角色', marker: 'server-second' };
    const result = applyArenaReconciliationUpdates([placeholder, first, second], [{
      combatantIndex: 1, data: updatedData, isNative: false,
    }]);
    expect(result.combatants).toEqual([placeholder, first, { ...second, data: updatedData, isValid: false }]);
    expect(result.combatants[0]).toBe(placeholder);
    expect(result.combatants[1]).toBe(first);
    expect(applyArenaReconciliationUpdates([second], []).combatants).toEqual([second]);
  });

  it('保留旧响应形状筛选及严格 isNative 布尔语义，不从签名字段猜原生性', () => {
    const data = { name: '同名角色', signature: 'unverified-field' };
    const result = applyArenaReconciliationUpdates([first, second], [
      null, [], 'bad', {}, { combatantIndex: -1, data }, { combatantIndex: 0.5, data },
      { combatantIndex: Number.MAX_SAFE_INTEGER + 1, data }, { combatantIndex: '0', data },
      { combatantIndex: 0, data: [] }, { combatantIndex: 0, data: null },
      { combatantIndex: 1, data, isNative: 'true' },
    ]);
    expect(result.updatedCombatants).toEqual([data]);
    expect(result.combatants).toEqual([first, { ...second, data, isValid: false }]);
  });
});
