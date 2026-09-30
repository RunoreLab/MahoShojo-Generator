import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canonicalizeLocalCardPayloadV1,
  deriveLocalDataCardIdV1,
  digestLocalCardPayloadV1,
  stripLocalCardTransportMeta,
} from '../src/digest.ts';

import { localCardDigestGoldenCases } from './digest-golden-cases.ts';

interface GoldenCase {
  id: string;
  caseDescription: string;
  input: unknown;
  expectedCanonicalText: string;
  expectedDigest: string;
  expectedLocalId: string;
  sameDigestAs?: string;
}

interface GoldenFixture {
  digestAlgorithm: string;
  digestVersion: string;
  localIdPrefix: string;
  caseCount: number;
  cases: GoldenCase[];
}

const fixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'fixtures', 'local-card-digest-v1.json'), 'utf8'),
) as GoldenFixture;

const byId = new Map(fixture.cases.map((testCase) => [testCase.id, testCase]));

/**
 * V1 摘要的 golden fixture 门禁。
 *
 * 摘要决定本地卡身份：它一变，全部历史卡的 `contentDigest` 与 `lc_` 前缀 ID 随之改变，用户
 * 会看到同一张卡变成两张。因此"实现被改动"必须让这里红，而不是安静地产出一批新 ID。
 *
 * 失败信息里带上 `caseDescription`，就是为了让读失败的人立刻知道被改动的是哪一条历史语义，
 * 而不只是看到两个哈希对不上。
 */
describe('V1 摘要 golden fixture', () => {
  it('fixture 覆盖了用例清单里的每一条，且没有多余条目', () => {
    // 少一条意味着新增用例后忘了重新生成；多一条意味着 fixture 里有已从清单删除的残留。
    expect(fixture.cases.map((testCase) => testCase.id).sort()).toEqual(
      localCardDigestGoldenCases.map((testCase) => testCase.id).sort(),
    );
    expect(fixture.caseCount).toBe(fixture.cases.length);
  });

  it('每条用例都写明了它锁定哪一种历史行为', () => {
    for (const testCase of fixture.cases) {
      expect(testCase.caseDescription.length, `${testCase.id} 缺少 caseDescription`).toBeGreaterThan(20);
    }
  });

  it('fixture 自身声明的算法与前缀和实现一致', () => {
    expect(fixture.digestVersion).toBe('v1');
    expect(fixture.digestAlgorithm).toBe('sha256');
    expect(fixture.localIdPrefix).toBe('lc_');
    expect(fixture.cases[0]?.expectedDigest.startsWith('sha256:')).toBe(true);
  });

  it.each(fixture.cases.map((testCase) => [testCase.id, testCase] as const))(
    '%s 的前像、摘要与本地 ID 都未改变',
    async (_id, testCase) => {
      const stripped = stripLocalCardTransportMeta(testCase.input);

      expect(
        canonicalizeLocalCardPayloadV1(stripped),
        `${testCase.id} 的 canonical 文本被改动。${testCase.caseDescription}`,
      ).toBe(testCase.expectedCanonicalText);

      const digest = await digestLocalCardPayloadV1(testCase.input);
      expect(digest, `${testCase.id} 的摘要被改动。${testCase.caseDescription}`).toBe(testCase.expectedDigest);

      expect(deriveLocalDataCardIdV1(digest), `${testCase.id} 的本地 ID 派生被改动。`).toBe(
        testCase.expectedLocalId,
      );
    },
  );

  it.each(
    fixture.cases.filter((testCase) => testCase.sameDigestAs !== undefined).map(
      (testCase) => [testCase.id, testCase.sameDigestAs as string, testCase] as const,
    ),
  )('%s 与 %s 产出相同摘要', async (id, baselineId, testCase) => {
    const baseline = byId.get(baselineId);
    expect(baseline, `${id} 指向的对照用例 ${baselineId} 不存在`).toBeDefined();
    // 先确认两者输入确实不同，否则这条断言会因为"本来就是同一份数据"而空转。
    expect(JSON.stringify(testCase.input)).not.toBe(JSON.stringify(baseline?.input));

    const digest = await digestLocalCardPayloadV1(testCase.input);
    expect(digest, `${id} 与 ${baselineId} 应当同摘要，但不等。${testCase.caseDescription}`).toBe(
      await digestLocalCardPayloadV1(baseline?.input),
    );
  });

  it('本地 ID 只取摘要前 32 位十六进制，因此不同摘要仍可能撞 ID —— 记录该事实而不假装它被覆盖', () => {
    // 这不是缺陷而是取舍：128 bit 截断对本机规模足够，代价是理论上存在碰撞。
    // 断言写在 fixture 里是为了让"ID 只有 32 位"成为显式事实，而不是靠读源码才发现。
    for (const testCase of fixture.cases) {
      expect(testCase.expectedLocalId).toMatch(/^lc_[0-9a-f]{32}$/u);
      expect(testCase.expectedLocalId).toBe(`lc_${testCase.expectedDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`);
    }
  });
});
