import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildWebPageContentSecurityPolicy,
  RESTRICTED_FREE_HTML_POLICY,
  type WebPageContentSecurityPolicyOptions,
} from '../src/execution-policy';
import { WEB_PACKAGE_RUNNER_POLICY } from '../src/runner-policy';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/web-execution-policy-baseline.json', import.meta.url), 'utf8')) as {
  baseline: string;
  cases: { options: WebPageContentSecurityPolicyOptions; policy: string; sha256: string }[];
  packageRunner: string;
};
const directive = (policy: string, name: string): string | undefined => (
  policy.split('; ').find((part) => part === name || part.startsWith(`${name} `))
);

describe('不可信 Web 内容的共源规则', () => {
  it('Web 所有生产/开发及三个集成开关组合与抽取前金样逐字相同', () => {
    expect(baseline.baseline).toBe('6219048b11391e272d2cc4dd3db15d549560020b');
    expect(baseline.cases).toHaveLength(16);
    for (const { options, policy, sha256 } of baseline.cases) {
      expect(buildWebPageContentSecurityPolicy(options), JSON.stringify(options)).toBe(policy);
      expect(createHash('sha256').update(policy).digest('hex')).toBe(sha256);
    }
  });

  it('包 runner 固定策略与抽取前逐字相同，不能用自由 HTML profile 代替', () => {
    expect(WEB_PACKAGE_RUNNER_POLICY).toBe(baseline.packageRunner);
    expect(WEB_PACKAGE_RUNNER_POLICY).not.toBe(RESTRICTED_FREE_HTML_POLICY);
    expect(directive(WEB_PACKAGE_RUNNER_POLICY, 'script-src')).toBe("script-src 'unsafe-inline' blob: data: https:");
    expect(directive(WEB_PACKAGE_RUNNER_POLICY, 'script-src-attr')).toBe("script-src-attr 'unsafe-inline'");
    for (const name of ['worker-src', 'frame-src', 'form-action', 'manifest-src', 'object-src']) {
      expect(directive(WEB_PACKAGE_RUNNER_POLICY, name)).toBe(`${name} 'none'`);
    }
    expect(WEB_PACKAGE_RUNNER_POLICY).not.toContain('unsafe-eval');
  });

  it('自由 HTML 生产基线不带 HMR 或可选主站集成，不被包策略放宽', () => {
    expect(RESTRICTED_FREE_HTML_POLICY).toBe(buildWebPageContentSecurityPolicy({ isProduction: true }));
    expect(directive(RESTRICTED_FREE_HTML_POLICY, 'script-src')).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(RESTRICTED_FREE_HTML_POLICY, 'script-src-attr')).toBe("script-src-attr 'none'");
    expect(directive(RESTRICTED_FREE_HTML_POLICY, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(RESTRICTED_FREE_HTML_POLICY, 'font-src')).toBe("font-src 'self' data:");
    expect(directive(RESTRICTED_FREE_HTML_POLICY, 'connect-src')).toBe("connect-src 'self' https: wss:");
    expect(directive(RESTRICTED_FREE_HTML_POLICY, 'upgrade-insecure-requests')).toBe('upgrade-insecure-requests');
    expect(RESTRICTED_FREE_HTML_POLICY).not.toMatch(/unsafe-eval|https:\/\/|\bhttp:|\bws:/u);
  });
});
