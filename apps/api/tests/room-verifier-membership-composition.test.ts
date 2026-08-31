import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const apiRoot = path.resolve(import.meta.dirname, '..');
const verifierHelperPath = 'scripts/room-verifier-membership.ts';
const verifierScripts = [
  'verify-room-redis.ts',
  'verify-room-generation-redis.ts',
  'verify-room-generation-process-recovery.ts',
  'verify-room-hardening-faults.ts',
  'verify-room-hardening-load.ts',
];

describe('Room verifier membership composition', () => {
  it('keeps the verifier composition root in package lint and verifier typecheck', () => {
    const packageManifest = JSON.parse(readFileSync(path.join(apiRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const verifierTsconfig = JSON.parse(readFileSync(
      path.join(apiRoot, 'tsconfig.room-verifier.json'),
      'utf8',
    )) as { include?: string[] };

    expect(packageManifest.scripts?.lint).toContain(verifierHelperPath);
    expect(verifierTsconfig.include).toContain(verifierHelperPath);
  });

  it.each(verifierScripts)('%s uses the fail-closed verifier composition root', (filename) => {
    const source = readFileSync(path.join(apiRoot, 'scripts', filename), 'utf8');

    expect(source).toContain('createRoomVerifierMembershipService');
    expect(source).not.toMatch(/\bcreateArenaRoomMembershipService\s*\(/u);
  });
});
