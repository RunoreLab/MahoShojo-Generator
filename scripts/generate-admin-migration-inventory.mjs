import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const generatorPath = fileURLToPath(import.meta.url);
const rootDirectory = path.resolve(path.dirname(generatorPath), '..');
const outputPath = path.join(rootDirectory, 'config/admin-migration-inventory.json');

const SOURCE_BRANCH = 'feat/admin';
const SOURCE_COMMIT = '73cbc27c1aa5c339486d14831e861a28ba21ab39';
const SOURCE_BASE_COMMIT = '536c866fd005c69b21fa6d8f6a97e75e471524a1';

const runGit = (args) => {
  const result = spawnSync('git', args, {
    cwd: rootDirectory,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`git ${args.join(' ')} 失败：${result.stderr || result.error?.message || 'unknown error'}`);
  }
  return result.stdout;
};

const readChanges = () => runGit([
  '-c',
  'core.quotepath=false',
  'diff',
  '--name-status',
  `${SOURCE_BASE_COMMIT}..${SOURCE_COMMIT}`,
])
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [rawStatus, ...pathParts] = line.split('\t');
    const changeStatus = rawStatus?.[0] ?? '';
    const sourcePath = pathParts.at(-1) ?? '';
    if (!['A', 'M', 'D'].includes(changeStatus) || !sourcePath) {
      throw new Error(`不支持的 feat/admin diff 项：${line}`);
    }
    return { changeStatus, sourcePath };
  })
  .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

const readLegacySource = ({ changeStatus, sourcePath }) => {
  const commit = changeStatus === 'D' ? SOURCE_BASE_COMMIT : SOURCE_COMMIT;
  return runGit(['show', `${commit}:${sourcePath}`]);
};

const sourceKindFor = (sourcePath) => {
  if (sourcePath.startsWith('.github/workflows/') || sourcePath.startsWith('scripts/')) return 'job';
  if (sourcePath.endsWith('schema.sql')) return 'table';
  if (sourcePath.startsWith('app/admin/') && sourcePath.endsWith('/page.tsx')) return 'page';
  if (sourcePath === 'app/admin/page.tsx') return 'page';
  if (sourcePath.startsWith('app/api/') && sourcePath.endsWith('/route.ts')) return 'route';
  if ((sourcePath.startsWith('app/api/') && sourcePath.endsWith('/handler.ts')) || sourcePath.startsWith('components/creation/api/admin/')) return 'handler';
  if (sourcePath.startsWith('tests/')) return 'test';
  if (sourcePath.startsWith('components/')) return 'component';
  if (sourcePath.startsWith('lib/database/') || sourcePath.startsWith('lib/db/repositories/')) return 'repository';
  if (sourcePath.startsWith('lib/')) return 'service';
  if (sourcePath.startsWith('docs/')) return 'reference';
  if (sourcePath === 'env.example' || sourcePath.endsWith('.config.ts') || sourcePath.endsWith('.config.mjs')) return 'config';
  return 'unclassified';
};

const domainFor = (sourcePath) => {
  const normalized = sourcePath.toLowerCase().replaceAll('_', '-');
  if (/dashboard-stats|admin-table-scroll|admintablescroll/.test(normalized)) return 'dashboard';
  if (/user-analytics|analytics-daily|analytics-trends/.test(normalized)) return 'user-analytics';
  if (/user-account|auth-links|auth[-_]/.test(normalized)) return 'user-accounts';
  if (/ai-channel|ai-model|ai-review/.test(normalized)) return 'ai-governance';
  if (/arena-rating|arena-risk/.test(normalized)) return 'arena-ratings';
  if (/battle-report/.test(normalized)) return 'battle-reports';
  if (/crowd-review/.test(normalized)) return 'crowd-review';
  if (/report-appeal/.test(normalized)) return 'report-appeals';
  if (/report-case|governance/.test(normalized)) return 'report-cases';
  if (/message/.test(normalized)) return 'messages';
  if (/data-maintenance|cleanup/.test(normalized)) return 'data-maintenance';
  if (/large-object|\br2\b/.test(normalized)) return 'large-objects';
  if (/redemption|redeem-code/.test(normalized)) return 'redemption-codes';
  if (/badge|award-excellent/.test(normalized)) return 'badges';
  if (/tag/.test(normalized)) return 'tags';
  if (/\bpvp\b/.test(normalized)) return 'pvp';
  if (/questionnaire/.test(normalized)) return 'questionnaires';
  if (/data-?card|content-management|character-management|review-diff|visual-assets/.test(normalized)) return 'content';
  if (/users(?:\/|\.|-)|user-management|user-dashboard/.test(normalized)) return 'users';
  if (/app\/admin|api\/admin\/\[\.\.\.slug\]|creation\/admin\/index|pages-router-compat|do-not-deploy/.test(normalized)) {
    return 'admin-shell';
  }
  if (sourcePath.endsWith('lib/database/schema.sql')) return 'data-maintenance';
  if (
    sourcePath.startsWith('docs/')
    || sourcePath.startsWith('.github/workflows/')
    || sourcePath === 'env.example'
    || sourcePath === 'next.config.ts'
    || sourcePath === 'lib/database/admin.ts'
    || sourcePath === 'lib/debounce.ts'
  ) return 'shared-support';
  return 'unclassified';
};

