import { describe, expect, it } from 'vitest';
import { ArenaRoomProposalResolveRequestSchema, MAX_PROPOSAL_CHANGES } from '../src/arena-room';

const ordinary = {
  expectedRoomEpoch: 'epoch-1', resolution: 'accept-selected', selectedChangeIds: ['one'],
};
const override = { ...ordinary, expectedRevision: 3, overrideChangeIds: ['one'] };

describe('房主逐项覆盖 resolve DTO', () => {
  it('兼容普通接受和空 override，并保留明确的覆盖意图', () => {
    expect(ArenaRoomProposalResolveRequestSchema.parse(ordinary)).toEqual(ordinary);
    expect(ArenaRoomProposalResolveRequestSchema.parse(override)).toEqual(override);
    expect(ArenaRoomProposalResolveRequestSchema.safeParse({ ...ordinary, overrideChangeIds: [] }).success).toBe(true);
  });
  it.each([
    { expectedRevision: undefined }, { expectedRevision: -1 },
    { selectedChangeIds: undefined }, { selectedChangeIds: [] },
    { overrideChangeIds: ['two'] }, { overrideChangeIds: ['one', 'one'] },
    { overrideChangeIds: 'one' }, { overrideChangeIds: [null] },
    { overrideChangeIds: Array.from({ length: MAX_PROPOSAL_CHANGES + 1 }, (_, i) => `id-${i}`) },
    { resolution: 'reject', selectedChangeIds: undefined },
    { resolution: 'reject', selectedChangeIds: undefined, overrideChangeIds: [] },
    { role: 'host' }, { force: true },
  ])('拒绝不合法或过宽的 override 请求 %j', (patch) => {
    expect(ArenaRoomProposalResolveRequestSchema.safeParse({ ...override, ...patch }).success).toBe(false);
  });
});
