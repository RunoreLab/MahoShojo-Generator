import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import { bootstrapAdminPrincipal } from '@mahoshojo/hosted-runtime/admin/principals';
import { createAdminWorker, ADMIN_CAPABILITIES, type AdminRuntimeBindings } from '../src/index';
import { REGISTERED_ACTIONS } from '../src/actions';
import { createAccessJwtVerifier } from '../src/security/access';
import { AI_PROVIDER_CATALOG } from '@mahoshojo/ai-core/provider-catalog';

export const LOCAL_DATABASE_ID = '00000000-0000-0000-0000-000000000000';
export const FIXTURE_IDENTITY = { issuer: 'https://fixture.cloudflareaccess.invalid', subject: 'synthetic-admin', kind: 'human' as const };
// These baseline scripts together describe the current business schema. This is a fresh local fixture, not a migration runner.
const schemaFiles = ['apps/web/lib/database/schema.sql', 'drizzle/0000_auth_domain_bootstrap.sql',
  'drizzle/0013_ai_channel_availability.sql', 'drizzle/0014_admin_foundation.sql', 'drizzle/0015_admin_actor_attribution.sql'];
const additionalMigrations = ['drizzle/0016_admin_object_tombstones.sql'];
const fixtureIdentity = (writers: boolean, review = false) => ({...FIXTURE_IDENTITY, subject: review ? 'synthetic-admin-reviewer' : writers ? 'synthetic-admin-writer' : FIXTURE_IDENTITY.subject});
const fixturePrincipalId = (writers: boolean, review = false) => review ? 'local-fixture-reviewer' : writers ? 'local-fixture-writer' : 'local-fixture-admin';
export const LOCAL_WRITER_ACTIONS = REGISTERED_ACTIONS.filter(action => ['content.write','tags.write','messages.write'].includes(action.capability) && action.name !== 'cards.metrics');
const REVIEW_ACTION_NAMES = ['ai.review', 'jobs.export', 'cards.review', 'card-updates.review'];
const fixtureActions = (writers: boolean, review: boolean) => REGISTERED_ACTIONS.filter(action =>
  (writers && LOCAL_WRITER_ACTIONS.includes(action)) || (review && REVIEW_ACTION_NAMES.includes(action.name)));
// Explicitly synthetic provider: intercepted below, with no network fallback for any URL.
const fixtureProviders = [{ name: 'synthetic-local-review-no-network', type: 'openai', apiKey: 'synthetic-local-only-not-a-real-key',
  baseUrl: 'https://synthetic-review.invalid/v1', model: AI_PROVIDER_CATALOG.find(provider => provider.id === 'system')!.models.filter(model => model.value !== 'default').map(model => model.value) }];
