/**
 * 由当前实现生成 V1 摘要 golden fixture。**开发期工具，不由测试或 CI 调用。**
 *
 * 运行：`pnpm --filter @mahoshojo/local-library run fixture:regenerate`
 *
 * ## 为什么期望值由实现生成
 *
 * SHA-256 无法手算，因此期望值只能由代码产出。这带来一个必须讲清的后果：fixture 只能探测
 * **未同步的**改动（有人改了实现但没重新生成），**探测不到**同步改动（实现改了、fixture 也
 * 一起重新生成）。后者靠 `caseDescription` 与 code review 拦住——这也是每条用例都必须写清
 * 它锁定哪条历史语义的原因。
 *
 * 重新生成后**必须**逐条 review fixture 的 diff：若某条用例的 `expectedCanonicalText` 变了，
 * 就意味着 V1 语义被改动，而那需要走 DESK-061 的显式新版本，不属于本脚本的许可范围。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_CARD_DIGEST_ALGORITHM_V1,
  canonicalizeLocalCardPayloadV1,
  deriveLocalDataCardIdV1,
  digestLocalCardPayloadV1,
  stripLocalCardTransportMeta,
} from '../src/digest.ts';

import { localCardDigestGoldenCases } from './digest-golden-cases.ts';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(packageRoot, 'fixtures', 'local-card-digest-v1.json');

interface GoldenCase {
  id: string;
  caseDescription: string;
  input: unknown;
  expectedCanonicalText: string;
  expectedDigest: string;
  expectedLocalId: string;
  /** 期望与另一条用例同摘要；用于把"这些字段不参与摘要"表达成可执行断言。 */
  sameDigestAs?: string;
}

const main = async (): Promise<void> => {
  const knownIds = new Set(localCardDigestGoldenCases.map((testCase) => testCase.id));
  for (const testCase of localCardDigestGoldenCases) {
    if (testCase.sameDigestAs !== undefined && !knownIds.has(testCase.sameDigestAs)) {
      throw new Error(`用例 ${testCase.id} 的 sameDigestAs 指向不存在的用例 ${testCase.sameDigestAs}`);
    }
  }

  const cases: GoldenCase[] = [];
  for (const testCase of localCardDigestGoldenCases) {
    const stripped = stripLocalCardTransportMeta(testCase.input);
    const expectedCanonicalText = canonicalizeLocalCardPayloadV1(stripped);
    const expectedDigest = await digestLocalCardPayloadV1(testCase.input);
    cases.push({
      id: testCase.id,
      caseDescription: testCase.caseDescription,
      input: testCase.input,
      expectedCanonicalText,
      expectedDigest,
      expectedLocalId: deriveLocalDataCardIdV1(expectedDigest),
      ...(testCase.sameDigestAs !== undefined ? { sameDigestAs: testCase.sameDigestAs } : {}),
    });
  }

  const fixture = {
    $comment:
      '本文件由 packages/local-library/tests/regenerate-digest-fixture.ts 从当前实现生成，' +
      '**不要手工编辑**。它冻结的是 V1 的逐字节输出：改动这里的任何 expected 值都意味着' +
      'V1 语义被改动，而那必须走 DESK-061 的显式新版本。重新生成后请逐条 review diff。',
    digestAlgorithm: LOCAL_CARD_DIGEST_ALGORITHM_V1,
    digestVersion: 'v1',
    localIdPrefix: 'lc_',
    runtime: 'ECMAScript',
    notes: [
      'canonicalize 使用 JS 字符串比较（UTF-16 code unit 序），不是码点序，也不是 localeCompare。',
      '数字走 JSON.stringify 的最短往返表示，因此 1e-6 输出 0.000001、-0 输出 0。',
      '孤立代理项被 V1 接受，且转义发生在编码之前：canonical 文本是 ASCII 转义串，摘要取该串的 UTF-8 字节，不涉及 U+FFFD 替换。',
      '以上三条都与 Rust 的默认行为不同。V1 只在 JavaScript 运行时计算本摘要。',
    ],
    caseCount: cases.length,
    cases,
  };

  mkdirSync(path.dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(`wrote ${cases.length} cases to ${path.relative(process.cwd(), fixturePath)}`);
};

await main();
