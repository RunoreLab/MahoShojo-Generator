import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BattleSettingsSchema } from '@/components/arena/utils/schemas';

const settings = {
  readArenaHistory: false,
  readArenaHistoryLimit: 10,
  isArenaHistoryUnlimited: false,
  writeArenaHistory: false,
  readCurrentState: false,
  writeCurrentState: false,
  readNarrativeHistory: false,
  readNarrativeHistoryLimit: 10,
  isNarrativeHistoryUnlimited: false,
  writeNarrativeHistory: false,
};

describe('Arena resumable stream transport cutover', () => {
  it('migrates the removed non-resumable plain-stream preference to SSE', () => {
    expect(BattleSettingsSchema.parse({
      ...settings,
      streamTransport: 'plain-stream',
    }).streamTransport).toBe('sse');
  });

  it('keeps the Next disaster-recovery adapter from creating process-local active lifecycle', () => {
    const runtimeSource = readFileSync('app/api/arena/generation-runtime.ts', 'utf8');

    expect(runtimeSource).toContain('createUnavailableGenerationReplayStore');
    expect(runtimeSource).not.toContain('createMemoryGenerationReplayStore');
  });

  it('keeps Next generate-stream methods aligned with the Hono POST/DELETE adapter', () => {
    const routeSource = readFileSync('app/api/arena/generate-stream/route.ts', 'utf8');

    expect(routeSource).toContain('export const POST');
    expect(routeSource).toContain('export const DELETE');
    expect(routeSource).not.toMatch(/export const (?:GET|HEAD|OPTIONS|PUT|PATCH)/u);
  });

  it('preserves nested battle-story generation identity, SSE ids and base revision fencing', () => {
    const proxySource = readFileSync('app/api/arena/session/generate-next/handler.ts', 'utf8');
    const serviceSource = readFileSync('../../packages/hosted-runtime/src/arena-companion/session.ts', 'utf8');
    const hookSource = readFileSync('components/arena/hooks/useBattleStorySession.ts', 'utf8');

    expect(proxySource).toContain('getCloudflareDrArenaCompanionService');
    expect(serviceSource).toContain('generationRequestId: payload.generationRequestId');
    expect(serviceSource).toContain('encodeGenerationSseEvent(event)');
    expect(serviceSource).not.toContain('parseGenerationSseBlock');
    expect(serviceSource).not.toMatch(/\bfetch\s*\(/u);
    expect(hookSource).toContain('baseRevisionHash');
    expect(hookSource).toContain('generationRequestId: crypto.randomUUID()');
  });

  it('reuses create authentication semantics for every local-card reconciliation request', () => {
    const updaterSource = readFileSync('components/arena/hooks/useStreamCombatantUpdater.ts', 'utf8');
    const storySessionSource = readFileSync('components/arena/hooks/useBattleStorySession.ts', 'utf8');

    expect(updaterSource).toContain('buildGenerationApiHeaders');
    expect(updaterSource).toContain('authStorage');
    expect(updaterSource).toMatch(
      /withArenaGenerationActorToken\(await buildGenerationApiHeaders\([\s\S]*?authStorage/u,
    );
    expect(storySessionSource).toContain(
      'withArenaGenerationActorToken(await buildRequestHeaders(false))',
    );
  });
});