const riskClassFor = (sourcePath, sourceKind, businessDomain, source) => {
  const normalized = sourcePath.toLowerCase();
  const hasMutationMethod = /\b(?:post|put|patch|delete)\b/i.test(source);
  const hasPersistentWrite = /(?:\.(?:insert|update|delete)\s*\(|\b(?:insert\s+into|update\s+[a-z_][a-z0-9_]*\s+set|delete\s+from)\b|\b(?:putObject|deleteObject|batchUpdate\w*|executeAdmin\w*|takeOverAdmin\w*|cancelAdmin\w*|overrideAdmin\w*)\s*\()/i.test(source);
  const explicitRisk = ({
    'lib/admin/crowd-review.ts': 'R2 privileged',
    'lib/admin/governance.ts': 'R2 privileged',
    'lib/admin/report-cases.ts': 'R2 privileged',
    'lib/database/admin-user-analytics.ts': 'R3 destructive/export/maintenance/config',
    'lib/database/admin.ts': 'R3 destructive/export/maintenance/config',
    'lib/db/repositories/crowd-review.ts': 'R2 privileged',
    'lib/r2.ts': 'R3 destructive/export/maintenance/config',
  })[sourcePath];
  if (explicitRisk) return explicitRisk;

  if (
    sourceKind === 'config'
    || sourceKind === 'table'
    || /data-maintenance|cleanup|large-object|export-|snapshot|daily-snapshot|trigger-admin/.test(normalized)
    || businessDomain === 'ai-governance'
    || /app\/api\/admin\/\[\.\.\.slug\]|creation\/admin\/index/.test(normalized)
    || /\b(?:putObject|deleteObject)\s*\(/.test(source)
  ) return 'R3 destructive/export/maintenance/config';

  if (
    businessDomain === 'pvp'
    || businessDomain === 'arena-ratings'
    || businessDomain === 'redemption-codes'
    || /award-excellent|grant-early-adopters/.test(normalized)
    || /users\/batch|users\/\[id\]|user-management|badges\/(?:grant|revoke)|crowd-review.*(?:cancel|override|take-over|status)|report-(?:cases|appeals).*(?:decision|review)/.test(normalized)
  ) return 'R2 privileged';

  if (
    businessDomain === 'messages'
    || businessDomain === 'badges'
    || businessDomain === 'tags'
    || /batch-update|batch-review|recompute|notify-creator/.test(normalized)
    || hasPersistentWrite
    || (['content', 'report-cases', 'report-appeals', 'crowd-review', 'questionnaires'].includes(businessDomain) && hasMutationMethod)
  ) return 'R1 mutating';

  return 'R0 read-only';
};

const dataTouchedFor = (businessDomain, sourcePath) => {
  if (sourcePath === 'lib/database/admin.ts') {
    return ['legacy cross-domain Admin database helper', 'users/data cards/reports/tags and mixed write surfaces'];
  }
  return ({
  'admin-shell': ['verified Access identity', 'internal admin principal metadata'],
  dashboard: ['aggregate operational/business read models', 'sensitive summary counts'],
  'user-analytics': ['users', 'user_activity', 'auth_audit_logs', 'battle_report_generations', 'legacy admin analytics snapshots'],
  'user-accounts': ['users', 'user_auth_links', 'ba_user', 'auth_audit_logs', 'auth_password_reset_tokens'],
  users: ['users', 'data_cards', 'account status'],
  'ai-governance': ['ai_channels', 'provider availability/config projections'],
  'arena-ratings': ['arena_ratings', 'arena_rating_events', 'strict ranking authority'],
  'battle-reports': ['battle_report_generations', 'large_objects', 'battle report content/metadata'],
  'crowd-review': ['crowd review rounds', 'inspectors', 'votes', 'governance audit'],
  'report-appeals': ['report_appeals', 'report_cases', 'appeal references'],
  'report-cases': ['reports', 'report_cases', 'review decisions', 'notifications'],
  messages: ['site_messages', 'direct_messages', 'message delivery state'],
  'data-maintenance': ['bounded maintenance target tables', 'admin cleanup job/log state'],
  'large-objects': ['large_objects', 'R2 object metadata/content'],
  'redemption-codes': ['redemption_codes', 'redemption side effects'],
  badges: ['badges', 'user_badges', 'badge grants/revocations'],
  tags: ['tags', 'tag_aliases', 'data_card_tags'],
  pvp: ['PVP rooms/matches/rounds', 'PVP authoritative state', 'PVP messages'],
  questionnaires: ['questionnaire definitions', 'native questionnaire policy'],
  content: ['data_cards', 'review status', 'data-card metrics/tags/updates'],
  'shared-support': ['current shared Web business data or presentation support'],
  }[businessDomain] ?? ['unknown legacy data surface - blocked until classified']);
};

const currentOwnerFor = (businessDomain, sourcePath) => {
  if (businessDomain === 'shared-support') {
    if (sourcePath.startsWith('docs/')) return 'docs current Admin topic/spec/plan; legacy document is non-authoritative reference evidence';
    if (sourcePath.startsWith('.github/workflows/')) return '.github/workflows current Web/API deployment owners; the legacy Admin workflow is dropped';
    if (sourcePath === 'env.example' || sourcePath === 'next.config.ts') return 'apps/web owns its config; apps/admin owns an independent manifest and Wrangler config';
    if (sourcePath === 'components/admin/AdminTableScroll.tsx') return 'apps/admin UI shell; rewrite locally without importing legacy/public Web presentation code';
    if (sourcePath === 'lib/database/admin.ts') return 'apps/web/lib/db/repositories/business-users.ts; apps/web/lib/db/repositories/data-cards-write.ts; apps/web/lib/db/repositories/data-card-review.ts; apps/web/lib/db/repositories/data-card-reports.ts; apps/web/lib/db/repositories/tags.ts; legacy mixed repository has no single owner and remains deferred';
    if (sourcePath === 'lib/debounce.ts') return 'no current runtime owner or second consumer; legacy generic helper is dropped and may not become a shared dumping-ground abstraction';
    return 'no current runtime owner; asset is legacy-only and remains dropped/deferred until a concrete owner is proven';
  }
  return ({
  'admin-shell': 'apps/admin (new owner; no prior implementation on current baseline)',
  dashboard: 'apps/web/lib/database/users.ts; apps/web/lib/database/data-cards.ts; apps/web/lib/db/repositories/messages.ts; apps/web/lib/db/repositories/data-card-reports.ts; apps/web/lib/db/repositories/battle-report-generations.ts; no cross-domain Admin read-model contract yet',
  'user-analytics': 'apps/web/lib/database/user-activity.ts; apps/web/lib/db/repositories/user-activity.ts; apps/web/lib/db/repositories/auth-audit-logs.ts; apps/web/lib/db/repositories/battle-report-generations.ts; no Admin analytics read-model contract yet',
  'user-accounts': 'apps/web/lib/db/schema/auth.ts; apps/web/lib/db/schema/business.ts; apps/web/lib/db/repositories/user-auth-links.ts; apps/web/lib/db/repositories/auth-audit-logs.ts; apps/web/lib/db/repositories/password-reset-tokens.ts; apps/web/lib/db/repositories/business-users.ts',
  users: 'apps/web/lib/database/users.ts; apps/web/lib/db/repositories/business-users.ts; apps/web/lib/db/repositories/data-cards-core.ts; apps/web/lib/db/repositories/data-cards-write.ts',
  'ai-governance': 'apps/web/lib/db/schema/ai-availability.ts; packages/hosted-runtime/src/node-runtime/providers.ts; packages/hosted-runtime/src/custom-provider-runtime.ts',
  'arena-ratings': 'apps/web/lib/db/repositories/arena-read.ts; apps/web/lib/db/repositories/arena-ratings-write.ts; apps/web/lib/db/repositories/arena-maintenance.ts; apps/web/lib/arena/service.ts; packages/domain/src/arena-reconciliation.ts',
  'battle-reports': 'apps/web/lib/db/repositories/battle-report-generations.ts; packages/hosted-runtime/src/arena-generation/finalization.ts; packages/hosted-runtime/src/arena-generation/r2-object-store.ts',
  'crowd-review': 'apps/web/lib/crowd-review/service.ts and apps/web/lib/db/repositories/crowd-review.ts',
  'report-appeals': 'apps/web/lib/db/repositories/report-appeals.ts; apps/web/lib/report-appeals/service.ts',
  'report-cases': 'apps/web/lib/data-card-reports/* and apps/web/lib/db/repositories/data-card-reports.ts',
  messages: 'apps/web/lib/messages/service.ts and apps/web/lib/db/repositories/messages.ts',
  'data-maintenance': 'apps/web/lib/db/schema/business.ts; apps/web/lib/db/schema/auth.ts; apps/web/lib/db/schema/ai-availability.ts; apps/web/lib/database/schema.sql; target-specific repository remains authoritative and no generic Admin maintenance owner is accepted',
  'large-objects': 'apps/web/lib/db/repositories/large-objects.ts; packages/hosted-runtime/src/arena-generation/r2-object-store.ts',
  'redemption-codes': 'apps/web/lib/db/repositories/redemption-codes.ts; apps/web/lib/database/redemption-codes.ts',
  badges: 'apps/web/lib/db/repositories/badges.ts; apps/web/lib/db/repositories/badges-granting.ts; apps/web/lib/db/repositories/badges-maintenance.ts',
  tags: 'apps/web/lib/db/repositories/tags.ts; apps/web/lib/db/repositories/tags-seed.ts; apps/web/lib/db/repositories/data-card-meta.ts',
  pvp: 'apps/web/lib/db/repositories/pvp-room-core.ts; apps/web/lib/db/repositories/pvp-match-round-chat.ts; apps/web/lib/database/pvp.ts; Arena Room authority/wire remains a separate domain and is not a PVP owner',
  questionnaires: 'packages/domain/src/questionnaire.ts; packages/hosted-runtime/src/questionnaire-generation-runtime.ts; apps/web/lib/questionnaires.ts',
  content: 'apps/web/lib/db/repositories/data-cards-core.ts; apps/web/lib/db/repositories/data-cards-write.ts; apps/web/lib/db/repositories/data-card-review.ts; apps/web/lib/db/repositories/data-card-meta.ts',
  }[businessDomain]);
};

const capabilityFor = (businessDomain, riskClass, sourcePath) => {
  if (/(?:^|\/)(?:export|download)(?:-|\/)/i.test(sourcePath)) return 'exports.read';
  if (sourcePath === 'lib/database/admin.ts') return 'data.maintenance';
  if (businessDomain === 'admin-shell') return 'admin.shell.read';
  if (businessDomain === 'dashboard') return 'dashboard.read';
  if (businessDomain === 'user-analytics') return riskClass.startsWith('R3') ? 'data.maintenance' : 'users.analytics.read';
  if (businessDomain === 'user-accounts') return 'users.read.sensitive';
  if (businessDomain === 'users') return riskClass.startsWith('R0') ? 'users.read' : 'users.write';
  if (businessDomain === 'ai-governance') return 'system.config';
  if (businessDomain === 'arena-ratings') return riskClass.startsWith('R0') ? 'ratings.read' : 'ratings.reset';
  if (businessDomain === 'battle-reports') return riskClass.startsWith('R3') ? 'exports.read' : 'battle-reports.read';
  if (businessDomain === 'crowd-review') return riskClass.startsWith('R0') ? 'crowd-review.read' : 'crowd-review.action';
  if (businessDomain === 'report-appeals') return riskClass.startsWith('R0') ? 'reports.read' : 'reports.decide';
  if (businessDomain === 'report-cases') return riskClass.startsWith('R0') ? 'reports.read' : 'reports.decide';
  if (businessDomain === 'messages') return riskClass.startsWith('R0') ? 'messages.read' : 'messages.write';
  if (businessDomain === 'data-maintenance') return 'data.maintenance';
  if (businessDomain === 'large-objects') return riskClass.startsWith('R0') ? 'storage.read' : 'data.maintenance';
  if (businessDomain === 'redemption-codes') return 'redemptions.write';
  if (businessDomain === 'badges') return riskClass.startsWith('R0') ? 'badges.read' : 'badges.write';
  if (businessDomain === 'tags') return riskClass.startsWith('R0') ? 'content.read' : 'content.taxonomy.write';
  if (businessDomain === 'pvp') return riskClass.startsWith('R0') ? 'pvp.read' : 'pvp.recover';
  if (businessDomain === 'questionnaires') return riskClass.startsWith('R0') ? 'content.read' : 'content.questionnaire.write';
  if (businessDomain === 'content') return riskClass.startsWith('R0') ? 'content.read' : 'content.review';
  return riskClass.startsWith('R0') ? 'admin.support.read' : 'admin.support.write';
};

const contractFor = (businessDomain, riskClass) => {
  const mode = riskClass.startsWith('R0') ? 'read-model' : 'command';
  if (businessDomain === 'admin-shell') return 'same-origin apps/admin HTTP/BFF route registry with explicit capability declaration';
  if (businessDomain === 'pvp' || businessDomain === 'arena-ratings') {
    return `versioned ${businessDomain} ${mode} contract that calls current authoritative service; direct table repair is forbidden`;
  }
  if (riskClass.startsWith('R3')) {
    return `bounded ${businessDomain} job/export/config contract with explicit schema, scope and receipt; no arbitrary SQL/shell/proxy`;
  }
  return `versioned Admin ${businessDomain} ${mode} contract over the current owner; no apps/admin -> apps/web source import`;
};

const dispositionFor = ({ changeStatus, sourcePath, sourceKind, businessDomain, riskClass }) => {
  const normalized = sourcePath.toLowerCase();
  if (changeStatus === 'D') return 'drop';
  if (normalized === 'docs/plans/2026-03-28-battle-lite-page.md') return 'drop';
  if (normalized === 'lib/debounce.ts') return 'drop';
  if (/do[-_]not[-_]deploy|app\/admin\/|app\/api\/admin\/\[\.\.\.slug\]|pages-router-compat|badge\/badgeshow|env\.example|next\.config/.test(normalized)) {
    return 'drop';
  }
  if (sourceKind === 'table' || sourceKind === 'job' || riskClass.startsWith('R3')) return 'defer';
  if (sourceKind === 'test' || sourceKind === 'reference' || sourceKind === 'service') return 'adapt';
  if (sourceKind === 'handler' || sourceKind === 'route' || sourceKind === 'repository' || sourceKind === 'component' || sourceKind === 'page') {
    return 'rewrite';
  }
  if (businessDomain === 'shared-support') return 'drop';
  return 'adapt';
};

const destinationFor = (asset) => {
  if (asset.disposition === 'drop') return 'none; legacy asset is obsolete, duplicated, or violates the independent Admin boundary';
  if (asset.disposition === 'defer') {
    return asset.riskClass.startsWith('R3')
      ? `G3-5 bounded ${asset.businessDomain} capability after production-grade audit/job design`
      : `later Admin Goal for ${asset.businessDomain}`;
  }
  if (asset.sourceKind === 'test') return `apps/admin/tests/${asset.businessDomain} current-architecture contract/negative coverage`;
  if (asset.sourceKind === 'page' || asset.sourceKind === 'component') return `apps/admin/src/ui/${asset.businessDomain}`;
  if (asset.sourceKind === 'handler' || asset.sourceKind === 'route') return `apps/admin/src/routes/${asset.businessDomain} through same-origin BFF`;
  if (asset.sourceKind === 'repository') return `server-side ${asset.businessDomain} service/repository seam owned outside the browser`;
  if (asset.sourceKind === 'reference') return `current Admin topic/spec/plan or implementation evidence for ${asset.businessDomain}`;
  return `apps/admin server-side ${asset.businessDomain} module or a narrowly scoped package if a second real consumer exists`;
};

const trustAssumptionsFor = (asset) => {
  const assumptions = [
    'legacy Admin lived inside the public Web/long-lived branch and had no independent Cloudflare Access origin boundary',
  ];

  if (asset.sourceKind === 'component' || asset.sourceKind === 'page') {
    assumptions.push('route or button visibility was treated as a trust signal while the browser called legacy /api/admin directly');
  } else if (['handler', 'route', 'repository', 'service'].includes(asset.sourceKind)) {
    assumptions.push('authorization depended on scattered handler checks or caller discipline instead of a deny-by-default capability registry');
  } else {
    assumptions.push('the asset inherited branch-local operator trust and was not verified against the current app/secret boundary');
  }

  if (!asset.riskClass.startsWith('R0')) {
    assumptions.push('single-admin, no-concurrency and no-retry behavior was assumed; reason/version/idempotency were not uniformly enforced server-side');
  }
  if (asset.riskClass.startsWith('R3')) {
    assumptions.push('blast radius, secret scope, bounded execution and durable audit failure semantics were not proven for a public Admin origin');
  }
  if (asset.businessDomain === 'user-accounts') {
    assumptions.push('legacy business user/admin flags could be conflated with a stable Access issuer+subject administrator principal');
  }
  if (asset.sourcePath === 'components/creation/api/admin/data-maintenance/execute.ts') {
    assumptions.push('legacy Authorization: Bearer <authkey> was optional and only populated createdByUserId; missing or invalid bearer silently became null while the catch-all route/middleware supplied no unified authentication guard');
    assumptions.push('Better Auth application sessions and the legacy bearer authkey were not equivalent identity contracts; this asset remains a later migration blocker until an explicit compatibility contract is accepted');
  }
  if (asset.businessDomain === 'pvp' || asset.businessDomain === 'arena-ratings') {
    assumptions.push('direct database/workbench repairs could bypass current Arena/PVP authority, replay and settlement contracts');
  }
  return assumptions;
};

const auditRequirementFor = (asset) => {
  if (asset.riskClass.startsWith('R0')) {
    return ['user-accounts', 'battle-reports'].includes(asset.businessDomain)
      ? 'security-sensitive read audit policy must be decided before G3-1 exposure; denied requests are always auditable'
      : 'denied-request/security audit now; successful read audit follows domain data classification';
  }
  return 'required durable audit envelope for actor/capability/action/target/request/reason/result; required audit failure must not silently succeed';
};

const concurrencyFor = (asset) => {
  if (asset.riskClass.startsWith('R0')) return 'read-only; no mutation or automatic replay is allowed';
  if (asset.riskClass.startsWith('R1')) return 'stable requestId plus domain-specific expectedVersion/idempotency before enabling writes';
  if (asset.riskClass.startsWith('R2')) return 'reason + expectedVersion + idempotencyKey/stable operation ID + bounded retry/fresh confirmation';
  return 'bounded preview/execute or generate/download job; reason + version + idempotency + receipt + explicit partial-failure recovery';
};

const migrationFor = (asset) => {
  if (asset.sourceKind === 'table') return 'DEFERRED: design an expand -> caller rollout -> contract migration; G3-P0 performs no schema or data write';
  if (asset.riskClass.startsWith('R3')) return 'DEFERRED: revalidate current schema/ownership and add reversible migration only in the owning later Goal';
  return 'no schema change in G3-P0; revalidate current schema/producer/consumer compatibility before the domain is migrated';
};

const testEvidenceFor = (asset) => {
  if (asset.sourceKind === 'test') {
    return `legacy behavior clue at ${asset.sourcePath}; adapt assertions and add Access/RBAC/CSRF/audit/fault coverage before migration`;
  }
  return `legacy branch coverage for ${asset.businessDomain} is non-authoritative; current-architecture positive, negative and boundary tests are required`;
};

const rollbackFor = (asset) => {
  if (asset.disposition === 'drop') return 'do not migrate; current baseline remains authoritative';
  if (asset.disposition === 'defer') return 'no runtime change in G3-P0; later domain writer/job must have an independent disable/rollback path';
  return `disable/revert the ${asset.businessDomain} Admin route/module without reverting apps/web, Phase 2.5, schema or production data`;
};

const buildAsset = (change) => {
  const source = readLegacySource(change);
  const sourceKind = sourceKindFor(change.sourcePath);
  const businessDomain = domainFor(change.sourcePath);
  const riskClass = riskClassFor(change.sourcePath, sourceKind, businessDomain, source);
  const partial = {
    ...change,
    sourceRef: `${change.changeStatus === 'D' ? SOURCE_BASE_COMMIT : SOURCE_COMMIT}:${change.sourcePath}`,
    sourceKind,
    businessDomain,
    dataTouched: dataTouchedFor(businessDomain, change.sourcePath),
    riskClass,
    currentOwner: currentOwnerFor(businessDomain, change.sourcePath),
    apiOrServiceContract: contractFor(businessDomain, riskClass),
    requiredCapability: capabilityFor(businessDomain, riskClass, change.sourcePath),
  };
  const disposition = dispositionFor(partial);
  const asset = { ...partial, disposition };

  return {
    sourceRef: asset.sourceRef,
    sourcePath: asset.sourcePath,
    changeStatus: asset.changeStatus,
    sourceKind: asset.sourceKind,
    businessDomain: asset.businessDomain,
    dataTouched: asset.dataTouched,
    riskClass: asset.riskClass,
    legacyTrustAssumptions: trustAssumptionsFor(asset),
    disposition: asset.disposition,
    newDestination: destinationFor(asset),
    currentOwner: asset.currentOwner,
    apiOrServiceContract: asset.apiOrServiceContract,
    requiredCapability: asset.requiredCapability,
    auditRequirement: auditRequirementFor(asset),
    concurrencyOrIdempotency: concurrencyFor(asset),
    migrationRequirement: migrationFor(asset),
    testEvidence: testEvidenceFor(asset),
    rollback: rollbackFor(asset),
    status: 'INVENTORIED',
    notes: `legacy diff=${asset.changeStatus}; current platform owner wins over legacy implementation details; production enablement is outside G3-P0`,
  };
};

const countBy = (assets, key) => Object.fromEntries(
  [...new Set(assets.map((asset) => asset[key]))]
    .sort()
    .map((value) => [value, assets.filter((asset) => asset[key] === value).length]),
);

const sourcePathsSha256 = (assets) => createHash('sha256')
  .update(`${assets.map((asset) => asset.sourcePath).sort().join('\n')}\n`)
  .digest('hex');

const assetsSha256 = (assets) => createHash('sha256')
  .update(JSON.stringify(assets))
  .digest('hex');

const generatorSha256 = () => createHash('sha256')
  .update(readFileSync(generatorPath))
  .digest('hex');

const assets = readChanges().map(buildAsset);
const unclassifiedAssets = assets.filter((asset) => (
  asset.sourceKind === 'unclassified' || asset.businessDomain === 'unclassified'
));
if (unclassifiedAssets.length > 0) {
  throw new Error(`Admin migration inventory has unclassified assets:\n${unclassifiedAssets
    .map((asset) => `- ${asset.sourcePath} (${asset.sourceKind}/${asset.businessDomain})`)
    .join('\n')}`);
}
const inventory = {
  schemaVersion: 'admin-migration-inventory-v1',
  sourceBranch: SOURCE_BRANCH,
  sourceCommit: SOURCE_COMMIT,
  sourceBaseCommit: SOURCE_BASE_COMMIT,
  generatedBy: 'scripts/generate-admin-migration-inventory.mjs',
  generatorSha256: generatorSha256(),
  baseline: {
    targetBranch: 'feat/admin-reintegration',
    targetCommitAtInventoryStart: 'c1971e8852bccfd1a7d4c20644b7255f94bb182e',
    phaseState: 'G3-P0 downstream pre-work only; Phase 3 is not declared complete or production-ready',
  },
  summary: {
    totalAssets: assets.length,
    unclassifiedAssets: unclassifiedAssets.length,
    sourcePathsSha256: sourcePathsSha256(assets),
    assetsSha256: assetsSha256(assets),
    bySourceKind: countBy(assets, 'sourceKind'),
    byBusinessDomain: countBy(assets, 'businessDomain'),
    byRiskClass: countBy(assets, 'riskClass'),
    byDisposition: countBy(assets, 'disposition'),
  },
  assets,
};

const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
const args = new Set(process.argv.slice(2));

if (args.has('--write')) {
  writeFileSync(outputPath, serialized);
  console.log(`wrote ${path.relative(rootDirectory, outputPath)} (${assets.length} assets)`);
} else if (args.has('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== serialized) {
    console.error('Admin migration inventory drifted; run node scripts/generate-admin-migration-inventory.mjs --write');
    process.exitCode = 1;
  } else {
    console.log(`Admin migration inventory is current (${assets.length} assets)`);
  }
} else {
  process.stdout.write(serialized);
}
