import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  validateArenaRoomHardeningEvidence,
} from '../scripts/check-arena-room-hardening.mjs';

type Manifest = {
  drills: Array<{
    assertions: string[];
    command: string;
    id: string;
    owner: { kind: string; path: string; selector: string };
    recovery: { classification: string; expectation: string };
  }>;
  [key: string]: unknown;
};

const manifestPath = resolve(
  process.cwd(),
  'config/arena-room-hardening-evidence.json',
);

const loadManifest = (): Manifest => (
  JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
);

const cloneManifest = (): Manifest => structuredClone(loadManifest());

const createEvidenceRepository = (manifest: Manifest): string => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'arena-room-hardening-evidence.'));
  for (const drill of manifest.drills) {
    const ownerPath = join(repositoryRoot, drill.owner.path);
    mkdirSync(dirname(ownerPath), { recursive: true });
    const prior = (() => {
      try {
        return readFileSync(ownerPath, 'utf8');
      } catch {
        return '';
      }
    })();
    writeFileSync(ownerPath, `${prior}\n${drill.owner.selector}\n`);
  }
  return repositoryRoot;
};

describe('Arena Room GMR-10 hardening evidence manifest', () => {
  it('固定且恰好覆盖 ordered 10 drills，并能定位每个 owner selector', () => {
    const manifest = loadManifest();
    const repositoryRoot = process.cwd();

    expect(validateArenaRoomHardeningEvidence(manifest, { repositoryRoot })).toEqual([]);
    expect(manifest.drills.map((drill) => drill.id)).toEqual([
      'real_socket_disconnect',
      'host_refresh',
      'redis_unavailable',
      'hono_restart_redis_survivor',
      'exact_checkpoint_loss',
      'stale_orphan_directory',
      'generation_midflight_sigkill',
      'slow_consumer',
      'oversize_flood',
      'vps_unreachable',
    ]);
  });

  it('缺失、乱序、重复或额外 drill 一律 fail closed', () => {
    const canonical = loadManifest();
    const repositoryRoot = createEvidenceRepository(canonical);

    const missing = cloneManifest();
    missing.drills.pop();
    expect(validateArenaRoomHardeningEvidence(missing, { repositoryRoot }))
      .toContain('drills 必须按固定顺序恰好覆盖 10 个 GMR-10 场景');

    const reordered = cloneManifest();
    [reordered.drills[0], reordered.drills[1]] = [
      reordered.drills[1]!,
      reordered.drills[0]!,
    ];
    expect(validateArenaRoomHardeningEvidence(reordered, { repositoryRoot }))
      .toContain('drills 必须按固定顺序恰好覆盖 10 个 GMR-10 场景');

    const duplicate = cloneManifest();
    duplicate.drills[1]!.id = duplicate.drills[0]!.id;
    expect(validateArenaRoomHardeningEvidence(duplicate, { repositoryRoot }))
      .toContain('drills 必须按固定顺序恰好覆盖 10 个 GMR-10 场景');
  });

  it('owner 必须是仓库内固定路径，且 selector 必须真实存在', () => {
    const canonical = loadManifest();
    const repositoryRoot = createEvidenceRepository(canonical);

    const traversal = cloneManifest();
    traversal.drills[0]!.owner.path = '../outside.test.ts';
    expect(validateArenaRoomHardeningEvidence(traversal, { repositoryRoot }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/real_socket_disconnect.*owner contract/u),
      ]));

    const missingSelector = cloneManifest();
    missingSelector.drills[1]!.owner.selector = 'selector-that-does-not-exist';
    expect(validateArenaRoomHardeningEvidence(missingSelector, { repositoryRoot }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/host_refresh.*owner contract/u),
        expect.stringMatching(/host_refresh.*selector/u),
      ]));

    const absentRepository = mkdtempSync(join(tmpdir(), 'arena-room-hardening-empty.'));
    expect(validateArenaRoomHardeningEvidence(canonical, {
      repositoryRoot: absentRepository,
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/owner path 不存在/u),
    ]));
  });

  it('command 只接受固定 allowlist，并拒绝 FLUSH、默认 prefix 与 credential', () => {
    const canonical = loadManifest();
    const repositoryRoot = createEvidenceRepository(canonical);

    const flush = cloneManifest();
    flush.drills[2]!.command = 'redis-cli FLUSHALL';
    expect(validateArenaRoomHardeningEvidence(flush, { repositoryRoot }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/redis_unavailable.*command allowlist/u),
        expect.stringMatching(/FLUSH/u),
      ]));

    const defaultPrefix = cloneManifest();
    defaultPrefix.drills[2]!.command = canonical.drills[2]!.command
      .replace('gmr10_unavailable', 'gmr02');
    expect(validateArenaRoomHardeningEvidence(defaultPrefix, { repositoryRoot }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/默认或生产 namespace/u),
      ]));

    const credential = cloneManifest();
    credential.drills[0]!.assertions.push('Authorization: Bearer secret-token');
    expect(validateArenaRoomHardeningEvidence(credential, { repositoryRoot }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/credential\/private key/u),
      ]));
  });

  it('production、清理、secret 与 recovery 保护性终点不可降级', () => {
    const canonical = loadManifest();
    const repositoryRoot = createEvidenceRepository(canonical);

    const production = cloneManifest();
    production.productionExecution = 'ENABLED';
    expect(validateArenaRoomHardeningEvidence(production, { repositoryRoot }))
      .toContain('productionExecution 必须保持 DEFERRED');

    const cleanup = cloneManifest();
    cleanup.cleanupPolicy = 'flush-database';
    expect(validateArenaRoomHardeningEvidence(cleanup, { repositoryRoot }))
      .toContain('cleanupPolicy 必须是 exact-isolated-prefix-only');

    const recovery = cloneManifest();
    recovery.drills[4]!.recovery.classification = 'recoverable';
    expect(validateArenaRoomHardeningEvidence(recovery, { repositoryRoot }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/exact_checkpoint_loss.*recovery contract/u),
      ]));
  });
});
