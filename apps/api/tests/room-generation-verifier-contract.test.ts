import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

describe('Room generation Redis verifier contract', () => {
  test('明确验证 terminal effect gates exactly-once，且不宣称外部 story write', async () => {
    const source = await readFile(fileURLToPath(new URL(
      '../scripts/verify-room-generation-redis.ts',
      import.meta.url,
    )), 'utf8');

    expect(source).toContain('ratingSettlementInvocations');
    expect(source).toContain('storyImpactGateInvocations');
    expect(source).toContain('ROOM_GENERATION_DURABLE_TERMINAL_EFFECT_NOT_EXACTLY_ONCE');
    expect(source).toContain('terminalEffectScope: \'invocation-gates\'');
    expect(source).not.toContain('externalStoryWriteExactlyOnce: true');
    expect(source).toContain('只允许 HOSTED_API_ENVIRONMENT=local/test');
    expect(source).not.toContain("|| 'gmr09dur'");
  });
});
