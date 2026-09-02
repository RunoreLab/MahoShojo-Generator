import { describe, expect, it } from 'vitest';

import {
  ARENA_CANONICAL_CAPABILITIES,
  ArenaRoomGenerationResultSchema,
  ArenaRoomGenerationStartRequestSchema,
  ArenaRoomHttpErrorCodeSchema,
  ArenaRoomHttpErrorResponseSchema,
  ArenaRoomSharedConfigSchema,
  MAX_ARENA_ROOM_HOST_LOCAL_PAYLOADS,
  ReorderAuxScenariosChangeSchema,
  ReorderMaterialsChangeSchema,
} from '../src/arena-room';

const historySettings = {
  readArenaHistory: true,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  writeArenaHistory: true,
  readCurrentState: true,
  writeCurrentState: true,
  readNarrativeHistory: true,
  readNarrativeHistoryLimit: 10,
  isNarrativeHistoryUnlimited: false,
  writeNarrativeHistory: true,
} as const;

const character = (index: number) => ({
  key: `data-card:character-${index}`,
  ref: { id: `character-${index}`, kind: 'character' as const, versionToken: 'v1' },
});

const scenario = (index: number) => ({
  key: `data-card:scenario-${index}`,
  ref: { id: `scenario-${index}`, kind: 'scenario' as const, versionToken: 'v1' },
});

const material = (index: number) => ({
  key: `data-card:material-${index}`,
  ref: { id: `material-${index}`, kind: 'material' as const, versionToken: 'v1' },
});

const config = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  battleMode: 'daily',
  combatants: [character(0)],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings,
  ...overrides,
});

const reorder = (type: 'reorderAuxScenarios' | 'reorderMaterials', keys: readonly string[]) => ({
  changeId: `reorder-${type}`,
  type,
  value: [...keys].reverse(),
  expectedBase: { kind: 'value' as const, value: keys },
});