export const syntheticReviewFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = await request.json() as { model: string; messages?: {content: string | {text?: string}[]}[]; contents?: {parts: {text?: string}[]}[] };
  const text = body.messages?.map(message => typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('\n')).join('\n')
    ?? body.contents?.flatMap(content => content.parts.map(part => part.text ?? '')).join('\n') ?? '';
  const marker = '待审查列表（JSON）：\n';
  const start = text.lastIndexOf(marker);
  if (start < 0) throw new Error('Synthetic review requires a known local prompt');
  const match = text.slice(start + marker.length).match(/^\s*(\[[\s\S]*?\n\])/);
  const targets = JSON.parse(match?.[1] ?? 'null') as {id: string}[] | null;
  if (!targets?.length || targets.some(target => !/^(card|update):fixture-/.test(target.id))) throw new Error('Synthetic review only accepts fixture targets');
  const reviews = targets.map(target => ({id: target.id, suggestion: target.id.endsWith('reject') ? 'rejected' : 'approved',
    reason: target.id.endsWith('reject') ? '本地合成拒绝建议，供人工复核演示' : '本地合成通过建议，供人工复核演示'}));
  if (body.contents) return Response.json({candidates: [{content: {role: 'model', parts: [{text: JSON.stringify({reviews})}]}, finishReason: 'STOP', index: 0}],
    usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 25, totalTokenCount: 125}});
  return Response.json({id: 'synthetic-local-completion', object: 'chat.completion', created: 1800000000, model: body.model,
    choices: [{index: 0, message: {role: 'assistant', content: JSON.stringify({reviews})}, finish_reason: 'stop'}],
    usage: {prompt_tokens: 100, completion_tokens: 25, total_tokens: 125}});
};
export function splitFixtureSql(source: string): string[] {
  const statements: string[] = []; let statement = ''; let quote = ''; let lineComment = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (lineComment) { if (char === '\n') { lineComment = false; statement += '\n'; } continue; }
    if (!quote && char === '-' && source[i + 1] === '-') { lineComment = true; i++; continue; }
    if (quote) {
      statement += char;
      if (char === quote) { if (source[i + 1] === quote) statement += source[++i]; else quote = ''; }
    } else if (["'", '"', '`'].includes(char)) { quote = char; statement += char; }
    else if (char === ';') { if (statement.trim()) statements.push(statement.trim()); statement = ''; }
    else statement += char;
  }
  if (quote) throw new Error('Unterminated fixture SQL literal');
  if (statement.trim()) statements.push(statement.trim());
  return statements;
}
export async function initializeLocalFixture(db: AdminDatabase, repositoryRoot: string, writers = false, review = false) {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','admin_local_fixture')").all<{ name: string }>();
  if (tables.results.some(table => table.name === 'admin_local_fixture')) {
    const marker = await db.prepare('SELECT version FROM admin_local_fixture WHERE id=1').first<{version: number}>();
    if (marker?.version !== 1) throw new Error('Unsupported local fixture version; use a new isolated state directory');
  } else {
    if (tables.results.length) throw new Error('Refusing to initialize an existing non-fixture database');
    const statements = (await Promise.all(schemaFiles.map(file => readFile(path.join(repositoryRoot, file), 'utf8')))).flatMap(source => source.includes('--> statement-breakpoint') ? source.split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean) : splitFixtureSql(source));
    await db.batch([...statements.map(sql => db.prepare(sql)),
      db.prepare('CREATE TABLE admin_local_fixture (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)'),
      db.prepare('INSERT INTO admin_local_fixture VALUES(1,1)'),
      db.prepare("INSERT INTO users (id,username,email,auth_key) VALUES(1,'本地合成用户 <img src=x onerror=alert(1)>','fixture@example.invalid','fixture-not-a-real-auth-key')"),
    ]);
  }
  await db.prepare('CREATE TABLE IF NOT EXISTS admin_local_fixture_migrations (name TEXT PRIMARY KEY)').run();
  for (const file of additionalMigrations) {
    if (await db.prepare('SELECT name FROM admin_local_fixture_migrations WHERE name=?').bind(file).first()) continue;
    const statements = (await readFile(path.join(repositoryRoot, file), 'utf8')).split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean);
    await db.batch([...statements.map(sql => db.prepare(sql)), db.prepare('INSERT INTO admin_local_fixture_migrations VALUES(?)').bind(file)]);
  }
  if (!await db.prepare("SELECT name FROM admin_local_fixture_migrations WHERE name='synthetic-cards-v1'").first()) {
    await db.batch([
      db.prepare("INSERT INTO data_cards (id,user_id,type,name,description,data,is_public,review_status) VALUES ('fixture-card-1',1,'character','合成待审核卡','恶意文本 <script>alert(1)</script>','{}',0,'pending'),('fixture-card-2',1,'questionnaire','合成问卷','仅本地验证','{\"nativeAllowed\":false}',1,'approved')"),
      db.prepare("INSERT INTO data_card_updates (id,data_card_id,user_id,name,data,created_at) VALUES ('fixture-update-1','fixture-card-2',1,'历史待审核更新','{\"nativeAllowed\":false}', '2026-08-01T00:00:00.000Z')"),
      db.prepare("INSERT INTO admin_local_fixture_migrations VALUES('synthetic-cards-v1')"),
    ]);
  }
  if (review && !await db.prepare("SELECT name FROM admin_local_fixture_migrations WHERE name='synthetic-review-v1'").first()) {
    await db.batch([
      db.prepare("INSERT INTO data_cards (id,user_id,type,name,description,data,is_public,review_status) VALUES ('fixture-card-reject',1,'character','合成拒绝建议卡','仅本地演示：模拟AI建议拒绝，需人工决定','{}',0,'pending')"),
      db.prepare("INSERT INTO admin_local_fixture_migrations VALUES('synthetic-review-v1')"),
    ]);
  }
  const principalId = fixturePrincipalId(writers, review);
  const principal = await db.prepare('SELECT id FROM admin_principals WHERE id=?').bind(principalId).first();
  if (!principal) await bootstrapAdminPrincipal(db, { id: principalId, verifiedIdentity: fixtureIdentity(writers, review),
    capabilities: ADMIN_CAPABILITIES.filter(capability => capability.endsWith('.read') || capability === 'arena.observe' || fixtureActions(writers, review).some(action => action.capability === capability)),
    allowedCapabilities: ADMIN_CAPABILITIES, requestId: crypto.randomUUID(), reason: '初始化本地合成工作台', operatorSafeRef: 'local-fixture-tool' });
}
export async function createLocalFixture(repositoryRoot: string, persist?: string, writers = false, review = false) {
  const runtime = new Miniflare({...convertV4MiniflareOptions({ modules: true,
    script: 'export default { fetch() { return new Response("local-fixture"); } };', compatibilityDate: '2026-08-01',
    d1Databases: { DB: LOCAL_DATABASE_ID },
    r2Buckets: ['ADMIN_OBJECTS', 'LARGE_OBJECTS'] }), resourcePersistencePath: persist });
  try {
    const db = await runtime.getD1Database('DB') as unknown as AdminDatabase;
    await initializeLocalFixture(db, repositoryRoot, writers, review);
    const pair = await generateKeyPair('RS256');
    const jwk = await exportJWK(pair.publicKey); jwk.kid = 'local-ephemeral'; jwk.alg = 'RS256';
    const audience = 'local-fixture-admin';
    const token = await new SignJWT({type: 'app'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid})
      .setIssuer(FIXTURE_IDENTITY.issuer).setAudience(audience).setSubject(fixtureIdentity(writers, review).subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
    const worker = createAdminWorker({ providerFetch: review ? syntheticReviewFetch : undefined,
      createAccessVerifier: options => createAccessJwtVerifier({...options, jwks: createLocalJWKSet({keys: [jwk]})}) });
    const env = { DB: db, ADMIN_OBJECTS: await runtime.getR2Bucket('ADMIN_OBJECTS'), LARGE_OBJECTS: await runtime.getR2Bucket('LARGE_OBJECTS'),
      ADMIN_ACCESS_ISSUER: FIXTURE_IDENTITY.issuer, ADMIN_ACCESS_AUDIENCE: audience,
      ADMIN_ACCESS_JWKS_URL: FIXTURE_IDENTITY.issuer + '/cdn-cgi/access/certs', ADMIN_PRINCIPALS_JSON: '[]', ADMIN_ENABLED_ACTIONS: JSON.stringify(fixtureActions(writers, review).map(action => action.name)),
      ...(review ? { ADMIN_AI_PROVIDERS_CONFIG: JSON.stringify(fixtureProviders), ADMIN_QUEUE: { async send() { /* drainJobs consumes bounded local work. */ } } } : {}),
      ASSETS: { async fetch(request: Request) {
        const name = new URL(request.url).pathname;
        if (!['/assets/app.js','/assets/app.css'].includes(name)) return new Response(null, {status: 404});
        try { return new Response(await readFile(path.join(repositoryRoot, 'apps/admin/dist/client', name)), {headers: {'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'}}); }
        catch { return new Response(null, {status: 503}); }
      } },
    } as unknown as AdminRuntimeBindings;
    const drainJobs = async () => {
      if (!review) return;
      for (let step = 0; step < 20; step++) {
        const job = await db.prepare("SELECT id FROM admin_jobs WHERE actor_principal_id=? AND kind IN ('ai-review','export') AND status='queued' AND julianday(next_attempt_at)<=julianday('now') ORDER BY created_at LIMIT 1").bind(fixturePrincipalId(writers, review)).first<{id: string}>();
        if (!job) return;
        let failed = false;
        await worker.queue({messages: [{body: {id: job.id}, ack() {}, retry() { failed = true; }}]}, env);
        if (failed) return;
      }
    };
    return { runtime, db, env, worker, token, drainJobs, dispose: () => runtime.dispose() };
  } catch (error) { await runtime.dispose(); throw error; }
}
