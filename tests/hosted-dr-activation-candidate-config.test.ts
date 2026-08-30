import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'comment-json';
import { describe, expect, test } from 'vitest';

type WranglerEnvironment = {
  assets?: {
    binding?: string;
    directory?: string;
    run_worker_first?: boolean;
  };
  name?: string;
  main?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  vars?: Record<string, string>;
  services?: Array<{ binding?: string; service?: string }>;
  d1_databases?: Array<{
    binding?: string;
    database_id?: string;
    database_name?: string;
  }>;
  ratelimits?: Array<{ name?: string; namespace_id?: string }>;
};

type WranglerConfig = {
  main?: string;
  env?: Record<string, WranglerEnvironment>;
};

const wrangler = parse(
  readFileSync(path.join(process.cwd(), 'apps/web/wrangler.jsonc'), 'utf8'),
  undefined,
  true,
) as WranglerConfig;

describe('Hosted DR activation candidate Wrangler config', () => {
  test('使用独立 Worker、production D1 authority 与 readiness-only fail-closed 开关', () => {
    const production = wrangler.env?.production;
    const preview = wrangler.env?.preview;
    const candidate = wrangler.env?.['dr-candidate'];

    expect(candidate).toBeDefined();
    expect(candidate?.name).toBe('mahoshojo-next-dr-candidate');
    expect(candidate?.name).not.toBe(production?.name);
    expect(candidate?.name).not.toBe(preview?.name);
    expect(wrangler.main).toBe('.open-next/worker.js');
    expect(candidate?.main).toBe('activation-candidate-worker.ts');
    expect(candidate?.workers_dev).toBe(false);
    expect(candidate?.preview_urls).toBe(false);
    expect(candidate?.assets).toEqual({
      binding: 'ASSETS',
      directory: '.open-next/assets',
      run_worker_first: true,
    });
    expect(candidate?.vars).toEqual({
      HONO_CORS_ORIGINS: 'https://mahoshojo.colanns.me',
      HOSTED_DR_ACTIVATION_CANDIDATE: 'true',
      NEXT_PUBLIC_HOSTED_API_ENVIRONMENT: 'production',
    });
    expect(candidate?.services).toContainEqual({
      binding: 'WORKER_SELF_REFERENCE',
      service: candidate?.name,
    });
    expect(candidate?.d1_databases).toEqual(production?.d1_databases);

    const candidateEntry = readFileSync(
      path.join(process.cwd(), 'apps/web/activation-candidate-worker.ts'),
      'utf8',
    );
    expect(candidateEntry).toContain("from './.open-next/worker.js'");
    expect(candidateEntry).toContain('createHostedDrActivationCandidateWorker(openNextWorker)');
  });

  test('candidate rate-limit namespace 不复用 production 或 preview', () => {
    const environments = wrangler.env ?? {};
    const candidateIds = new Set(
      environments['dr-candidate']?.ratelimits?.map(({ namespace_id }) => namespace_id),
    );
    const existingIds = new Set([
      ...(environments.production?.ratelimits ?? []),
      ...(environments.preview?.ratelimits ?? []),
    ].map(({ namespace_id }) => namespace_id));

    expect(candidateIds.size).toBe(3);
    for (const id of candidateIds) {
      expect(id).toMatch(/^7320[1-3]$/u);
      expect(existingIds).not.toContain(id);
    }
  });
});