describe('GMR-10Q contract 门禁最小化', () => {
  it('[GMR10Q-CONTRACT-LIMITS] 暴露稳定且具体的 Room HTTP gate error codes，同时保持响应结构兼容', () => {
    const codes = [
      'ROOM_GENERATION_COMBATANTS_EMPTY',
      'ROOM_GENERATION_COMBATANTS_INSUFFICIENT',
      'ROOM_GENERATION_SCENARIO_REQUIRED',
      'ROOM_MEMBER_LIMIT_REACHED',
      'ROOM_PROPOSAL_PENDING_LIMIT_REACHED',
      'ROOM_CONFIG_FRAME_TOO_LARGE',
      'ROOM_HOST_LOCAL_PAYLOAD_MISSING',
      'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
      'ROOM_HOST_LOCAL_KIND_MISMATCH',
      'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
      'ROOM_HOST_LOCAL_TYPE_MISMATCH',
      'ROOM_HOST_LOCAL_PAYLOAD_MISSING_OR_MISMATCH',
      'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING',
      'ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH',
      'ROOM_REFERENCE_STALE',
    ] as const;

    expect(ArenaRoomHttpErrorCodeSchema.options).toEqual(expect.arrayContaining([...codes]));
    for (const code of codes) {
      expect(ArenaRoomHttpErrorResponseSchema.parse({ code, error: '可行动错误说明' }))
        .toEqual({ code, error: '可行动错误说明' });
    }
    expect(ArenaRoomHttpErrorResponseSchema.parse({
      code: 'ROOM_HOST_LOCAL_PAYLOAD_MISSING_OR_MISMATCH',
      error: '本地内容不完整',
    })).toMatchObject({ code: 'ROOM_HOST_LOCAL_PAYLOAD_MISSING_OR_MISMATCH' });
  });

  it('允许空 roster 安全共享，同时保留唯一键和 team 引用完整性', () => {
    expect(ArenaRoomSharedConfigSchema.safeParse(config({ combatants: [] })).success).toBe(true);
    expect(ArenaRoomSharedConfigSchema.safeParse(config({
      combatants: [character(0), character(0)],
    })).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse(config({
      combatants: [],
      teams: [{ key: 'team:missing', displayName: '缺失引用', combatantKeys: ['data-card:missing'] }],
    })).success).toBe(false);
  });

  it('角色容量只使用 canonical 32 上限', () => {
    expect(ARENA_CANONICAL_CAPABILITIES.maxCombatants).toBe(32);
    expect(ArenaRoomSharedConfigSchema.safeParse(config({ combatants: [character(0)] })).success)
      .toBe(true);
    expect(ArenaRoomSharedConfigSchema.safeParse(config({
      combatants: Array.from({ length: 32 }, (_, index) => character(index)),
    })).success).toBe(true);
    expect(ArenaRoomSharedConfigSchema.safeParse(config({
      combatants: Array.from({ length: 33 }, (_, index) => character(index)),
    })).success).toBe(false);
  });

  it('删除 aux/material 独立 10 上限，改为累计 256 reference budget', () => {
    expect(ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity).toBe(256);
    expect(ArenaRoomSharedConfigSchema.safeParse(config({
      auxScenarios: Array.from({ length: 11 }, (_, index) => scenario(index)),
      materials: Array.from({ length: 11 }, (_, index) => material(index)),
    })).success).toBe(true);
    expect(ArenaRoomSharedConfigSchema.safeParse(config({
      auxScenarios: Array.from({ length: 128 }, (_, index) => scenario(index)),
      materials: Array.from({ length: 128 }, (_, index) => material(index)),
    })).success).toBe(true);
    const overLimit = ArenaRoomSharedConfigSchema.safeParse(config({
      auxScenarios: Array.from({ length: 128 }, (_, index) => scenario(index)),
      materials: Array.from({ length: 129 }, (_, index) => material(index)),
    }));
    expect(overLimit.success).toBe(false);
    if (!overLimit.success) {
      expect(overLimit.error.issues).toContainEqual(expect.objectContaining({
        code: 'custom',
        params: {
          gateCode: 'ROOM_CONFIG_REFERENCE_LIMIT',
          current: 257,
          maximum: 256,
        },
      }));
    }
  });

  it('排序 contract 不再保留旧的每类 10 项上限', () => {
    const auxKeys = Array.from({ length: 11 }, (_, index) => scenario(index).key);
    const materialKeys = Array.from({ length: 11 }, (_, index) => material(index).key);

    expect(ReorderAuxScenariosChangeSchema.safeParse(reorder('reorderAuxScenarios', auxKeys)).success)
      .toBe(true);
    expect(ReorderMaterialsChangeSchema.safeParse(reorder('reorderMaterials', materialKeys)).success)
      .toBe(true);
  });

  it('host-local payload 与结果投影跟随 canonical 角色/参考项容量', () => {
    expect(MAX_ARENA_ROOM_HOST_LOCAL_PAYLOADS).toBe(32 + 256 + 1);
    const request = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      expectedControlSeq: 0,
      generationRequestId: 'request-1234',
      sharedConfig: config(),
      hostLocalPayloads: Array.from({ length: MAX_ARENA_ROOM_HOST_LOCAL_PAYLOADS }, (_, index) => ({
        key: `host-local:item-${index}`,
        kind: 'material' as const,
        payload: { title: `素材 ${index}` },
      })),
      generation: {},
    };
    expect(ArenaRoomGenerationStartRequestSchema.safeParse(request).success).toBe(true);
    expect(ArenaRoomGenerationStartRequestSchema.safeParse({
      ...request,
      hostLocalPayloads: [...request.hostLocalPayloads, {
        key: 'host-local:overflow',
        kind: 'material',
        payload: { title: '溢出' },
      }],
    }).success).toBe(false);

    const result = {
      version: 1,
      format: 'stream-markdown',
      mode: 'daily',
      characterGuidances: Array.from({ length: 32 }, (_, index) => ({
        combatantKey: character(index).key,
        displayName: `角色 ${index}`,
        guidance: '',
      })),
    };
    expect(ArenaRoomGenerationResultSchema.safeParse(result).success).toBe(true);
    expect(ArenaRoomGenerationResultSchema.safeParse({
      ...result,
      characterGuidances: [...result.characterGuidances, {
        combatantKey: character(32).key,
        displayName: '角色 32',
        guidance: '',
      }],
    }).success).toBe(false);
  });
});
