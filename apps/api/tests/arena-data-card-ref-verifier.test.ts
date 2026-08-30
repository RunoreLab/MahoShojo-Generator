import type { DataCardRef } from '@mahoshojo/contracts/arena-room';
import { ONLINE_DATA_CARD_TYPES } from '@mahoshojo/contracts/data-cards';
import type { D1LikeStatementResult } from '@mahoshojo/hosted-runtime/d1-http-client';
import { describe, expect, it } from 'vitest';

import {
  ArenaDataCardRefVerifierError,
  createArenaDataCardRefVerifier,
  type ArenaDataCardRefVerifierD1Client,
  type ArenaDataCardRefVerifierD1Statement,
} from '#/arena-room/arena-data-card-ref-verifier';

type StatementCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly options: unknown;
};

const success = (results: Record<string, unknown>[] = []): D1LikeStatementResult => ({
  success: true,
  results,
  meta: {},
});

const card = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'card-1',
  user_id: 7,
  type: 'character',
  is_public: 1,
  review_status: 'approved',
  updated_at: '2026-08-28T08:00:00.000Z',
  deleted_at: null,
  ...overrides,
});

const ref = (overrides: Partial<DataCardRef> = {}): DataCardRef => ({
  id: 'card-1',
  kind: 'character',
  versionToken: '2026-08-28T08:00:00.000Z',
  ...overrides,
});

const createClient = (
  responder: (call: StatementCall) => D1LikeStatementResult = () => success([card()]),
): { client: ArenaDataCardRefVerifierD1Client; calls: StatementCall[] } => {
  const calls: StatementCall[] = [];
  const client: ArenaDataCardRefVerifierD1Client = {
    prepare(sql) {
      let params: unknown[] = [];
      const statement: ArenaDataCardRefVerifierD1Statement = {
        bind(...input) {
          params = input;
          return statement;
        },
        async all(options) {
          const call = { sql, params, options };
          calls.push(call);
          return responder(call);
        },
      };
      return statement;
    },
  };
  return { client, calls };
};

const createVerifier = (
  client: ArenaDataCardRefVerifierD1Client | null,
) => createArenaDataCardRefVerifier({ getClient: () => client });

