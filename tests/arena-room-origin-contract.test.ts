import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Target = {
  allowedWebOrigins: string[];
};

describe('Arena Room ingress policy contract', () => {
  const manifest = JSON.parse(readFileSync(
    resolve(process.cwd(), 'config/arena-room-origins.json'),
    'utf8',
  )) as {
    authority: string;
    cloudflareDr: string;
    targets: { production: Target; preview: Target };
  };

  it('只保留 caller-origin policy，Room service origin 复用 Hosted Hono ingress', () => {
    const hostedDr = JSON.parse(readFileSync(
      resolve(process.cwd(), 'config/hosted-dr-capabilities.json'),
      'utf8',
    )) as {
      controlPlane: {
        primaryOrigin: string;
        previewOrigin: string;
        stableOrigin: string;
      };
    };

    expect(manifest.authority).toBe('hono-redis-single-writer');
    expect(manifest.cloudflareDr).toBe('excluded');
    for (const origin of [
      hostedDr.controlPlane.primaryOrigin,
      hostedDr.controlPlane.previewOrigin,
    ]) {
      const parsed = new URL(origin);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.origin).toBe(origin);
    }
    expect(hostedDr.controlPlane.primaryOrigin).not.toBe(hostedDr.controlPlane.stableOrigin);
    expect(Object.keys(manifest.targets.production)).toEqual(['allowedWebOrigins']);
    expect(Object.keys(manifest.targets.preview)).toEqual(['allowedWebOrigins']);
    expect(JSON.stringify(manifest)).not.toContain('logicalOrigin');
    expect(JSON.stringify(manifest)).not.toContain('provisioning');
  });

  it('验证 caller-origin policy 且不再生成 Room service-origin client projection', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/check-arena-room-origin-policy.mjs'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(resolve(
      process.cwd(),
      'apps/web/config/arena-room-origins.generated.ts',
    ))).toBe(false);
    expect(existsSync(resolve(
      process.cwd(),
      'scripts/generate-arena-room-client-config.mjs',
    ))).toBe(false);
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
