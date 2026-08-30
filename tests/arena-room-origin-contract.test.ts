import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Target = {
  logicalOrigin: string;
  provisioning: 'not-provisioned' | 'provisioned';
  allowedWebOrigins: string[];
};

describe('Arena Room logical-origin contract', () => {
  const manifest = JSON.parse(readFileSync(
    resolve(process.cwd(), 'config/arena-room-origins.json'),
    'utf8',
  )) as {
    authority: string;
    cloudflareDr: string;
    targets: { production: Target; preview: Target };
  };

  it('keeps Room authority outside Hosted DR while provisioning preview independently', () => {
    const hostedDr = JSON.parse(readFileSync(
      resolve(process.cwd(), 'config/hosted-dr-capabilities.json'),
      'utf8',
    )) as { controlPlane: { provisioning: string } };

    expect(manifest.authority).toBe('hono-redis-single-writer');
    expect(manifest.cloudflareDr).toBe('excluded');
    expect(hostedDr.controlPlane.provisioning).toBe('not-provisioned');
    expect(manifest.targets.production).toMatchObject({
      logicalOrigin: 'https://api.mahoshojo.colanns.me',
      provisioning: 'not-provisioned',
    });
    expect(manifest.targets.preview).toMatchObject({
      logicalOrigin: 'https://homura-preview.colanns.me',
      provisioning: 'provisioned',
    });
  });

  it('projects only client-safe Room origin state without drift', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/generate-arena-room-client-config.mjs'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const generated = readFileSync(
      resolve(process.cwd(), 'apps/web/config/arena-room-origins.generated.ts'),
      'utf8',
    );
    expect(generated).toContain(manifest.targets.preview.logicalOrigin);
    expect(generated).not.toContain('allowedWebOrigins');
    expect(generated).not.toContain('cloudflareDr');
  });

  it('uses exact Preview Web origins and covers workers.dev in Hono CORS', () => {
    const deployScript = readFileSync(
      resolve(process.cwd(), 'apps/api/deploy/deploy-bundle.sh'),
      'utf8',
    );
    const previewWorkflow = readFileSync(
      resolve(process.cwd(), '.github/workflows/preview-deploy.yml'),
      'utf8',
    );
    for (const origin of manifest.targets.preview.allowedWebOrigins) {
      expect(deployScript).toContain(origin === 'https://maho-preview.colanns.me'
        ? "preview_cors_origin='https://*.colanns.me'"
        : origin);
      expect(previewWorkflow).toContain(origin);
    }
    expect(manifest.targets.preview.allowedWebOrigins).toContain(
      'https://mahoshojo-next-preview.719147538.workers.dev',
    );
    expect(previewWorkflow).toContain('PREVIEW_ARENA_ROOM_WRITER_ACTIVATION: enabled');
    expect(previewWorkflow).toContain('scripts/prepare-arena-room-release-gate.mjs');
    expect(previewWorkflow).toContain('for room_web_origin in "${room_web_origins[@]}"');
    expect(previewWorkflow).toContain('Access-Control-Allow-Origin: $room_web_origin');
    expect(deployScript).toContain(
      'validate_arena_room_runtime_allowed_origins "$release_dir"',
    );
    expect(deployScript).toContain(
      'ARENA_ROOM_ALLOWED_ORIGINS 与 target exact-set 不一致',
    );
    expect(deployScript).toContain('for room_probe_origin in $room_probe_origins');
    expect(deployScript).toContain('production|preview) ;;');
    expect(deployScript).toContain('显式 rollback 只允许 production/preview target');
  });
});
