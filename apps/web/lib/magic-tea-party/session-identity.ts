export const isMagicTeaPartySessionCurrent = (
  activeSessionId: string | null,
  sessionId: string | null | undefined,
): boolean => Boolean(activeSessionId && sessionId === activeSessionId);

export const resolveMagicTeaPartyActiveSession = <T extends { id: string }>(
  activeSessionId: string | null,
  session: T | null,
): T | null => (
  session && isMagicTeaPartySessionCurrent(activeSessionId, session.id)
    ? session
    : null
);
