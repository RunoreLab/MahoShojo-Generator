import { describe, expect, test } from 'vitest';
import {
  findForbiddenRemoteMigrations,
  findForbiddenRemoteTables,
  parseJsonPayload,
} from '../scripts/d1-release-status.mjs';

describe('D1 release status Redis-only schema gate', () => {
  test('识别被移出生产迁移链的 Arena Room migration 与 table', () => {
    expect(
      findForbiddenRemoteMigrations([
        '0013_ai_channel_availability.sql',
        '0014_arena_multiplayer_rooms.sql',
      ]),
    ).toEqual(['0014_arena_multiplayer_rooms.sql']);

    expect(findForbiddenRemoteTables(new Set(['users', 'arena_multiplayer_rooms']))).toEqual([
      'arena_multiplayer_rooms',
    ]);
  });

  test('其他远端历史迁移仍仅报告差异，不误判为 Redis-only 禁止项', () => {
    expect(findForbiddenRemoteMigrations(['0099_external_history.sql'])).toEqual([]);
    expect(findForbiddenRemoteTables(new Set(['users', 'arena_history']))).toEqual([]);
  });

  test('Wrangler JSON 前后存在 pnpm 或代理提示时仍只解析完整 payload', () => {
    expect(
      parseJsonPayload(
        '[{"results":[{"cnt":1}]}]\nundefined\n',
        '▲ [WARNING] Proxy environment variables detected.\n',
      ),
    ).toEqual([{ results: [{ cnt: 1 }] }]);

    expect(
      parseJsonPayload(
        'wrangler notice [not-json]\n{"results":[]}\n',
        '',
      ),
    ).toEqual({ results: [] });
  });
});
