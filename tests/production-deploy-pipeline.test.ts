import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const honoWorkflowPath = resolve(process.cwd(), '.github/workflows/hono-deploy.yml');
const cloudflareWorkflowPath = resolve(
  process.cwd(),
  '.github/workflows/cloudflare-deploy.yml',
);

describe('production deployment pipeline', () => {
  it('uses one default-branch push pipeline ordered Hono then Cloudflare', () => {
    const honoWorkflow = readFileSync(honoWorkflowPath, 'utf8');
    const cloudflareWorkflow = readFileSync(cloudflareWorkflowPath, 'utf8');

    expect(honoWorkflow).toContain('- feature/v0.2.0_Battle_Growth_MahoShojo');
    expect(honoWorkflow).toMatch(
      /deploy:\s*[\s\S]*?needs: build[\s\S]*?if: github\.ref == 'refs\/heads\/feature\/v0\.2\.0_Battle_Growth_MahoShojo'/u,
    );
    expect(honoWorkflow).toContain(
      "arena_multiplayer_enabled: ${{ github.event_name == 'workflow_dispatch' && inputs.arena_multiplayer == 'enabled' }}",
    );
    expect(honoWorkflow).toMatch(
      /deploy-cloudflare:\s*[\s\S]*?needs: deploy[\s\S]*?uses: \.\/\.github\/workflows\/cloudflare-deploy\.yml/u,
    );
    expect(honoWorkflow).toContain('secrets: inherit');
    expect(honoWorkflow).toContain('--writer "$writer_activation"');
    expect(honoWorkflow).not.toContain('--writer enabled');

    expect(cloudflareWorkflow).toMatch(/workflow_call:/u);
    expect(cloudflareWorkflow).not.toMatch(/^\s+push:/mu);
    expect(cloudflareWorkflow).toContain('group: cloudflare-production');
    expect(cloudflareWorkflow).toContain('cancel-in-progress: false');
    expect(cloudflareWorkflow).toContain('confirm_disable_multiplayer:');
    expect(cloudflareWorkflow).toContain("inputs.arena_multiplayer_enabled && 'true' || 'false'");
  });

  it('keeps only the public multiplayer flag in the Web build contract', () => {
    const honoWorkflow = readFileSync(honoWorkflowPath, 'utf8');
    const cloudflareWorkflow = readFileSync(cloudflareWorkflowPath, 'utf8');
    const combined = `${honoWorkflow}\n${cloudflareWorkflow}`;

    expect(cloudflareWorkflow).toContain('NEXT_PUBLIC_ARENA_MULTIPLAYER_ENABLED');
    expect(combined).not.toContain('NEXT_PUBLIC_ARENA_ROOM_WRITER_ACTIVATION');
    expect(combined).not.toContain('NEXT_PUBLIC_ARENA_ROOM_READER_CONTRACT');
    expect(combined).not.toContain('NEXT_PUBLIC_ARENA_ROOM_GO_NO_GO');
    expect(combined).not.toContain('ARENA_ROOM_PRODUCTION_GO_NO_GO');
  });
});
