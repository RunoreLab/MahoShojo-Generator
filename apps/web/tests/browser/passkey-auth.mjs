/** Full Web UI and native loopback acceptance using a disposable local D1 database. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';

const PASSKEY_TEST_PORT = 13480;
const ORIGIN = `http://localhost:${PASSKEY_TEST_PORT}`;
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const WEB_ROOT = path.join(ROOT, 'apps/web');
const USERNAME = 'passkey-fixture';
const PASSWORD = 'Synthetic-Browser$522';
const requestHeaders = { Origin: ORIGIN };

const passkeyTestBindings = {
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: 'local-browser-passkey-test-secret-000',
  PASSKEY_ORIGIN: ORIGIN,
  NEXT_PUBLIC_HOSTED_API_ENVIRONMENT: 'local',
};

function readAcceptanceEnvironment(source) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|CARGO_HOME|RUSTUP_HOME)$/iu;
  return Object.fromEntries(Object.entries(source).filter(([name]) => allowed.test(name)));
}

async function seedSchema(d1) {
  const sqlite = new Database(':memory:');
  try {
    for (const file of [
      'apps/web/lib/database/schema.sql',
      'drizzle/0000_auth_domain_bootstrap.sql',
      'drizzle/0002_auth_password_reset_tokens.sql',
      'drizzle/0003_auth_audit_logs.sql',
      'drizzle/0006_messages.sql',
      'drizzle/0022_auth_passkeys.sql',
    ]) {
      sqlite.exec(await readFile(path.join(ROOT, file), 'utf8'));
    }
    const sql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
    await d1.batch(sql.map(({ sql: statement }) => d1.prepare(statement)));
  } finally {
    sqlite.close();
  }
}

function startDesktop(temp, env) {
  const child = spawn('cargo', [
    'test', '--manifest-path', path.join(ROOT, 'apps/desktop/src-tauri/Cargo.toml'),
    '--offline', '--locked', '--lib', '-j', '2', 'passkey_browser_desktop_return', '--', '--ignored',
  ], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, MAHOSHOJO_PASSKEY_TEST_ORIGIN: ORIGIN, MAHOSHOJO_PASSKEY_TEST_DIR: temp },
  });
  let output = '';
  let finished;
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
  const result = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: -1, error }));
    child.once('close', (code) => resolve({ code }));
  }).then((value) => { finished = value; return value; });
  return {
    stop: () => { if (!finished) child.kill(); },
    async url() {
      const handoff = path.join(temp, 'desktop-authorize-url');
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline && !finished) {
        const value = await readFile(handoff, 'utf8').catch(error => {
          if (error.code !== 'ENOENT') throw error;
          return '';
        });
        if (value.endsWith('\n')) return new URL(value.trim());
        await delay(250);
      }
      throw new Error(`Rust did not start the local listener. ${finished?.error ?? output}`);
    },
    async expectSuccess() {
      const value = await result;
      assert.equal(value.code, 0, output);
      assert.match(output, /1 passed/);
    },
  };
}

const screen = {
  signIn: /登录.*注册/u,
  authenticate: '使用通行密钥登录',
  settings: '/settings?section=account',
};

async function runPasskeyBrowserAcceptance(temporary, env) {
  const browser = await chromium.launch({
    headless: true,
    env,
    ...(!existsSync(chromium.executablePath()) && process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  let desktop;
  try {
    const context = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 1180, height: 850 } });
    let callbackOrigin;
    await context.route('**/*', (route) => {
      const origin = new URL(route.request().url()).origin;
      return origin === ORIGIN || origin === callbackOrigin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const savedKeys = new Map();
    let active;
    async function selectAuthenticator(label) {
      if (active) {
        const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId: active.id });
        savedKeys.set(active.label, credentials);
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: active.id });
      }
      const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
      } });
      for (const credential of savedKeys.get(label) ?? []) {
        await cdp.send('WebAuthn.addCredential', { authenticatorId, credential });
      }
      active = { label, id: authenticatorId };
    }

    async function checkedPost(endpoint, body = {}) {
      const response = await page.request.post(endpoint, { data: body, headers: requestHeaders });
      assert.ok(response.ok(), `${endpoint} returned ${response.status()}`);
      return response;
    }
    const verifySession = async () => {
      const result = await (await checkedPost('/api/auth/verify')).json();
      assert.equal(result.authSource, 'better-auth-session');
      assert.equal(result.user.username, USERNAME);
      return result.user.id;
    };
    await checkedPost('/api/auth/sign-up/email', {
      name: USERNAME, email: 'passkey-browser@example.test', password: PASSWORD,
    });
    const accountId = await verifySession();
    await page.goto(screen.settings);
    const panel = page.getByRole('region', { name: '通行密钥' });
    await panel.getByText('尚未添加通行密钥。').waitFor();

    async function addKey(label, title, first) {
      await selectAuthenticator(label);
      await panel.getByRole('button', { name: '添加通行密钥' }).click();
      await panel.getByLabel('通行密钥名称（可选）').fill(title);
      if (first) {
        assert.equal(await panel.getByLabel('已绑定的通行密钥').count(), 0);
      } else {
        await panel.getByRole('radio', { name: '密码', exact: true }).check();
      }
      await panel.getByLabel('当前密码').fill(PASSWORD);
      await panel.getByRole('button', { name: '确认添加' }).click();
      await panel.getByText(title, { exact: true }).waitFor().catch(async (error) => {
        const notice = await panel.getByRole('alert').first().textContent({ timeout: 500 }).catch(() => null);
        throw new Error(notice || 'Registration did not reach the credential list', { cause: error });
      });
    }
    await addKey('one', '桌面验证器', true);
    await addKey('two', '第二把测试密钥', false);
    await panel.getByRole('button', { name: '改名 桌面验证器' }).click();
    await panel.getByLabel('新名称').fill('改名后的测试密钥');
    await panel.getByRole('button', { name: '保存名称' }).click();
    await panel.getByText('改名后的测试密钥', { exact: true }).waitFor();
    console.log('Passkeys Web management: two credentials added, listed and renamed');

    async function resetBrowserIdentity() {
      await checkedPost('/api/auth/sign-out');
      await context.clearCookies();
      await page.evaluate(() => localStorage.clear());
    }
    async function login(label, url = '/', expectedStatus = 200) {
      await resetBrowserIdentity();
      await selectAuthenticator(label);
      await page.goto(url);
      const loginArea = new URL(url, ORIGIN).pathname === '/auth/desktop'
        ? page.getByRole('heading', { name: '桌面端授权', exact: true }).locator('..')
        : page;
      await loginArea.getByRole('button', { name: screen.signIn }).first().click();
      const result = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/auth/passkey/login' && response.request().method() === 'POST');
      await page.getByRole('button', { name: screen.authenticate, exact: true }).click();
      assert.equal((await result).status(), expectedStatus);
    }
    await login('one');
    assert.equal(await verifySession(), accountId);
    await login('two');
    assert.equal(await verifySession(), accountId);
    const listed = await page.request.get('/api/auth/passkey/list');
    assert.ok(listed.ok());
    assert.ok((await listed.json()).passkeys.every((key) => Number.isSafeInteger(key.lastUsedAt)));
    console.log('Passkeys Web login: both authenticators reached the same account');

    await page.goto(screen.settings);
    await panel.getByRole('button', { name: '删除 改名后的测试密钥' }).click();
    await panel.getByRole('radio', { name: '已绑定的通行密钥' }).check();
    await panel.getByRole('button', { name: '确认删除' }).click();
    await panel.getByText('已删除通行密钥。').waitFor();
    assert.equal(await verifySession(), accountId);
    await login('one', '/', 401);
    await login('two');
    assert.equal(await verifySession(), accountId);
    console.log('Passkeys Web deletion: step-up succeeded, existing session survived and revoked key was rejected');

    desktop = startDesktop(temporary, env);
    const authorize = await desktop.url();
    assert.equal(authorize.origin, ORIGIN);
    assert.equal(authorize.pathname, '/auth/desktop');
    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, '127.0.0.1');
    assert.equal(callback.protocol, 'http:');
    assert.equal(callback.pathname, '/callback');
    callbackOrigin = callback.origin;
    await login('two', authorize.href);
    await page.getByRole('button', { name: '授权并返回应用' }).click();
    await page.waitForURL((url) => url.origin === callbackOrigin && url.pathname === '/callback');
    await page.getByRole('heading', { name: '授权完成' }).waitFor();
    await desktop.expectSuccess();
    console.log('Passkeys Desktop: browser returned to the Rust loopback listener, PKCE exchange and session probe passed');

    await page.goto(screen.settings);
    await panel.getByRole('button', { name: '删除 第二把测试密钥' }).click();
    assert.equal(await panel.getByRole('radio', { name: '已绑定的通行密钥' }).count(), 0);
    await panel.getByLabel('当前密码').fill(PASSWORD);
    await panel.getByRole('button', { name: '确认删除' }).click();
    await panel.getByText('尚未添加通行密钥。').waitFor();
    assert.equal(await verifySession(), accountId);
    await resetBrowserIdentity();
    await checkedPost('/api/auth/login', { identifier: USERNAME, credential: PASSWORD, mode: 'password' });
    assert.equal(await verifySession(), accountId);
    console.log('Passkeys fallback: last credential required the password and password login remained available');

    const runner = await page.request.get('/__web-package__/runner');
    assert.match(runner.headers()['permissions-policy'], /publickey-credentials-create=\(\), publickey-credentials-get=\(\)/u);
  } finally {
    desktop?.stop();
    await browser.close();
  }
}

