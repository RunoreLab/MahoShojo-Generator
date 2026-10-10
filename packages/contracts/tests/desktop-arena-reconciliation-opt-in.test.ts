import { describe, expect, it } from 'vitest';
import { DesktopArenaHostedCreateRequestSchema, DesktopArenaHostedBodySchema } from '../src/desktop-arena-hosted';
import { DesktopArenaHostedJsonCreateRequestSchema, DesktopArenaHostedAnyRecoveryPointerSchema } from '../src/desktop-arena-hosted-json';

const body = { reportFormat: 'markdown', combatants: [{ type: 'general-character', data: { name: '甲' } }], mode: 'daily', writeArenaHistory: false, writeCurrentState: false };
const request = { product: 'battle', requestId: 'test-request-1', actor: { kind: 'anonymous' }, body };
const pointer = { version: 1, product: 'battle', protocolVersion: 'arena-hosted-sse-v1', requestId: 'test-request-1', bodyHash: 'a'.repeat(64), actor: { kind: 'anonymous' }, format: 'markdown', battleMode: 'daily', state: 'prepared', updatedAt: '2026-10-10T10:00:00Z' };
describe('new explicit role writes never upgrade C1/C2 tasks', () => {
  it.each([false, true].flatMap(history => [false, true].map(state => [history, state] as const)))('freezes history=%s state=%s only with opt-in', (writeArenaHistory, writeCurrentState) => {
    const input = { ...request, body: { ...body, writeArenaHistory, writeCurrentState } };
    for (const [operation, schema] of [['create-stream', DesktopArenaHostedCreateRequestSchema], ['create-json', DesktopArenaHostedJsonCreateRequestSchema]] as const) {
      expect(schema.safeParse({ ...input, operation }).success).toBe(!writeArenaHistory && !writeCurrentState);
      expect(schema.parse({ ...input, operation, reconciliationVersion: 'arena-reconciliation-v1' }).body).toMatchObject({ writeArenaHistory, writeCurrentState });
      expect(schema.safeParse({ ...input, operation, reconciliationVersion: 'v0' }).success).toBe(false);
    }
    expect(DesktopArenaHostedBodySchema.safeParse(input.body).success).toBe(!writeArenaHistory && !writeCurrentState);
  });
  it('dual-reads both legacy pointers without fabricating writes and requires v3 explicit policy', () => {
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.parse(pointer)).not.toHaveProperty('writeArenaHistory');
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.parse({ ...pointer, version: 2, delivery: 'non-stream', protocolVersion: 'arena-companion-v1' })).not.toHaveProperty('writeCurrentState');
    for (const version of [1, 2]) expect(DesktopArenaHostedAnyRecoveryPointerSchema.safeParse({ ...pointer, version, ...(version === 2 ? { delivery: 'stream' } : {}), writeArenaHistory: true }).success).toBe(false);
    const next = { ...pointer, version: 3, delivery: 'stream', reconciliationVersion: 'arena-reconciliation-v1', writeArenaHistory: true, writeCurrentState: false };
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.parse(next)).toEqual(next);
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.safeParse({ ...next, version: 4 }).success).toBe(false);
    const missing = Object.fromEntries(Object.entries(next).filter(([key]) => key !== 'writeCurrentState'));
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.safeParse(missing).success).toBe(false);
  });
});
