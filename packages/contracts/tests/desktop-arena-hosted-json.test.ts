import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/desktop-arena-hosted-json.json';
import { DesktopArenaHostedCreateRequestSchema, DesktopArenaHostedChannelEventSchema, DesktopArenaHostedRecoveryPointerSchema } from '../src/desktop-arena-hosted';
import { DesktopArenaHostedJsonCreateRequestSchema, DesktopArenaHostedJsonChannelEventSchema, DesktopArenaHostedAnyRecoveryPointerSchema } from '../src/desktop-arena-hosted-json';

describe('Arena JSON shares only the C1 flight and authority scope', () => {
  it('keeps separate DTOs, old v1 interpretation and bounded Channel fragments', () => {
    expect(DesktopArenaHostedJsonCreateRequestSchema.parse(fixture.createRequest)).toEqual(fixture.createRequest);
    expect(DesktopArenaHostedCreateRequestSchema.safeParse(fixture.createRequest).success).toBe(false);
    for (const value of fixture.channelEvents) {
      expect(DesktopArenaHostedJsonChannelEventSchema.parse(value)).toEqual(value);
      expect(DesktopArenaHostedChannelEventSchema.safeParse(value).success).toBe(false);
    }
    for (const value of [fixture.pointer, fixture.legacyPointer]) expect(DesktopArenaHostedAnyRecoveryPointerSchema.parse(value)).toEqual(value);
    expect(DesktopArenaHostedRecoveryPointerSchema.safeParse(fixture.pointer).success).toBe(false);
    for (const text of ['\u0001'.repeat(65536), '😀'.repeat(16384)]) {
      const fragment = { ...fixture.channelEvents[1], text };
      expect(DesktopArenaHostedJsonChannelEventSchema.safeParse(fragment).success).toBe(true);
      expect(DesktopArenaHostedJsonChannelEventSchema.safeParse({ ...fragment, text: text + 'x' }).success).toBe(false);
    }
  });
  it('does not introduce renderer authority or permit character writes', () => {
    for (const field of ['url', 'headers', 'cookie', 'apiKey', 'customProvider', 'secretRef']) {
      expect(DesktopArenaHostedJsonCreateRequestSchema.safeParse({ ...fixture.createRequest, [field]: 'injected' }).success).toBe(false);
      expect(DesktopArenaHostedJsonChannelEventSchema.safeParse({ ...fixture.channelEvents[0], [field]: 'injected' }).success).toBe(false);
    }
    for (const field of ['writeArenaHistory', 'writeCurrentState']) expect(DesktopArenaHostedJsonCreateRequestSchema.safeParse({ ...fixture.createRequest, body: { ...fixture.createRequest.body, [field]: true } }).success).toBe(false);
    expect(DesktopArenaHostedJsonChannelEventSchema.safeParse({ ...fixture.channelEvents[0], headerMeta: {} }).success).toBe(false);
  });
  it('requires an exact delivery/version pair and no forged legacy delivery', () => {
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.safeParse({ ...fixture.pointer, delivery: 'stream' }).success).toBe(false);
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.safeParse({ ...fixture.pointer, delivery: 'stream', protocolVersion: 'arena-hosted-sse-v1' }).success).toBe(true);
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.safeParse({ ...fixture.legacyPointer, delivery: 'non-stream' }).success).toBe(false);
  });
});
