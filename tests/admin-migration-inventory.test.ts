import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const rootDirectory = path.resolve(import.meta.dirname, '..');
const inventoryPath = path.join(rootDirectory, 'config/admin-migration-inventory.json');
const generatorPath = path.join(rootDirectory, 'scripts/generate-admin-migration-inventory.mjs');

const REQUIRED_ASSET_FIELDS = [
  'sourceRef',
  'sourcePath',
  'sourceKind',
  'businessDomain',
  'dataTouched',
  'riskClass',
  'legacyTrustAssumptions',
  'disposition',
  'newDestination',
  'currentOwner',
  'apiOrServiceContract',
  'requiredCapability',
  'auditRequirement',
  'concurrencyOrIdempotency',
  'migrationRequirement',
  'testEvidence',
  'rollback',
  'status',
  'notes',
] as const;

type InventoryAsset = Record<(typeof REQUIRED_ASSET_FIELDS)[number], unknown> & {
  changeStatus: string;
};

type Inventory = {
  schemaVersion: string;
  sourceBranch: string;
  sourceCommit: string;
  sourceBaseCommit: string;
  generatedBy: string;
  generatorSha256: string;
  assets: InventoryAsset[];
  summary: {
    totalAssets: number;
    unclassifiedAssets: number;
    sourcePathsSha256: string;
    assetsSha256: string;
    byRiskClass: Record<string, number>;
    byDisposition: Record<string, number>;
  };
};

const readInventory = (): Inventory | null => {
  if (!existsSync(inventoryPath)) return null;
  return JSON.parse(readFileSync(inventoryPath, 'utf8')) as Inventory;
};

