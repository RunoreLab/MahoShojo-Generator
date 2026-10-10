import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_WEB_EXECUTION_POLICIES,
  DESKTOP_WEB_RESOURCE_ORIGINS,
} from '../src/desktop-execution-policy';
import { RESTRICTED_FREE_HTML_POLICY } from '../src/execution-policy';
import { WEB_PACKAGE_RUNNER_POLICY } from '../src/runner-policy';

const directives = (policy: string): Map<string, string> => new Map(policy.split('; ').map((part) => {
  const split = part.indexOf(' ');
  return split < 0 ? [part, ''] : [part.slice(0, split), part.slice(split + 1)];
}));
const bases = {
  'free-html': RESTRICTED_FREE_HTML_POLICY,
  'web-package': WEB_PACKAGE_RUNNER_POLICY,
} as const;
const adaptedResources = ['script-src', 'style-src', 'img-src', 'font-src', 'media-src', 'connect-src'];
const explicitAdapters = [...adaptedResources, 'base-uri', 'frame-ancestors', 'upgrade-insecure-requests'];

describe('Desktop 固定资源 transport 与按内容类型的政策适配', () => {
  it('只接受两个固定策略和 resolver 契约中的规范无端口来源', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../contracts/fixtures/desktop-web-package-instance.json', import.meta.url), 'utf8'));
    expect(Object.keys(DESKTOP_WEB_EXECUTION_POLICIES)).toEqual(['free-html', 'web-package']);
    expect(DESKTOP_WEB_RESOURCE_ORIGINS).toEqual([
      `${fixture.uriScheme}://${fixture.resourceHost}`,
      `http://${fixture.windowsResourceHost}`,
    ]);
    expect(Object.isFrozen(DESKTOP_WEB_EXECUTION_POLICIES)).toBe(true);
    expect(Object.isFrozen(DESKTOP_WEB_RESOURCE_ORIGINS)).toBe(true);
  });

  it('只对六种实际资源 directive 添加受控来源，其余旧语义逐项保留', () => {
    for (const kind of ['free-html', 'web-package'] as const) {
      const base = directives(bases[kind]);
      const adapted = directives(DESKTOP_WEB_EXECUTION_POLICIES[kind]);
      for (const name of adaptedResources) {
        expect(adapted.get(name), `${kind}/${name}`).toBe(`${base.get(name)} ${DESKTOP_WEB_RESOURCE_ORIGINS.join(' ')}`);
      }
      for (const [name, value] of base) {
        if (!explicitAdapters.includes(name)) expect(adapted.get(name), `${kind}/${name}`).toBe(value);
      }
      expect([...adapted.keys()].sort()).toEqual([...new Set([...base.keys(), 'upgrade-insecure-requests'])].sort());
      expect(adapted.get('frame-ancestors')).toBe("'none'");
      expect(adapted.has('upgrade-insecure-requests')).toBe(true);
      for (const value of adapted.values()) {
        expect(value.split(' ')).not.toContain('http:');
        expect(value.split(' ')).not.toContain('ws:');
        expect(value.split(' ')).not.toContain("'unsafe-eval'");
      }
    }
  });

  it('包的五个 none 禁止面保持独占，不因本地来源追加而失效', () => {
    const policy = directives(DESKTOP_WEB_EXECUTION_POLICIES['web-package']);
    for (const name of ['worker-src', 'frame-src', 'form-action', 'manifest-src', 'object-src']) {
      expect(policy.get(name), name).toBe("'none'");
    }
  });

  it('自由 HTML 不继承包的任意 HTTPS 脚本/样式/字体或内联事件许可', () => {
    const policy = directives(DESKTOP_WEB_EXECUTION_POLICIES['free-html']);
    for (const name of ['script-src', 'style-src', 'font-src']) {
      expect(policy.get(name)?.split(' '), name).not.toContain('https:');
    }
    expect(policy.get('script-src-attr')).toBe("'none'");
    expect(policy.get('frame-src')).toBe("'self'");
    expect(policy.get('worker-src')).toBe("'self' blob:");
    expect(policy.get('form-action')).toBe("'self'");
  });

  it('显式 base 仅适配固定本地 transport，普通相对资源不依赖 base 标签', () => {
    expect(directives(DESKTOP_WEB_EXECUTION_POLICIES['web-package']).get('base-uri')).toBe(DESKTOP_WEB_RESOURCE_ORIGINS.join(' '));
    expect(directives(DESKTOP_WEB_EXECUTION_POLICIES['free-html']).get('base-uri')).toBe(`'self' ${DESKTOP_WEB_RESOURCE_ORIGINS.join(' ')}`);
  });

  it('受检 Native JSON 来自同一 owner，没有手写第二份政策', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../apps/desktop/src-tauri/src/generated/web-execution-policies.json', import.meta.url), 'utf8'));
    expect(manifest).toEqual({ version: 1, resourceOrigins: DESKTOP_WEB_RESOURCE_ORIGINS, policies: DESKTOP_WEB_EXECUTION_POLICIES });
  });
});
