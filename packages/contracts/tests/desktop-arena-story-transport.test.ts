import { describe, expect, it } from 'vitest';
import {
  DesktopArenaHostedStoryCreateRequestSchema, DesktopArenaHostedStoryReconcileRequestSchema,
  DesktopArenaHostedStoryRecoveryPointerSchema,
} from '../src/desktop-arena-story-transport';
import { DesktopArenaHostedAnyRecoveryPointerSchema } from '../src/desktop-arena-hosted-json';
import { DesktopArenaHostedStreamRequestSchema } from '../src/desktop-arena-hosted';

const digest = `sha256:${'a'.repeat(64)}`;
const scope = { product: 'battle', requestId: 'story_request_1234', actor: { kind: 'anonymous' }, pendingRevision: 1, inputDigest: digest };
const create = { operation: 'create-story-stream', ...scope, clientBodyHash: 'b'.repeat(64) };
const reconcile = { operation: 'reconcile-story', ...scope, generationId: `arena_${'c'.repeat(64)}` };
const pointer = {
  version: 4, purpose: 'story', product: 'arena', requestId: scope.requestId, actor: scope.actor,
  protocolVersion: 'arena-hosted-sse-v1', storyProtocolVersion: 'arena-story-v1',
  sessionId: 'session', operationId: 'chapter', inputDigest: digest, bodyHash: create.clientBodyHash,
  delivery: 'stream', format: 'markdown', battleMode: 'daily', state: 'prepared', updatedAt: '2026-10-10T00:00:00Z',
};

describe('independent Hosted story transport', () => {
  it('accepts exact pending assertions for both product and actor kinds', () => {
    for (const product of ['battle', 'arena']) for (const actor of [{ kind: 'anonymous' }, { kind: 'account', expectedUserId: 7 }]) {
      const identity = { product, actor };
      for (const funding of [{}, { systemConfig: { modelId: 'default', generationOverrides: { temperature: 0 } } },
        { presetConfig: { providerId: 'deepseek', modelId: 'deepseek-v4-flash' } }]) {
        expect(DesktopArenaHostedStoryCreateRequestSchema.parse({ ...create, ...identity, ...funding })).toEqual({ ...create, ...identity, ...funding });
      }
      expect(DesktopArenaHostedStoryReconcileRequestSchema.parse({ ...reconcile, ...identity })).toEqual({ ...reconcile, ...identity });
    }
    expect(DesktopArenaHostedStreamRequestSchema.safeParse(create).success).toBe(false);
  });
  it('rejects request-supplied body, role originals, credentials, endpoints and model proof', () => {
    for (const key of ['body', 'combatants', 'url', 'headers', 'secretRef', 'providerKey', 'internalGuidance', 'createClaim', 'modelCompleted', 'notSent', 'retryAllowed']) {
      for (const [schema, value] of [[DesktopArenaHostedStoryCreateRequestSchema, create], [DesktopArenaHostedStoryReconcileRequestSchema, reconcile]] as const) {
        expect(schema.safeParse({ ...value, [key]: {} }).success, key).toBe(false);
      }
    }
    expect(DesktopArenaHostedStoryCreateRequestSchema.safeParse({ ...create, systemConfig: {}, presetConfig: { providerId: 'deepseek', modelId: 'model' } }).success).toBe(false);
    for (const patch of [{ pendingRevision: 0 }, { pendingRevision: 1.5 }, { inputDigest: '0'.repeat(64) }, { clientBodyHash: digest },
      { actor: { kind: 'account', expectedUserId: 0 } }, { systemConfig: { generationOverrides: { thinking: { mode: 'disabled', effort: 'high' } } } }]) {
      expect(DesktopArenaHostedStoryCreateRequestSchema.safeParse({ ...create, ...patch }).success).toBe(false);
    }
  });
  it('requires the independent v4 story discriminator and never upgrades a legacy pointer', () => {
    expect(DesktopArenaHostedStoryRecoveryPointerSchema.parse(pointer)).toEqual(pointer);
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.safeParse(pointer).success).toBe(false);
    for (const version of [1, 2, 3]) {
      expect(DesktopArenaHostedStoryRecoveryPointerSchema.safeParse({ ...pointer, version }).success).toBe(false);
    }
    for (const patch of [{ purpose: 'single' }, { delivery: 'non-stream' }, { format: 'web' }, { storyProtocolVersion: 'arena-story-v2' },
      { protocolVersion: 'arena-companion-v1' }, { inputDigest: 'a'.repeat(64) }, { sessionId: '../session' }]) {
      expect(DesktopArenaHostedStoryRecoveryPointerSchema.safeParse({ ...pointer, ...patch }).success).toBe(false);
    }
  });
  it('keeps only stable public recovery fields, with no mutable pending state or authority', () => {
    for (const key of ['pendingRevision', 'writeOptions', 'funding', 'body', 'systemConfig', 'presetConfig', 'webPackageRef', 'token', 'createClaim', 'secretRef']) {
      expect(DesktopArenaHostedStoryRecoveryPointerSchema.safeParse({ ...pointer, [key]: {} }).success, key).toBe(false);
    }
    expect(DesktopArenaHostedStoryRecoveryPointerSchema.parse({ ...pointer, generationId: reconcile.generationId, cursor: '2-0' }).cursor).toBe('2-0');
  });
});
