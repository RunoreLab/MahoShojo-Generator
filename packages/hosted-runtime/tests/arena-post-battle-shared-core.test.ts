import { describe, expect, it } from 'vitest';
import { createSignatureService } from '../src/signature';
import { createArenaPostBattleProjector } from '../src/arena-companion/post-battle';
import type { ArenaCompanionProjectInput } from '../src/arena-companion/service';
import { createArenaPostBattleProjector as createLegacyProjector } from './fixtures/legacy-arena-post-battle';

const fixedTime = '2026-08-26T00:00:00.000Z';
const generationId = 'arena_generation_projection_1';
const report = {
  headline: ' 决战 ', mode: 'scenario', officialReport: { winner: ' 角色甲 ', conclusion: '结束' },
  article: { body: '完整正文不属于角色历战摘要' },
};

const createSignatures = async () => createSignatureService({
  getSigningKey: async () => crypto.subtle.importKey(
    'raw', new TextEncoder().encode('local-test-key-not-a-real-service-secret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  ),
});

const cases = [
  'native', 'unsigned', 'conflicting-name', 'same-native-name', 'unsigned-scenario',
  'legacy-history', 'repeated-history', 'repeated-state', 'repeated-both',
  'metadata-signature', 'no-summary', 'fallback-time', 'defaults',
] as const;

describe('Arena post-battle actual Hosted/legacy full-payload parity', () => {
  for (const writeArenaHistory of [false, true]) for (const writeCurrentState of [false, true]) {
    it.each(cases)(`%s, history=${writeArenaHistory}, state=${writeCurrentState}`, async (kind) => {
      const signatures = await createSignatures();
      const first: Record<string, unknown> = {
        codename: ' 角色甲 ',
        _author: '原作者',
        metadata: { userField: '保留' },
        extension: { signature: '普通嵌套字段', _native: true, nested: ['不删除'] },
        arena_history: {
          unknownRoot: '保留历战扩展',
          attributes: { world_line_id: ' existing-world ', created_at: ' legacy-time ', custom: 42 },
          entries: [{ id: 'legacy-7', type: '旧记录', metadata: { extra: true } }],
        },
        current_state: { summary: '原状态', fields: [], base_revision_hash: '旧hash', extra: { n: 1 } },
      };
      const second: Record<string, unknown> = { name: '角色乙' };
      const scenario: Record<string, unknown> = { name: ' 场景名 ', extension: '保留场景' };
      if (kind === 'legacy-history') {
        first.arena_history = {
          unknownRoot: '不丢弃', attributes: { sublimation_count: 3, last_sublimation_at: '旧时间', custom: 9 },
          entries: [null, false, '旧非法条目', { id: '8' }, { id: 4.8, metadata: { signature: '未知记录元数据' } }],
        };
        second.arena_history = 'legacy malformed history';
        second.current_state = 'legacy state';
      }
      if (kind === 'repeated-history' || kind === 'repeated-both') {
        first.arena_history = { entries: [{ id: 1, metadata: { generation_id: ` ${generationId} ` } }], unknown: true };
      }
      if (kind === 'repeated-state' || kind === 'repeated-both') {
        first.current_state = { summary: '已应用', generation_id: generationId, extra: true };
      }
      if (kind === 'conflicting-name' || kind === 'same-native-name') second.name = '角 色 甲';
      if (kind !== 'unsigned') first.signature = await signatures.generateSignature(first);
      if (kind !== 'unsigned' && kind !== 'conflicting-name') second.signature = await signatures.generateSignature(second);
      if (kind === 'conflicting-name') second.signature = 'forged';
      if (kind === 'metadata-signature') {
        (first.metadata as Record<string, unknown>).signature = first.signature;
        delete first.signature;
        expect(await signatures.verifySignature(first)).toBe(true);
      }
      if (kind !== 'unsigned-scenario') scenario.signature = await signatures.generateSignature(scenario);
      const input: ArenaCompanionProjectInput = {
        combatants: [null, { data: 'invalid' }, { data: {} },
          { isNative: false, characterGuidance: ` ${'指引'.repeat(70)} `, data: first },
          { isNative: true, data: second }],
        report: kind === 'defaults' ? {} : report,
        impacts: kind === 'defaults' ? [] : [
          { characterName: '角色甲', impact: '先前匹配值', currentStateSummary: '先前状态' },
          { characterName: '角色甲', impact: ' 成长 ', currentStateSummary: kind === 'no-summary' ? ' ' : ' 平静 ' },
          { characterName: '角色乙', impact: '', currentStateSummary: ' 第二位状态 ' },
        ],
        scenario, userGuidance: ' 用户指引 ', writeArenaHistory, writeCurrentState,
        generationId, occurredAt: kind === 'fallback-time' ? 'invalid-time' : '2026-08-26T08:00:00+08:00',
      };
      const snapshot = JSON.stringify(input);
      const options = { signatures, now: () => new Date(fixedTime) };
      const expected = await createLegacyProjector(options)(input);
      const actual = await createArenaPostBattleProjector(options)(input);
      // Includes world-line IDs, unknown/legacy fields and real HMAC signatures, not a mocked summary.
      expect(actual).toEqual(expected);
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
      expect(JSON.stringify(input)).toBe(snapshot);
      for (const card of actual) {
        if (card.signature) expect(await signatures.verifySignature(card)).toBe(true);
      }
      const reapplied = await createArenaPostBattleProjector(options)({
        ...input, combatants: actual.map((data) => ({ data })),
      });
      expect(reapplied).toEqual([]);
    });
  }
});
