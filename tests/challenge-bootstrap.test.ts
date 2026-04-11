import { describe, expect, test } from 'bun:test';

import { acceptBootstrapSnapshot } from '@/lib/challenge/progression';
import { buildArenaBootstrapSnapshot } from '@/lib/challenge/worlds/arena/bootstrap';

const mockCharacterCard = {
  id: 'card-mist-lamp',
  codename: '雾灯',
  magicalGirl: {
    codename: '雾灯',
  },
  magicConstruct: {
    name: '雾灯杖',
    basicAbilities: ['魔弹', '护盾', '定向闪避'],
    description: '擅长中距离压制与空间整理。',
  },
  blooming: {
    powerLevel: 'leaf',
  },
  analysis: {
    personalityAnalysis: '克制谨慎，重视观察窗口。',
    abilityReasoning: '偏向中距离压制与节奏控制。',
    coreTraits: ['冷静', '谨慎'],
    predictionBasis: '长期独处与巡夜经验让她更擅长试探与拉扯。',
  },
  buildState: {
    primaryRuleId: 'arena-trpg-lite',
    rules: [
      {
        ruleId: 'arena-trpg-lite',
        version: '1.0.0',
        blockResults: {
          powerLevel: 'leaf',
          coreAttributes: {
            STR: 44,
            CON: 46,
            AGI: 40,
            MAG: 52,
            WILL: 48,
            PER: 32,
            CHM: 28,
          },
          specialties: ['magic-bullet', 'magic-shield'],
        },
        derived: {
          HP: 9,
          MP: 13,
          Radiance: 10,
        },
        validationSummary: {
          valid: true,
          issues: [],
          missingRequiredBlockKeys: [],
        },
      },
    ],
  },
};

describe('challenge bootstrap', () => {
  test('arena bootstrap 会生成 tracks.hp/radiance/currency 与一次免费重掷标记', () => {
    const result = buildArenaBootstrapSnapshot(mockCharacterCard, { snapshotSeed: 'seed-a' });

    expect(result.playerSnapshot.displayName).toBe('雾灯');
    expect(result.playerSnapshot.snapshotSeed).toBe('seed-a');
    expect(result.playerSnapshot.baseTrackSnapshot.hp.current).toBeGreaterThan(0);
    expect(result.playerSnapshot.baseTrackSnapshot.radiance.current).toBeGreaterThan(0);
    expect(result.initialWorldState.tracks.currency.current).toBeGreaterThanOrEqual(0);
    expect(result.initialWorldState.persistentItemIds).toEqual([]);
    expect(result.initialWorldState.consumableIds).toEqual([]);
  });

  test('acceptBootstrapSnapshot 仅在接受快照后生成 runSeed，并立刻冻结 mapState 与 bootstrap checkpoint', () => {
    const bootstrap = buildArenaBootstrapSnapshot(mockCharacterCard, { snapshotSeed: 'seed-a' });

    const accepted = acceptBootstrapSnapshot(
      {
        runId: 'run-bootstrap-1',
        worldPresetId: 'arena',
        playerSnapshot: bootstrap.playerSnapshot,
        initialWorldState: bootstrap.initialWorldState,
        usedBootstrapReroll: false,
        startedAt: 100,
      },
      {
        snapshotSeed: 'seed-a',
        createRunSeed: () => 'run-seed-fixed',
        now: 120,
      }
    );

    expect(accepted.runState.runSeed).toBe('run-seed-fixed');
    expect(accepted.runState.mapState?.nodes).toHaveLength(14);
    expect(accepted.runState.status).toBe('in_progress');
    expect(accepted.runRecordPatch.runSeed).toBe('run-seed-fixed');
    expect(accepted.runRecordPatch.runState).toMatchObject({
      runSeed: 'run-seed-fixed',
      mapState: {
        nodes: expect.any(Array),
      },
    });
    expect(accepted.checkpoint.kind).toBe('bootstrap_accepted');
    expect(accepted.checkpoint.snapshot.runState).toMatchObject({
      runSeed: 'run-seed-fixed',
    });
  });

  test('acceptBootstrapSnapshot 会校验 snapshotSeed 与 bootstrap 快照一致', () => {
    const bootstrap = buildArenaBootstrapSnapshot(mockCharacterCard, { snapshotSeed: 'seed-a' });

    expect(() =>
      acceptBootstrapSnapshot(
        {
          runId: 'run-bootstrap-2',
          worldPresetId: 'arena',
          playerSnapshot: bootstrap.playerSnapshot,
          initialWorldState: bootstrap.initialWorldState,
          usedBootstrapReroll: true,
          startedAt: 100,
        },
        {
          snapshotSeed: 'seed-b',
          createRunSeed: () => 'run-seed-mismatch',
          now: 120,
        }
      )
    ).toThrow('BOOTSTRAP_SNAPSHOT_SEED_MISMATCH');
  });
});
