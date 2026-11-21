import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertHealthyCloudflareResponse } from './cloudflare-runtime-response.mjs';

const require = createRequire(import.meta.url);
const wranglerPackage = require.resolve('wrangler/package.json');
const wranglerCli = path.resolve(path.dirname(wranglerPackage), require(wranglerPackage).bin.wrangler);
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(await readFile(path.join(webRoot, 'wrangler.jsonc'), 'utf8'));
const production = config.env.production;
const passkeyOrigin = production.vars?.PASSKEY_ORIGIN;
const temporary = await mkdtemp(path.join(tmpdir(), 'mahoshojo-worker-smoke-'));
const isolatedEnv = {
  PATH: process.env.PATH,
  HOME: temporary,
  XDG_CONFIG_HOME: temporary,
  XDG_CACHE_HOME: temporary,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: path.join(temporary, 'wrangler.log'),
};
// This script has its own process. Keep credentials out of Miniflare and workerd,
// not just out of the explicit Worker bindings and Wrangler child process.
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, isolatedEnv);
let worker;
try {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  // Bundle the actual artifact with its production compatibility settings, but never
  // load project .env files, credentials, remote bindings, or production storage.
  const isolatedConfig = {
    name: 'mahoshojo-runtime-smoke',
    main: path.join(webRoot, config.main),
    compatibility_date: production.compatibility_date ?? config.compatibility_date,
    compatibility_flags: production.compatibility_flags ?? config.compatibility_flags,
  };
  const configPath = path.join(temporary, 'wrangler.json');
  const bundlePath = path.join(temporary, 'bundle');
  await writeFile(configPath, JSON.stringify(isolatedConfig));
  execFileSync(process.execPath, [
    wranglerCli, 'deploy', '--dry-run',
    '--config', configPath, '--outdir', bundlePath,
  ], {
    cwd: temporary,
    stdio: 'inherit',
    timeout: 120_000,
    env: isolatedEnv,
  });
  const wasmModules = (await readdir(bundlePath, { recursive: true }))
    .filter((file) => file.endsWith('.wasm'))
    .map((file) => ({ type: 'CompiledWasm', path: path.join(bundlePath, file) }));
  const outboundRequests = [];
  worker = new Miniflare({
    ...convertV4MiniflareOptions({
      name: isolatedConfig.name,
      host: '127.0.0.1',
      cf: false,
      modules: [{ type: 'ESModule', path: path.join(bundlePath, 'worker.js') }, ...wasmModules],
      modulesRoot: bundlePath,
      compatibilityDate: isolatedConfig.compatibility_date,
      compatibilityFlags: isolatedConfig.compatibility_flags,
      bindings: {
        NEXTJS_ENV: 'production',
        ...(passkeyOrigin ? {
          PASSKEY_ORIGIN: passkeyOrigin,
          NEXT_PUBLIC_HOSTED_API_ENVIRONMENT: production.vars.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT,
          BETTER_AUTH_URL: passkeyOrigin,
          BETTER_AUTH_SECRET: 'synthetic-worker-smoke-passkey-secret',
        } : {}),
      },
      d1Databases: ['DB'],
      serviceBindings: { WORKER_SELF_REFERENCE: isolatedConfig.name },
      assets: {
        directory: path.join(webRoot, config.assets.directory),
        binding: config.assets.binding,
        routerConfig: { has_user_worker: true },
        run_worker_first: production.assets?.run_worker_first ?? config.assets.run_worker_first,
      },
      outboundService(request) {
        outboundRequests.push(new URL(request.url).origin);
        throw new Error('Cloudflare smoke test forbids external requests');
      },
    }),
    telemetry: { enabled: false },
  });
  // Cold module initialization and subsequent warm requests must all work.
  for (const route of ['/arena', '/', '/arena']) {
    const response = await worker.dispatchFetch(`https://smoke.invalid${route}`, {
      signal: AbortSignal.timeout(30_000),
      redirect: 'manual',
    });
    const html = await response.text();
    assertHealthyCloudflareResponse(route, response, html);
    console.log(`Cloudflare runtime ${route}: PASS`);
  }
  if (passkeyOrigin) {
    const statusUrl = new URL('/api/auth/passkey/status', passkeyOrigin);
    // dispatchFetch 使用本机 Host。为 OpenNext 模拟代理传给应用的公开地址。
    const response = await worker.dispatchFetch(statusUrl, {
      headers: {
        'x-forwarded-host': statusUrl.host,
        'x-forwarded-proto': statusUrl.protocol.slice(0, -1),
      },
      signal: AbortSignal.timeout(30_000),
      redirect: 'manual',
    });
    const body = await response.text();
    assert.equal(response.status, 200, `Production-origin passkey status: ${body.slice(0, 240)}`);
    assert.deepEqual(JSON.parse(body), { enabled: true });
    assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/u);
    console.log('Cloudflare runtime /api/auth/passkey/status: PASS');
  }
  assert.deepEqual(outboundRequests, [], 'Smoke routes must not access external services');
} finally {
  try {
    await worker?.dispose();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
