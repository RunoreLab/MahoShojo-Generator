import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const source = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-story-pending-content.json', import.meta.url), 'utf8')) as { cases: ContentCase[] };
const storage = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-story-pending-storage.json', import.meta.url), 'utf8'));
import { buildCompletedBattleStoryRecords, freezeBattleStoryCommit, projectHostedStoryPendingContent, type HostedStoryPendingContentInput } from '@mahoshojo/domain/arena-story-commit';
import { prepareStoryStorageCommit } from '../src/platform/arena-story-storage';

type ContentCase = {
  name: string;
  originals: {
    input: { userGuidance?: string; chapterContext: { workingCombatants: object[] } };
    markdown: string; reasoning: string;
    meta?: HostedStoryPendingContentInput['meta']; header?: HostedStoryPendingContentInput['header'];
    roleResponse?: HostedStoryPendingContentInput['roleResponse'];
  };
  roleState: HostedStoryPendingContentInput['roleState'];
  fallbackReason?: HostedStoryPendingContentInput['fallbackReason'];
  assembly: Omit<Parameters<typeof buildCompletedBattleStoryRecords>[0], 'action' | 'inputCombatants'>;
  expected: unknown;
};

describe('shared Hosted pending content to real Native storage wire', () => {
  it.each(source.cases)('$name uses the actual shared assembler and original-byte storage preflight', async (fixture) => {
    const original = fixture.originals;
    const projection = projectHostedStoryPendingContent({
      inputUserGuidance: original.input.userGuidance, reasoning: original.reasoning,
      meta: 'meta' in original ? original.meta : undefined, header: 'header' in original ? original.header : undefined,
      roleResponse: 'roleResponse' in original ? original.roleResponse : undefined,
      workingCombatants: original.input.chapterContext.workingCombatants, roleState: fixture.roleState,
      fallbackReason: 'fallbackReason' in fixture ? fixture.fallbackReason : undefined,
    } as HostedStoryPendingContentInput);
    const records = freezeBattleStoryCommit(buildCompletedBattleStoryRecords({ ...fixture.assembly, action: 'start',
      inputCombatants: original.input.chapterContext.workingCombatants,
      generated: { ...fixture.assembly.generated, markdown: original.markdown, ...projection },
    }));
    expect(records).toEqual(fixture.expected);
    const prepared = await prepareStoryStorageCommit({ ...records, expectedRevision: 0, expectedLastChapterId: null });
    const expected = storage.cases.find((item: { name: string }) => item.name === fixture.name)!;
    expect(prepared.manifest).toEqual(expected.manifest);
    expect(prepared.wireDigest).toBe(expected.wireDigest);
    expect(prepared.parts.map(({ kind, prepared }) => {
      const decoder = new TextDecoder();
      let document = '';
      for (const bytes of prepared.chunks()) document += decoder.decode(bytes, { stream: true });
      document += decoder.decode();
      return { kind, document };
    })).toEqual(expected.parts);
  });
});
