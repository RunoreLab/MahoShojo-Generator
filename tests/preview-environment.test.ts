import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'comment-json';
import { validatePreviewEnvironment } from '../scripts/check-preview-environment.mjs';

const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/preview-deploy.yml');
const WRANGLER_PATH = resolve(process.cwd(), 'apps/web/wrangler.jsonc');
const ENVIRONMENT_PATH = resolve(process.cwd(), 'config/preview-environment.json');
const REDIS_RUNTIME_PATH = resolve(process.cwd(), 'apps/api/src/redis/runtime.ts');
const MIGRATION_SCRIPT_PATH = resolve(process.cwd(), 'scripts/d1-migrate-safe.mjs');

describe('preview deployment provisioning contract', () => {
  test('preview explicitly shares the production D1 binding while other resources remain gated', () => {
    const wrangler = parse(readFileSync(WRANGLER_PATH, 'utf8'), undefined, true) as {
      d1_databases?: Array<{ database_id?: string }>;
      env?: {
        preview?: { d1_databases?: Array<{ database_id?: string }> };
        production?: { d1_databases?: Array<{ database_id?: string }> };
      };
    };
    const environment = JSON.parse(readFileSync(ENVIRONMENT_PATH, 'utf8')) as {
      status: string;
      activation: string;
      resources: Record<string, string>;
    };

    const productionIds = new Set([
      ...(wrangler.d1_databases ?? []),
      ...(wrangler.env?.production?.d1_databases ?? []),
    ].map((entry) => entry.database_id));
    const previewDatabases = wrangler.env?.preview?.d1_databases ?? [];

    expect(previewDatabases).toHaveLength(1);
    expect(productionIds).toContain(previewDatabases[0]?.database_id);
    expect(environment).toMatchObject({
      status: 'not-provisioned',
      activation: 'fail-closed',
      resources: {
        d1: 'shared-production',
        redis: 'shared-prefix',
        r2: 'dedicated',
        secrets: 'impact-classified',
      },
    });
    expect(environment).not.toHaveProperty('schemaGate');
  });

  test('preview workflow isolates non-D1 credentials/resources without requiring isolated D1 evidence', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('PREVIEW_VPS_HOST');
    expect(workflow).toContain('PREVIEW_VPS_USER');
    expect(workflow).toContain('PREVIEW_VPS_SSH_PRIVATE_KEY');
    expect(workflow).toContain('PREVIEW_VPS_HOST_KEY');
    expect(workflow).toContain('PREVIEW_REDIS_NETWORK_NAME');
    expect(workflow).toContain('check:preview:environment -- --require-provisioned');
    expect(workflow).not.toContain('PREVIEW_D1_SCHEMA_EVIDENCE_PATH');
    expect(workflow).not.toContain('VPS_USER: root');
    expect(workflow).not.toContain('secrets.VPS_SSH_PRIVATE_KEY');
    expect(workflow).not.toContain('mahoshojo-redis\n');
    expect(workflow).not.toContain('production .env.hono');
  });

  test('共享 Redis 仅通过 runtime 的前缀 port 隔离，应用不拥有 destructive command port', () => {
    const runtime = readFileSync(REDIS_RUNTIME_PATH, 'utf8');

    expect(runtime).toContain('mahoshojo:rate-limit:${namespacedNamespace}:');
    expect(runtime).not.toMatch(/flush(?:All|Db)|sendCommand/u);
    expect(runtime).toContain('getGenerationReplayStore');
  });

  test('preview migration 在脚本内部验证 binding 与 production D1 一致', () => {
    const migration = readFileSync(MIGRATION_SCRIPT_PATH, 'utf8');

    expect(migration).toContain('assertPreviewD1MatchesProduction');
    expect(migration).toContain("options.env !== 'preview'");
    expect(migration).toContain("environment?.status !== 'provisioned'");
    expect(migration).toContain('preview migration 必须指向 production D1');
  });

  test('provisioned gate 接受 production-shared D1 且不再要求 schema evidence', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const wrangler = parse(readFileSync(WRANGLER_PATH, 'utf8'), undefined, true) as {
      env?: { preview?: { d1_databases?: Array<{ database_id?: string }> } };
    };
    const environment = {
      ...JSON.parse(readFileSync(ENVIRONMENT_PATH, 'utf8')) as Record<string, unknown>,
      status: 'provisioned',
    };
    const previewDatabaseId = wrangler.env?.preview?.d1_databases?.[0]?.database_id;

    expect(previewDatabaseId).toBeDefined();
    expect(validatePreviewEnvironment({
      environment,
      env: {
        PREVIEW_D1_DATABASE_ID: previewDatabaseId,
        PREVIEW_VPS_HOST: 'preview.example.test',
        PREVIEW_VPS_USER: 'deploy-preview',
        PREVIEW_VPS_HOST_KEY: 'host-key',
        PREVIEW_VPS_SSH_PRIVATE_KEY: 'private-key',
        PREVIEW_REDIS_NETWORK_NAME: 'mahoshojo-redis',
        PREVIEW_REDIS_KEY_PREFIX: 'preview',
        PREVIEW_DATA_ENVIRONMENT: 'shared-production',
        PREVIEW_REDIS_ISOLATION: 'prefix',
        PREVIEW_ENV_FILE_PATH: '/opt/mahoshojo-hono-preview/.env.hono',
      },
      requireProvisioned: true,
      workflow,
      wrangler,
    })).toEqual([]);
  });
});
