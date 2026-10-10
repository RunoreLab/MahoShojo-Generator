import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCompletedBattleStoryRecords, digestBattleStoryCommitValue,
  encodeHostedStoryClientBodyIntent, digestHostedStoryClientBodyIntent,
  projectHostedStoryPendingContent,
  type BuildCompletedBattleStoryRecordsInput, type HostedStoryPendingContentInput,
} from '@mahoshojo/domain/arena-story-commit';
import { DesktopArenaHostedStoryClientBodyIntentSchema } from '@mahoshojo/contracts/desktop-arena-story-transport';
import {
  StoryPendingInputSchema, StoryPendingTelemetrySchema,
  type StoryCommitManifest, type StoryPendingInput,
} from '@mahoshojo/contracts/desktop-arena-story';
import { prepareStoryStorageCommit, storyWireDigest } from '../src/platform/arena-story-storage';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

interface WireGolden {
  name: string;
  manifest: StoryCommitManifest;
  wireDigest: string;
  parts: Array<{ kind: string; document: string }>;
}
interface ContentGolden extends WireGolden {
  originals: Pick<HostedStoryPendingContentInput, 'header' | 'meta' | 'roleResponse' | 'telemetry' | 'reasoning'> & {
    input: StoryPendingInput; markdown: string;
  };
  roleState: HostedStoryPendingContentInput['roleState'];
  fallbackReason?: HostedStoryPendingContentInput['fallbackReason'];
  assembly: Omit<BuildCompletedBattleStoryRecordsInput, 'action' | 'inputCombatants' | 'generated'> & {
    generated: Pick<BuildCompletedBattleStoryRecordsInput['generated'], 'chapterIndex' | 'digest' | 'generationId'>;
  };
  expected: unknown;
}

// Cross-runtime golden files remain canonical data owned by contracts. Integration
// tests read the bytes; no shared package imports another package's private module.
const intentGolden = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-story-client-body-intent.json', import.meta.url), 'utf8')) as {
  cases: Array<{ name: string; input: unknown; encodedHex: string; clientBodyHash: string }>;
};
const telemetryGolden = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-story-pending-telemetry.json', import.meta.url), 'utf8')) as { cases: ContentGolden[] };
const storageGolden = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-story-pending-storage.json', import.meta.url), 'utf8')) as { cases: WireGolden[] };

describe('Hosted story cross-runtime contract goldens', () => {
  it.each(intentGolden.cases)('matches narrow intent binary and SHA-256: $name', (fixture) => {
    const input = DesktopArenaHostedStoryClientBodyIntentSchema.parse(fixture.input);
    expect(Buffer.from(encodeHostedStoryClientBodyIntent(input)).toString('hex')).toBe(fixture.encodedHex);
    expect(digestHostedStoryClientBodyIntent(input)).toBe(fixture.clientBodyHash);
  });

  it.each([...storageGolden.cases, ...telemetryGolden.cases])('matches the actual Desktop/Native wire digest for old and new golden: $name', async (fixture) => {
    expect(await storyWireDigest(fixture.manifest)).toBe(fixture.wireDigest);
    // Existing arena-story-wire-v1\n domain separator is mandatory; never replace
    // this with the ordinary sorted-JSON value digest used for individual parts.
    expect(digestBattleStoryCommitValue(fixture.manifest)).not.toBe(fixture.wireDigest);
  });

  it.each(telemetryGolden.cases)('retains original content through shared assembler and actual Desktop storage wire: $name', async (fixture) => {
    const original = fixture.originals;
    expect(StoryPendingInputSchema.parse(original.input)).toEqual(original.input);
    expect(StoryPendingTelemetrySchema.parse(original.telemetry)).toEqual(original.telemetry);
    const workingCombatants = original.input.chapterContext.workingCombatants.map((value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Golden combatant must be an object');
      return value;
    });
    const input: HostedStoryPendingContentInput = {
      ...original, inputUserGuidance: original.input.userGuidance,
      workingCombatants,
      roleState: fixture.roleState, fallbackReason: fixture.fallbackReason,
    };
    const before = structuredClone(input);
    const projected = projectHostedStoryPendingContent(input);
    const completed = buildCompletedBattleStoryRecords({
      ...fixture.assembly, action: 'start', inputCombatants: [...input.workingCombatants],
      generated: { ...fixture.assembly.generated, markdown: original.markdown, ...projected },
    });
    expect(completed).toEqual(fixture.expected);
    expect(input).toEqual(before);
    const commit = await prepareStoryStorageCommit({ ...completed,
      expectedRevision: fixture.manifest.expectedRevision, expectedLastChapterId: fixture.manifest.expectedLastChapterId });
    expect(commit.manifest).toEqual(fixture.manifest);
    expect(commit.wireDigest).toBe(fixture.wireDigest);
    for (const [index, part] of fixture.parts.entries()) {
      const declared = fixture.manifest.parts[index];
      const actual = commit.parts[index];
      const bytes = Buffer.concat([...actual.prepared.chunks()]);
      expect(actual.kind).toBe(part.kind);
      expect(bytes.toString('utf8')).toBe(part.document);
      expect(bytes.byteLength).toBe(declared.byteLength);
      expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(declared.digest);
      expect(digestBattleStoryCommitValue(JSON.parse(part.document))).toBe(declared.digest);
    }
  });
});