const env = readAcceptanceEnvironment(process.env);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env, passkeyTestBindings);
const temporaryRoot = await realpath(tmpdir());
const temporary = await mkdtemp(path.join(temporaryRoot, 'maho-passkey-browser-'));
let runtime;
let app;
let server;
try {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  runtime = new Miniflare({
    ...convertV4MiniflareOptions({
      name: 'passkey-browser-acceptance',
      modules: true,
      script: 'export default { fetch() { return new Response("D1 fixture"); } };',
      compatibilityDate: '2024-09-23',
      d1Databases: ['DB'],
    }),
    telemetry: { enabled: false },
  });
  const d1 = await runtime.getD1Database('DB');
  await seedSchema(d1);
  globalThis.__MAHOSHOJO_D1__ = d1;
  // Use the serialized production configuration, as Next's standalone launcher
  // does, to avoid evaluating the checkout's root .env fallback in the fixture.
  const { config } = JSON.parse(await readFile(path.join(WEB_ROOT, '.next/required-server-files.json'), 'utf8'));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
  const { default: next } = await import('next');
  app = next({ dev: false, dir: WEB_ROOT, hostname: 'localhost', port: PASSKEY_TEST_PORT });
  const handle = app.getRequestHandler();
  await app.prepare();
  server = createServer(handle);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PASSKEY_TEST_PORT, '127.0.0.1', resolve);
  });
  await runPasskeyBrowserAcceptance(temporary, env);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await app?.close();
    await runtime?.dispose();
  } finally {
    assert.equal(path.dirname(await realpath(temporary)), temporaryRoot);
    await rm(temporary, { recursive: true, force: true });
  }
}