describe('Arena DataCardRef verifier', () => {
  it('只查询 metadata，public approved exact token 返回原始 canonical refs', async () => {
    const { client, calls } = createClient();
    const verifier = createVerifier(client);

    await expect(verifier.verify({ refs: [ref()], hostAccountUserId: 99 })).resolves.toEqual([ref()]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      params: ['card-1'],
      options: { retry: 'safe-read' },
    });
    expect(calls[0]?.sql).toMatch(/SELECT\s+id,\s*user_id,\s*type,\s*is_public,\s*review_status,\s*updated_at,\s*deleted_at/u);
    expect(calls[0]?.sql).toMatch(/FROM\s+data_cards\s+WHERE\s+id\s*=\s*\?/u);
    expect(calls[0]?.sql).not.toMatch(/\bdata\b/u);
  });

  it('允许 host 自有 approved 私卡，但不因 member 身份而读取其私卡', async () => {
    const { client } = createClient(() => success([card({ user_id: 7, is_public: 0 })]));
    const verifier = createVerifier(client);

    await expect(verifier.verify({ refs: [ref()], hostAccountUserId: 7 })).resolves.toEqual([ref()]);
    await expect(verifier.verify({ refs: [ref()], hostAccountUserId: 99 })).rejects.toMatchObject({
      code: 'ARENA_DATA_CARD_REF_NOT_READABLE',
    });
  });

  it.each([
    ['deleted', { deleted_at: '2026-08-28T09:00:00.000Z' }],
    ['pending', { review_status: 'pending' }],
    ['rejected', { review_status: 'rejected' }],
    ['banned', { is_public: -1 }],
    ['private member card', { is_public: 0, user_id: 99 }],
  ])('%s ref fail closed without exposing metadata details', async (_name, overrides) => {
    const { client } = createClient(() => success([card(overrides)]));
    const verifier = createVerifier(client);

    const error = await verifier.verify({ refs: [ref()], hostAccountUserId: 7 }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ArenaDataCardRefVerifierError);
    expect(error).toMatchObject({ code: 'ARENA_DATA_CARD_REF_NOT_READABLE' });
    expect(JSON.stringify(error)).not.toMatch(/secret|data|card-1|99/u);
  });

  it.each([
    ['character ref to scenario card', { type: 'scenario' }, ref()],
    ['scenario ref to character card', { type: 'character' }, ref({ kind: 'scenario' })],
    ['material ref to unsupported type', { type: 'material' }, ref({ kind: 'material' })],
  ])('%s is rejected', async (_name, overrides, inputRef) => {
    const { client } = createClient(() => success([card(overrides)]));
    const verifier = createVerifier(client);

    await expect(verifier.verify({ refs: [inputRef], hostAccountUserId: 7 })).rejects.toBeInstanceOf(
      ArenaDataCardRefVerifierError,
    );
  });

  it.each(ONLINE_DATA_CARD_TYPES)(
    'material 可引用 ONLINE_DATA_CARD_TYPES 的 %s 卡',
    async (type) => {
    const { client } = createClient(() => success([card({ type })]));
    const verifier = createVerifier(client);

    await expect(verifier.verify({ refs: [ref({ kind: 'material' })], hostAccountUserId: 7 }))
      .resolves.toEqual([ref({ kind: 'material' })]);
    },
  );

  it('versionToken 必须精确匹配 updated_at，不得 fallback 到 latest', async () => {
    const { client } = createClient(() => success([card({ updated_at: '2026-08-28T08:00:01.000Z' })]));
    const verifier = createVerifier(client);

    await expect(verifier.verify({ refs: [ref()], hostAccountUserId: 7 })).rejects.toMatchObject({
      code: 'ARENA_DATA_CARD_REF_VERSION_MISMATCH',
    });
  });

  it('missing, invalid input and malformed metadata all fail closed before returning a ref', async () => {
    const malformedRows = [
      [],
      [card({ user_id: 0 })],
      [card({ id: null })],
      [card({ updated_at: null })],
      [card({ deleted_at: '' })],
      [card({ is_public: 2 })],
      [card({ review_status: null })],
    ];

    for (const results of malformedRows) {
      const { client } = createClient(() => success(results));
      const verifier = createVerifier(client);
      await expect(verifier.verify({ refs: [ref()], hostAccountUserId: 7 })).rejects.toBeInstanceOf(
        ArenaDataCardRefVerifierError,
      );
    }

    const { client, calls } = createClient();
    const verifier = createVerifier(client);
    await expect(verifier.verify({
      refs: [{ ...ref(), id: '  card-1  ' }],
      hostAccountUserId: 7,
    })).rejects.toMatchObject({ code: 'ARENA_DATA_CARD_REF_INPUT_INVALID' });
    expect(calls).toHaveLength(0);
  });

  it('D1 missing, failed envelope and thrown transport error are unavailable/failure, never success', async () => {
    await expect(createVerifier(null).verify({ refs: [ref()], hostAccountUserId: 7 }))
      .rejects.toMatchObject({ code: 'ARENA_DATA_CARD_REF_D1_UNAVAILABLE' });

    const failed = createClient(() => ({ success: false, results: [], meta: {}, error: 'internal' }));
    await expect(createVerifier(failed.client).verify({ refs: [ref()], hostAccountUserId: 7 }))
      .rejects.toMatchObject({ code: 'ARENA_DATA_CARD_REF_D1_FAILED' });

    const broken: ArenaDataCardRefVerifierD1Client = {
      prepare() {
        throw new Error('transport secret');
      },
    };
    const error = await createVerifier(broken).verify({ refs: [ref()], hostAccountUserId: 7 })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'ARENA_DATA_CARD_REF_D1_FAILED' });
    expect(String(error)).not.toMatch(/transport secret/u);
  });

  it('empty refs is a bounded no-op and invalid host identity is rejected without touching D1', async () => {
    const { client, calls } = createClient();
    const verifier = createVerifier(client);

    await expect(verifier.verify({ refs: [], hostAccountUserId: 7 })).resolves.toEqual([]);
    await expect(verifier.verify({ refs: [ref()], hostAccountUserId: 0 })).rejects.toMatchObject({
      code: 'ARENA_DATA_CARD_REF_INPUT_INVALID',
    });
    expect(calls).toHaveLength(0);
  });

  it('does not return or serialize D1 data正文 even when an overcomplete result is supplied', async () => {
    const { client } = createClient(() => success([card({ data: '{"providerApiKey":"secret"}' })]));
    const verifier = createVerifier(client);

    const result = await verifier.verify({ refs: [ref()], hostAccountUserId: 7 });
    expect(result).toEqual([ref()]);
    expect(JSON.stringify(result)).not.toMatch(/providerApiKey|secret|data/u);
  });

  it('handles multiple refs independently while preserving input order', async () => {
    const rows = new Map([
      ['card-1', card({ id: 'card-1', type: 'character', updated_at: 'v1' })],
      ['card-2', card({ id: 'card-2', type: 'scenario', updated_at: 'v2' })],
    ]);
    const { client, calls } = createClient((call) => success([
      rows.get(String(call.params[0])) ?? card({ id: 'unknown' }),
    ]));
    const verifier = createVerifier(client);
    const inputs = [
      ref({ id: 'card-2', kind: 'scenario', versionToken: 'v2' }),
      ref({ id: 'card-1', versionToken: 'v1' }),
    ];

    await expect(verifier.verify({ refs: inputs, hostAccountUserId: 7 })).resolves.toEqual(inputs);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.params)).toEqual([['card-2'], ['card-1']]);
  });
});
