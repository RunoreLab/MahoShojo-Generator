import { describe, expect, it } from 'vitest';

import {
  ArenaReportFormatSchema,
  ArenaRoomGenerationResultSchema,
  ArenaRoomSharedConfigSchema,
  ArenaRoomSnapshotSchema,
} from '../src/arena-room';
import { BattleReportRenderSnapshotV1Schema } from '../src/battle-report-render-snapshot';
import legacySnapshot from './fixtures/arena-room-v1.json';

describe('Arena Web report compatibility', () => {
  const packageRef = { id: 'runorelab.visual-novel-lite', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` };
  const webPackage = {
    packageRef, targetPath: 'data/report.json', targetMediaType: 'application/json',
    generatedDigest: `sha256:${'b'.repeat(64)}`,
  };

  it('keeps Package identity in Web config and persisted artifacts, never Markdown', () => {
    expect(ArenaRoomSharedConfigSchema.parse({
      ...legacySnapshot.sharedConfig, reportFormat: 'web', webPackageRef: packageRef,
    }).webPackageRef).toEqual(packageRef);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...legacySnapshot.sharedConfig, webPackageRef: packageRef,
    }).success).toBe(false);
    expect(BattleReportRenderSnapshotV1Schema.parse({ version: 1, reportFormat: 'web', webPackage }).webPackage)
      .toEqual(webPackage);
    expect(BattleReportRenderSnapshotV1Schema.safeParse({ version: 1, webPackage }).success).toBe(false);
    expect(ArenaRoomGenerationResultSchema.parse({ version: 1, format: 'stream-web', mode: 'classic', webPackage }).webPackage)
      .toEqual(webPackage);
    expect(ArenaRoomGenerationResultSchema.safeParse({ version: 1, format: 'stream-markdown', mode: 'classic', webPackage }).success)
      .toBe(false);
  });

  it('normalizes old room fixtures to Markdown without mutating input', () => {
    const snapshot = ArenaRoomSnapshotSchema.parse(legacySnapshot);
    expect(snapshot.sharedConfig.reportFormat).toBe('markdown');
    expect(legacySnapshot.sharedConfig).not.toHaveProperty('reportFormat');
    expect(ArenaRoomSharedConfigSchema.parse({
      ...legacySnapshot.sharedConfig, reportFormat: 'web',
    }).reportFormat).toBe('web');
  });

  it('accepts only explicit supported formats and keeps consent out of shared config', () => {
    expect(ArenaReportFormatSchema.options).toEqual(['markdown', 'web']);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...legacySnapshot.sharedConfig, reportFormat: 'html',
    }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...legacySnapshot.sharedConfig, webReportConsent: true,
    }).success).toBe(false);
  });

  it.each(['stream-markdown', 'stream-web'])('accepts %s authoritative results', (format) => {
    expect(ArenaRoomGenerationResultSchema.parse({ version: 1, format, mode: 'classic' }).format)
      .toBe(format);
  });

  it('persists Web render semantics without changing old render snapshots', () => {
    expect(BattleReportRenderSnapshotV1Schema.parse({ version: 1 })).toEqual({ version: 1 });
    expect(BattleReportRenderSnapshotV1Schema.parse({ version: 1, reportFormat: 'web' }))
      .toEqual({ version: 1, reportFormat: 'web' });
  });
});
