import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DirectProviderProfileV1Schema } from '@mahoshojo/contracts/provider-profile';
import { getProviderProfile, saveProviderProfile } from '../src/platform/provider-profile-bridge';

// 同一 fixture 由 Rust 的真实 command 签名、校验器和 SQLite 重开测试消费。
const fixture = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-provider-profile-ipc.json', import.meta.url), 'utf8'));

describe('provider profile bidirectional native wire contract', () => {
  it('sends serialized arguments and parses the native string response', async () => {
    const expectedCalls = [fixture.validate, fixture.save, fixture.get];
    const invoke = async (command: string, args?: Record<string, unknown>) => {
      const expected = expectedCalls.shift();
      expect(expected, 'unexpected extra IPC command').toBeDefined();
      expect({ command, args }).toEqual({ command: expected.command, args: expected.args });
      return expected.response;
    };
    const profile = DirectProviderProfileV1Schema.parse(fixture.profile);
    await saveProviderProfile(invoke, profile);
    await expect(getProviderProfile(invoke, profile.id)).resolves.toEqual(profile);
    expect(expectedCalls).toEqual([]);
  });
  it('still refuses changed header values despite ignoring map key order', async () => {
    const response = structuredClone(fixture.validate.response);
    response.publicHeaders['x-z'] = 'different';
    const commands: string[] = [];
    await expect(saveProviderProfile(async (command) => {
      commands.push(command);
      return response;
    }, DirectProviderProfileV1Schema.parse(fixture.profile))).rejects.toMatchObject({
      code: 'provider-profile-mismatch',
    });
    expect(commands).toEqual([fixture.validate.command]);
  });

});
