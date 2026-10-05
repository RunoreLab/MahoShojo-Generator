import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
const resourceName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{1,62}$/.test(value);
export function validateDeploymentConfig(config) {
  const invalid = () => { throw new Error('Admin deployment configuration violates the protected ingress and resource policy'); };
  if (!keys(config, ['$schema','name','main','compatibility_date','compatibility_flags','workers_dev','preview_urls','assets','routes','vars','d1_databases','r2_buckets','queues','triggers','observability','account_id'])) invalid();
  if (config.workers_dev !== false || config.preview_urls !== false
    || !keys(config.assets, ['directory','binding','run_worker_first']) || config.assets.binding !== 'ASSETS' || config.assets.run_worker_first !== true
    || !Array.isArray(config.routes) || config.routes.length !== 1 || !keys(config.routes[0], ['pattern','custom_domain'])
    || config.routes[0].pattern !== 'admin.mahoshojo.colanns.me' || config.routes[0].custom_domain !== true) invalid();
  const vars = config.vars;
  if (!keys(vars, ['ADMIN_ACCESS_ISSUER','ADMIN_ACCESS_AUDIENCE','ADMIN_ACCESS_JWKS_URL','ADMIN_PRINCIPALS_JSON','ADMIN_ENABLED_ACTIONS','ADMIN_ARENA_ORIGIN','ADMIN_ANALYTICS_PRINCIPAL_ID'])
    || !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(vars.ADMIN_ACCESS_ISSUER ?? '')
    || typeof vars.ADMIN_ACCESS_AUDIENCE !== 'string' || !/^[a-f0-9]{64}$/.test(vars.ADMIN_ACCESS_AUDIENCE)
    || vars.ADMIN_ACCESS_JWKS_URL !== vars.ADMIN_ACCESS_ISSUER + '/cdn-cgi/access/certs' || vars.ADMIN_PRINCIPALS_JSON !== '[]') invalid();
  if (vars.ADMIN_ANALYTICS_PRINCIPAL_ID !== undefined && (typeof vars.ADMIN_ANALYTICS_PRINCIPAL_ID !== 'string' || !vars.ADMIN_ANALYTICS_PRINCIPAL_ID || vars.ADMIN_ANALYTICS_PRINCIPAL_ID.length > 128 || vars.ADMIN_ANALYTICS_PRINCIPAL_ID !== vars.ADMIN_ANALYTICS_PRINCIPAL_ID.trim() || /[\u0000-\u001f\u007f]/u.test(vars.ADMIN_ANALYTICS_PRINCIPAL_ID))) invalid();
  if (vars.ADMIN_ENABLED_ACTIONS !== undefined) {
    let actions; try { actions = JSON.parse(vars.ADMIN_ENABLED_ACTIONS); } catch { invalid(); }
    if (!Array.isArray(actions) || actions.length > 100 || !actions.every(action => typeof action === 'string' && /^[a-z][a-z0-9.-]{1,100}$/.test(action)) || new Set(actions).size !== actions.length) invalid();
  }
  if (vars.ADMIN_ARENA_ORIGIN !== undefined) {
    let origin; try { origin = new URL(vars.ADMIN_ARENA_ORIGIN); } catch { invalid(); }
    if (origin.protocol !== 'https:' || origin.origin !== vars.ADMIN_ARENA_ORIGIN || origin.username || origin.password) invalid();
  }
  if (!Array.isArray(config.d1_databases) || config.d1_databases.length !== 1) invalid();
  const db = config.d1_databases[0];
  if (!keys(db, ['binding','database_name','database_id','migrations_dir']) || db.binding !== 'DB' || !resourceName(db.database_name)
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(db.database_id ?? '') || /^0{8}-/.test(db.database_id)) invalid();
  if (!Array.isArray(config.r2_buckets) || config.r2_buckets.length !== 2
    || config.r2_buckets.some(bucket => !keys(bucket, ['binding','bucket_name']) || !resourceName(bucket.bucket_name))
    || [...config.r2_buckets.map(bucket => bucket.binding)].sort().join(',') !== 'ADMIN_OBJECTS,LARGE_OBJECTS'
    || new Set(config.r2_buckets.map(bucket => bucket.bucket_name)).size !== 2) invalid();
  if (!keys(config.queues, ['producers','consumers']) || !Array.isArray(config.queues.producers) || config.queues.producers.length !== 1
    || !Array.isArray(config.queues.consumers) || config.queues.consumers.length !== 1) invalid();
  const producer = config.queues.producers[0], consumer = config.queues.consumers[0];
  if (!keys(producer, ['binding','queue']) || producer.binding !== 'ADMIN_QUEUE' || !resourceName(producer.queue)
    || !keys(consumer, ['queue','max_batch_size','max_retries']) || consumer.queue !== producer.queue || consumer.max_batch_size !== 5 || consumer.max_retries !== 3
    || !keys(config.triggers, ['crons']) || JSON.stringify(config.triggers.crons) !== JSON.stringify(['*/10 * * * *'])
    || (config.account_id !== undefined && !/^[a-f0-9]{32}$/.test(config.account_id))) invalid();
  return config;
}
export async function deploy(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--dry-run') || args.length > 1) throw new Error('Only --dry-run is accepted');
  const source = process.env.ADMIN_DEPLOY_CONFIG;
  if (!source) throw new Error('ADMIN_DEPLOY_CONFIG must name the reviewed private deployment JSON file');
  const config = validateDeploymentConfig(JSON.parse(await readFile(source, 'utf8')));
  config.main = path.join(root, 'src/index.ts');
  config.assets.directory = path.join(root, 'dist/client');
  config.d1_databases[0].migrations_dir = path.resolve(root, '../../drizzle');
  config.compatibility_flags = ['nodejs_compat'];
  config.compatibility_date = '2026-09-12';
  config.name = 'mahoshojo-admin';
  await mkdir(path.join(root, '.wrangler'), { recursive: true });
  const output = path.join(root, '.wrangler/admin-deploy.json');
  await writeFile(output, JSON.stringify(config, null, 2), { mode: 0o600 });
  const cli = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
  const result = spawnSync(process.execPath, [cli, 'deploy', '--config', output, ...args], { cwd: root, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await deploy();
