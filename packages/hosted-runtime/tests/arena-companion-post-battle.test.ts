import { describe, expect, it, vi } from 'vitest';
import type { SignatureService } from '../src/signature';
import { createArenaPostBattleProjector } from '../src/arena-companion/post-battle';

const signatures: SignatureService = {
  verifySignature: vi.fn(async (value: unknown) => (
    Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).signature === 'valid')
  )),
  generateSignature: vi.fn(async () => 'server-signature'),
};

const baseInput = {
  report: {
    headline: '决战',
    mode: 'classic',
    officialReport: { winner: '角色甲', conclusion: '结束' },
  },
  impacts: [{ characterName: '角色甲', impact: '成长', currentStateSummary: '平静' }],
  userGuidance: null,
  scenario: null,
  writeArenaHistory: true,
  writeCurrentState: true,
  generationId: 'arena_generation_1',
  occurredAt: '2026-08-26T00:00:00.000Z',
  baseRevisionHash: null,
} as const;

describe('Arena companion post-battle projector', () => {
  it('仅以服务器签名校验判定原生性并对可信更新重新签名', async () => {
    const project = createArenaPostBattleProjector({
      signatures,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    });
    const updated = await project({
      ...baseInput,
      combatants: [{ isNative: false, data: { codename: '角色甲', signature: 'valid' } }],
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      codename: '角色甲',
      signature: 'server-signature',
      current_state: {
        summary: '平静',
        generation_id: 'arena_generation_1',
      },
      arena_history: {
        entries: [{
          impact: '成长',
          metadata: {
            generation_id: 'arena_generation_1',
            non_native_data_involved: false,
          },
        }],
      },
    });
    expect(signatures.generateSignature).toHaveBeenCalledTimes(1);
  });

  it('拒绝客户端 isNative 提权且同名原生性冲突时 fail closed', async () => {
    vi.mocked(signatures.generateSignature).mockClear();
    const project = createArenaPostBattleProjector({
      signatures,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    });
    const updated = await project({
      ...baseInput,
      combatants: [
        { isNative: true, data: { codename: '角色甲', signature: 'valid' } },
        { isNative: true, data: { codename: '角色甲', signature: 'forged' } },
      ],
    });

    expect(updated).toHaveLength(2);
    expect(updated.every((item) => !('signature' in item))).toBe(true);
    expect(updated.every((item) => (
      (item.arena_history as any).entries[0].metadata.non_native_data_involved === true
    ))).toBe(true);
    expect(signatures.generateSignature).not.toHaveBeenCalled();
  });

  it('相同 generationId 的重复投影不追加历战记录或当前状态', async () => {
    const project = createArenaPostBattleProjector({
      signatures,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    });
    const updated = await project({
      ...baseInput,
      combatants: [{
        data: {
          codename: '角色甲',
          signature: 'valid',
          arena_history: {
            attributes: {},
            entries: [{ id: 1, metadata: { generation_id: 'arena_generation_1' } }],
          },
          current_state: { summary: '已应用', generation_id: 'arena_generation_1' },
        },
      }],
    });

    expect(updated).toEqual([]);
  });
});
