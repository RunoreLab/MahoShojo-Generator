import { readFile } from 'node:fs/promises';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { createD1HttpTransport, createHttpD1Client } from '@mahoshojo/hosted-runtime/d1-http-client';
import { bootstrapAdminPrincipal, revokeAdminPrincipal, restoreAdminPrincipal } from '@mahoshojo/hosted-runtime/admin/principals';
import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import { createAccessJwtVerifier } from '../src/security/access';
import { ADMIN_CAPABILITIES } from '../src/index';

const required = (key: string) => { const value = process.env[key]?.trim(); if (!value) throw new Error(`${key} is required`); return value; };
const args = process.argv.slice(2);
const command = args[0];
if (args.slice(1).some(arg => !['--local','--remote','--confirm-remote'].includes(arg)) || new Set(args).size !== args.length) throw new Error('Unexpected control-tool arguments');
if (!['bootstrap', 'revoke', 'restore'].includes(command)) throw new Error('Usage: node scripts/principals.mjs bootstrap|revoke|restore --local|--remote --confirm-remote');
if (args.includes('--local') === args.includes('--remote')) throw new Error('Choose exactly one explicit environment');
let local: Miniflare | undefined;
try {
  let db: AdminDatabase;
  if (args.includes('--remote')) {
    if (!args.includes('--confirm-remote')) throw new Error('Remote principal changes require --confirm-remote');
    const url = new URL(required('ADMIN_CONTROL_GATEWAY_URL'));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid trusted control gateway origin');
    db = createHttpD1Client(createD1HttpTransport({ kind: 'gateway', baseUrl: url.origin,
      hmacSecret: required('ADMIN_CONTROL_GATEWAY_HMAC_SECRET'), accessClientId: process.env.ADMIN_CONTROL_ACCESS_CLIENT_ID,
      accessClientSecret: process.env.ADMIN_CONTROL_ACCESS_CLIENT_SECRET })) as unknown as AdminDatabase;
  } else {
    local = new Miniflare({...convertV4MiniflareOptions({ modules: true, script: 'export default { fetch(){ return new Response("local-control"); } }',
      compatibilityDate: '2026-08-01', d1Databases: { DB: '00000000-0000-0000-0000-000000000000' } }), resourcePersistencePath: '.wrangler/state/v3' });
    db = await local.getD1Database('DB') as unknown as AdminDatabase;
  }
  const common = { id: required('ADMIN_PRINCIPAL_ID'), requestId: crypto.randomUUID(),
    reason: required('ADMIN_CONTROL_REASON'), operatorSafeRef: required('ADMIN_CONTROL_OPERATOR_REF') };
  if (command === 'revoke') {
    await revokeAdminPrincipal(db, common);
    const result = await db.prepare("SELECT result FROM admin_audit_events WHERE request_id=? AND action='admin.principal.revoke'").bind(common.requestId).first<{result: string}>();
    if (result?.result !== 'success') throw new Error('Principal revocation was denied');
  }
  else {
    const verifier = createAccessJwtVerifier({ issuer: required('ADMIN_ACCESS_ISSUER'), audience: required('ADMIN_ACCESS_AUDIENCE'), jwksUrl: required('ADMIN_ACCESS_JWKS_URL') });
    const assertion = (await readFile(required('ADMIN_ACCESS_JWT_FILE'), 'utf8')).trim();
    const verifiedIdentity = await verifier.verify(assertion);
    if (verifiedIdentity.kind !== 'human') throw new Error('First administrator must be a verified human');
    const capabilities = JSON.parse(required(command === 'restore' ? 'ADMIN_RESTORE_CAPABILITIES' : 'ADMIN_BOOTSTRAP_CAPABILITIES')) as string[];
    await (command === 'restore' ? restoreAdminPrincipal : bootstrapAdminPrincipal)(db, { ...common, verifiedIdentity, capabilities, allowedCapabilities: ADMIN_CAPABILITIES });
  }
  console.log('Admin principal operation completed and audited.');
} catch {
  console.error('Admin principal operation failed; no token or credential has been logged. Check configuration and database state before retrying.');
  process.exitCode = 1;
} finally { await local?.dispose(); }
