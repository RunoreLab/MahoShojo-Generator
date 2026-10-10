import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GET } from '@/app/%5F%5Fweb-package__/runner/route';
import { WEB_PACKAGE_RUNNER_HEADERS, WEB_PACKAGE_RUNNER_POLICY } from '@/lib/web-package/runner';
import { buildContentSecurityPolicy } from '@/lib/security/browser-headers';
import { WEB_PACKAGE_RUNNER_POLICY as sharedRunnerPolicy } from '@mahoshojo/web-package/runner-policy';

describe('Web 包静态运行页策略',()=>{
  it('serves fixed bootstrap without accepting or embedding user bytes',async()=>{
    const response=GET();expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(sharedRunnerPolicy);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(await response.text()).toContain('event.source !== parent');
  });
  it('scopes data/blob script permission to the runner and retains normal page policy',()=>{
    expect(WEB_PACKAGE_RUNNER_POLICY).toContain("worker-src 'none'");
    expect(WEB_PACKAGE_RUNNER_POLICY).not.toContain("unsafe-eval");
    expect(WEB_PACKAGE_RUNNER_POLICY).toContain("frame-ancestors 'self'");
    const ordinary=buildContentSecurityPolicy({isProduction:true});
    expect(ordinary.split(';').find(d=>d.trim().startsWith('script-src '))).not.toMatch(/blob:|data:/u);
    expect(Object.fromEntries(WEB_PACKAGE_RUNNER_HEADERS.map(h=>[h.key,h.value]))['Permissions-Policy']).toContain('camera=()');
    const config=readFileSync(new URL('../next.config.ts',import.meta.url),'utf8');
    expect(config).toContain('source: WEB_PACKAGE_RUNNER_PATH');expect(config).toContain('headers: [...WEB_PACKAGE_RUNNER_HEADERS]');
  });
});
