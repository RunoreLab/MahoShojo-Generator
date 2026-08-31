import type { DataCardRef } from '@mahoshojo/contracts/arena-room';
import { describe, expect, it } from 'vitest';

import {
  ArenaRoomGenerationContentResolverError,
  createArenaRoomGenerationOnlineContentResolver,
  type ArenaRoomGenerationContentD1Client,
  type ArenaRoomGenerationContentD1Statement,
} from '#/arena-room/room-generation-content-resolver';

type StatementCall = Readonly<{
  sql: string;
  params: readonly unknown[];
  options: unknown;
}>;

const ref = (overrides: Partial<DataCardRef> = {}): DataCardRef => ({
  id: 'card-1',
  kind: 'character',
  versionToken: '2026-08-31T08:00:00.000Z',
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'card-1',
  user_id: 7,
  type: 'character',
  name: '线上角色',
  data: JSON.stringify({ name: '线上角色', content: '正文' }),
  is_public: 1,
  review_status: 'approved',
  updated_at: '2026-08-31T08:00:00.000Z',
  deleted_at: null,
  ...overrides,
});

const createClient = (
  responder: (call: StatementCall) => readonly Record<string, unknown>[] = () => [row()],
) => {
  const calls: StatementCall[] = [];
  const client: ArenaRoomGenerationContentD1Client = {
    prepare(sql) {
      let params: unknown[] = [];
      const statement: ArenaRoomGenerationContentD1Statement = {
        bind(...values) {
          params = values;
          return statement;
        },
        async all(options) {
          const call = { sql, params, options };
          calls.push(call);
          return { success: true, results: responder(call) };
        },
      };
      return statement;
    },
  };
  return { client, calls };
};

describe('Arena Room generation online canonical content resolver', () => {
  it('以 exact id 同次读取 metadata + canonical data，仅返回 safe parsed payload', async () => {
    const { client, calls } = createClient();
    const resolver = createArenaRoomGenerationOnlineContentResolver({
      getClient: () => client,
    });
    await expect(resolver.resolve({ ref: ref(), hostAccountUserId: 99 })).resolves.toEqual({
      ref: ref(),
      displayName: '线上角色',
      sourceType: 'character',
      payload: { name: '线上角色', content: '正文' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      params: ['card-1'],
      options: { retry: 'safe-read' },
    });
    expect(calls[0]!.sql).toMatch(/SELECT[\s\S]+name,[\s\S]+data,[\s\S]+FROM data_cards[\s\S]+WHERE id = \?/u);
  });

  it.each([
    ['stale version', { updated_at: '2026-08-31T08:00:01.000Z' }, 'ARENA_ROOM_REFERENCE_VERSION_MISMATCH'],
    ['deleted', { deleted_at: '2026-08-31T08:01:00.000Z' }, 'ARENA_ROOM_REFERENCE_NOT_READABLE'],
    ['pending', { review_status: 'pending' }, 'ARENA_ROOM_REFERENCE_NOT_READABLE'],
    ['banned', { is_public: -1 }, 'ARENA_ROOM_REFERENCE_NOT_READABLE'],
    ['private other user', { is_public: 0, user_id: 9 }, 'ARENA_ROOM_REFERENCE_NOT_READABLE'],
    ['kind mismatch', { type: 'scenario' }, 'ARENA_ROOM_REFERENCE_NOT_READABLE'],
    ['invalid JSON', { data: '{' }, 'ARENA_ROOM_REFERENCE_CONTENT_INVALID'],
    ['primitive JSON', { data: '"not-object"' }, 'ARENA_ROOM_REFERENCE_CONTENT_INVALID'],
    ['unsafe JSON key', { data: '{"constructor":{"secret":true}}' }, 'ARENA_ROOM_REFERENCE_CONTENT_INVALID'],
  ])('%s fail closed', async (_name, overrides, code) => {
    const { client } = createClient(() => [row(overrides)]);
    const resolver = createArenaRoomGenerationOnlineContentResolver({ getClient: () => client });
    await expect(resolver.resolve({ ref: ref(), hostAccountUserId: 7 })).rejects.toMatchObject({ code });
  });

  it('host 可读自有 approved private exact card，material 可引用支持的任意卡类型', async () => {
    const { client } = createClient((call) => [row({
      id: call.params[0],
      user_id: 7,
      is_public: 0,
      type: 'questionnaire',
    })]);
    const resolver = createArenaRoomGenerationOnlineContentResolver({ getClient: () => client });
    await expect(resolver.resolve({
      ref: ref({ kind: 'material' }),
      hostAccountUserId: 7,
    })).resolves.toMatchObject({ ref: { kind: 'material' } });
  });

  it('D1 unavailable/failure/malformed row 只返回稳定 code，不暴露 SQL/data/credential', async () => {
    const unavailable = createArenaRoomGenerationOnlineContentResolver({ getClient: () => null });
    await expect(unavailable.resolve({ ref: ref(), hostAccountUserId: 7 })).rejects.toMatchObject({
      code: 'ARENA_ROOM_REFERENCE_D1_UNAVAILABLE',
    });

    const broken: ArenaRoomGenerationContentD1Client = {
      prepare() { throw new Error('providerApiKey=secret'); },
    };
    const resolver = createArenaRoomGenerationOnlineContentResolver({ getClient: () => broken });
    const error = await resolver.resolve({ ref: ref(), hostAccountUserId: 7 })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ArenaRoomGenerationContentResolverError);
    expect(String(error)).not.toMatch(/providerApiKey|secret|SELECT|data_cards/u);
  });

  it.each([
    ['null', null],
    ['array', []],
    ['primitive', 'not-a-row'],
  ])('D1 %s row fail closed 为 metadata invalid', async (_name, malformedRow) => {
    const { client } = createClient(() => [
      malformedRow as unknown as Record<string, unknown>,
    ]);
    const resolver = createArenaRoomGenerationOnlineContentResolver({ getClient: () => client });
    await expect(resolver.resolve({
      ref: ref(),
      hostAccountUserId: 7,
    })).rejects.toMatchObject({ code: 'ARENA_ROOM_REFERENCE_METADATA_INVALID' });
  });
});