const changedPaths = (baseCommit: string, sourceCommit: string): string[] => {
  const result = spawnSync('git', ['diff', '--name-only', '-z', `${baseCommit}..${sourceCommit}`], {
    cwd: rootDirectory,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  const output = result.stdout;
  return output.split('\0').filter(Boolean).sort();
};

const hasGitObject = (object: string): boolean => spawnSync('git', ['cat-file', '-e', object], {
  cwd: rootDirectory,
}).status === 0;

const sourcePathsSha256 = (sourcePaths: string[]): string => createHash('sha256')
  .update(`${sourcePaths.join('\n')}\n`)
  .digest('hex');

const assetsSha256 = (assets: InventoryAsset[]): string => createHash('sha256')
  .update(JSON.stringify(assets))
  .digest('hex');

const countBy = (assets: InventoryAsset[], field: keyof InventoryAsset): Record<string, number> => (
  Object.fromEntries([...new Set(assets.map((asset) => String(asset[field])))]
    .sort()
    .map((value) => [value, assets.filter((asset) => String(asset[field]) === value).length]))
);

const hasMeaningfulValue = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(hasMeaningfulValue);
  return value !== null && value !== undefined;
};

describe('Admin migration inventory', () => {
  test('生成器与机器清单已经纳入仓库', () => {
    expect(existsSync(generatorPath)).toBe(true);
    expect(existsSync(inventoryPath)).toBe(true);
  });

  test('逐文件覆盖固定 feat/admin source snapshot 且没有未分类项', () => {
    const inventory = readInventory();
    expect(inventory).not.toBeNull();
    if (!inventory) return;

    expect(inventory.schemaVersion).toBe('admin-migration-inventory-v1');
    expect(inventory.sourceBranch).toBe('feat/admin');
    expect(inventory.sourceCommit).toBe('73cbc27c1aa5c339486d14831e861a28ba21ab39');
    expect(inventory.sourceBaseCommit).toBe('536c866fd005c69b21fa6d8f6a97e75e471524a1');
    expect(inventory.generatedBy).toBe('scripts/generate-admin-migration-inventory.mjs');
    const currentGeneratorSha256 = createHash('sha256')
      .update(readFileSync(generatorPath))
      .digest('hex');
    expect(currentGeneratorSha256).toBe('9a66271910585ca1073b423aadea7610b544111d8c3a472850c5c132db7ba791');
    expect(inventory.generatorSha256).toBe('9a66271910585ca1073b423aadea7610b544111d8c3a472850c5c132db7ba791');

    const sourcePaths = inventory.assets.map((asset) => asset.sourcePath).sort();
    if (hasGitObject(inventory.sourceBaseCommit) && hasGitObject(inventory.sourceCommit)) {
      expect(sourcePaths).toEqual(changedPaths(inventory.sourceBaseCommit, inventory.sourceCommit));
    }
    expect(sourcePathsSha256(sourcePaths)).toBe('d76c7a4c150e6839f5bb718e66210ccf52d167fcdb02812f5b94de8e9f44161f');
    expect(inventory.summary.sourcePathsSha256).toBe('d76c7a4c150e6839f5bb718e66210ccf52d167fcdb02812f5b94de8e9f44161f');
    expect(assetsSha256(inventory.assets)).toBe('fcd6e3cce511e25e762b5f556ee7f57b8da43c37b96d953827b9b71f5dc1c3f2');
    expect(inventory.summary.assetsSha256).toBe('fcd6e3cce511e25e762b5f556ee7f57b8da43c37b96d953827b9b71f5dc1c3f2');
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
    expect(inventory.summary.totalAssets).toBe(sourcePaths.length);
    expect(inventory.summary.unclassifiedAssets).toBe(0);
    expect(inventory.summary.byRiskClass).toEqual(countBy(inventory.assets, 'riskClass'));
    expect(inventory.summary.byDisposition).toEqual(countBy(inventory.assets, 'disposition'));
  });

  test('本地具有旧 snapshot object 时生成器输出不得漂移', () => {
    const inventory = readInventory();
    expect(inventory).not.toBeNull();
    if (!inventory || !hasGitObject(inventory.sourceBaseCommit) || !hasGitObject(inventory.sourceCommit)) return;

    const result = spawnSync(process.execPath, [generatorPath, '--check'], {
      cwd: rootDirectory,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.error?.message).toBe(0);
  });

  test('每项都具有可审查的风险、信任、owner、验证与回滚映射', () => {
    const inventory = readInventory();
    expect(inventory).not.toBeNull();
    if (!inventory) return;

    const allowedRiskClasses = new Set([
      'R0 read-only',
      'R1 mutating',
      'R2 privileged',
      'R3 destructive/export/maintenance/config',
    ]);
    const allowedDispositions = new Set(['keep', 'adapt', 'rewrite', 'drop', 'defer']);

    for (const asset of inventory.assets) {
      for (const field of REQUIRED_ASSET_FIELDS) {
        expect(hasMeaningfulValue(asset[field]), `${asset.sourcePath}: ${field}`).toBe(true);
      }
      expect(allowedRiskClasses.has(String(asset.riskClass)), asset.sourcePath).toBe(true);
      expect(allowedDispositions.has(String(asset.disposition)), asset.sourcePath).toBe(true);
      expect(['A', 'M', 'D'].includes(asset.changeStatus), asset.sourcePath).toBe(true);
      expect(asset.sourceKind, asset.sourcePath).not.toBe('unclassified');
      expect(asset.businessDomain, asset.sourcePath).not.toBe('unclassified');
      expect(String(asset.currentOwner), asset.sourcePath).not.toContain('resolved per-file before migration');
    }

    const highRiskAssets = inventory.assets.filter((asset) => asset.riskClass !== 'R0 read-only');
    expect(highRiskAssets.length).toBeGreaterThan(0);
    for (const asset of highRiskAssets) {
      expect((asset.legacyTrustAssumptions as unknown[]).length, asset.sourcePath).toBeGreaterThan(1);
      expect(String(asset.auditRequirement), asset.sourcePath).not.toContain('not required');
      expect(String(asset.concurrencyOrIdempotency), asset.sourcePath).not.toContain('not applicable');
    }

    expect(inventory.assets.some((asset) => asset.sourceKind === 'table')).toBe(true);
    expect(inventory.assets.some((asset) => asset.sourceKind === 'job')).toBe(true);
    expect(inventory.assets.some((asset) => asset.sourceKind === 'handler')).toBe(true);
    expect(inventory.assets.some((asset) => asset.sourceKind === 'test')).toBe(true);
    expect(inventory.assets.some((asset) => asset.disposition === 'drop')).toBe(true);
    expect(inventory.assets.some((asset) => asset.disposition === 'defer')).toBe(true);

    for (const domain of ['dashboard', 'user-analytics', 'ai-governance', 'arena-ratings', 'data-maintenance']) {
      for (const asset of inventory.assets.filter((candidate) => candidate.businessDomain === domain)) {
        expect(String(asset.currentOwner), asset.sourcePath).toMatch(/(?:apps|packages)\//);
      }
    }
  });

  test('已审查的 export、write、Legacy auth 资产保持高后果语义', () => {
    const inventory = readInventory();
    expect(inventory).not.toBeNull();
    if (!inventory) return;
    const asset = (sourcePath: string) => {
      const found = inventory.assets.find((candidate) => candidate.sourcePath === sourcePath);
      expect(found, sourcePath).toBeDefined();
      return found as InventoryAsset;
    };

    expect(asset('app/api/redeem-code/handler.ts').sourceKind).toBe('handler');
    expect(asset('components/creation/api/admin/export-data-cards.ts')).toMatchObject({
      riskClass: 'R3 destructive/export/maintenance/config',
      requiredCapability: 'exports.read',
    });
    expect(asset('lib/admin/crowd-review.ts').riskClass).toBe('R2 privileged');
    expect(asset('lib/admin/report-cases.ts').riskClass).toBe('R2 privileged');
    expect(asset('lib/db/repositories/crowd-review.ts').riskClass).toBe('R2 privileged');
    expect(asset('lib/r2.ts')).toMatchObject({
      riskClass: 'R3 destructive/export/maintenance/config',
      requiredCapability: 'data.maintenance',
    });
    for (const pvpAsset of inventory.assets.filter((candidate) => candidate.businessDomain === 'pvp')) {
      expect(String(pvpAsset.currentOwner), pvpAsset.sourcePath).not.toContain('packages/contracts/src/arena-room.ts');
      expect(String(pvpAsset.currentOwner), pvpAsset.sourcePath).toContain('Arena Room authority/wire remains a separate domain');
    }

    const maintenanceTrust = asset('components/creation/api/admin/data-maintenance/execute.ts')
      .legacyTrustAssumptions as string[];
    expect(maintenanceTrust.join('\n')).toContain('missing or invalid bearer silently became null');
    expect(maintenanceTrust.join('\n')).toContain('Better Auth application sessions');
  });
});
