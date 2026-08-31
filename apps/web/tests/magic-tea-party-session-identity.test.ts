import {
  isMagicTeaPartySessionCurrent,
  resolveMagicTeaPartyActiveSession,
} from '@/lib/magic-tea-party/session-identity';

describe('magic tea party session identity', () => {
  const sessionA = { id: 'session-a', title: 'A' };

  it('does not expose a stale session during an A to B switch', () => {
    expect(resolveMagicTeaPartyActiveSession('session-b', sessionA)).toBeNull();
    expect(isMagicTeaPartySessionCurrent('session-b', sessionA.id)).toBe(false);
  });

  it('exposes only the session whose id matches the current selection', () => {
    expect(resolveMagicTeaPartyActiveSession('session-a', sessionA)).toBe(sessionA);
    expect(isMagicTeaPartySessionCurrent('session-a', sessionA.id)).toBe(true);
  });
});
