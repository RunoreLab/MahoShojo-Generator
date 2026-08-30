import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'comment-json';

const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/preview-deploy.yml');
const WRANGLER_PATH = resolve(process.cwd(), 'apps/web/wrangler.jsonc');
const ENVIRONMENT_PATH = resolve(process.cwd(), 'config/preview-environment.json');
const REDIS_RUNTIME_PATH = resolve(process.cwd(), 'apps/api/src/redis/runtime.ts');
const MIGRATION_SCRIPT_PATH = resolve(process.cwd(), 'scripts/d1-migrate-safe.mjs');

describe('preview deployment isolation contract', () => {
  test('preview has no production D1 binding while dedicated resources are not provisioned', () => {
    const wrangler = parse(readFileSync(WRANGLER_PATH, 'utf8'), undefined, true) as {
      env?: { preview?: { d1_databases?: unknown[] } };
    };
    const environment = JSON.parse(readFileSync(ENVIRONMENT_PATH, 'utf8')) as {
      status: string;
      activation: string;
      resources: Record<string, string>;
    };

    expect(wrangler.env?.preview?.d1_databases).toEqual([]);
    expect(environment).toMatchObject({
      status: 'not-provisioned',
      activation: 'fail-closed',
      resources: {
        d1: 'dedicated',
        redis: 'shared-prefix',
        r2: 'dedicated',
        secrets: 'impact-classified',
      },
    });
    expect(environment).toMatchObject({
      schemaGate: {
        source: 'config/hosted-dr-schema.json',
        physicalProbe: 'deferred',
        activationRequires: 'external-evidence',
      },
    });
  });

  test('preview workflow requires dedicated credentials/resources and never reuses production SSH/data inputs', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('PREVIEW_VPS_HOST');
    expect(workflow).toContain('PREVIEW_VPS_USER');
    expect(workflow).toContain('PREVIEW_VPS_SSH_PRIVATE_KEY');
    expect(workflow).toContain('PREVIEW_VPS_HOST_KEY');
    expect(workflow).toContain('PREVIEW_REDIS_NETWORK_NAME');
    expect(workflow).toContain('check:preview:environment -- --require-provisioned');
    expect(workflow).toContain('PREVIEW_D1_SCHEMA_EVIDENCE_PATH');
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

  test('preview migration 还必须在脚本内部验证专用 D1，不能只依赖 package wrapper', () => {
    const migration = readFileSync(MIGRATION_SCRIPT_PATH, 'utf8');

    expect(migration).toContain('assertPreviewD1Provisioned');
    expect(migration).toContain("options.env !== 'preview'");
    expect(migration).toContain("environment?.status !== 'provisioned'");
  });
});
