export type MagicTeaPartyDraftState = {
  sessionId: string | null;
  value: string;
  canHydrateFromSession: boolean;
};

type MagicTeaPartyDraftSession = {
  id: string;
  draft?: string;
};

export const createMagicTeaPartyDraftState = (
  sessionId: string | null,
  storedDraft: string | null
): MagicTeaPartyDraftState => ({
  sessionId,
  value: storedDraft ?? '',
  canHydrateFromSession: Boolean(sessionId && storedDraft === null),
});

export const hydrateMagicTeaPartyDraftFromSession = (
  state: MagicTeaPartyDraftState,
  session: MagicTeaPartyDraftSession | null
): MagicTeaPartyDraftState => {
  if (!session || state.sessionId !== session.id || !state.canHydrateFromSession) return state;
  return {
    sessionId: state.sessionId,
    value: typeof session.draft === 'string' ? session.draft : '',
    canHydrateFromSession: false,
  };
};

export const editMagicTeaPartyDraftState = (
  state: MagicTeaPartyDraftState,
  sessionId: string | null,
  value: string
): MagicTeaPartyDraftState => {
  if (!sessionId) return state;
  return {
    sessionId,
    value,
    canHydrateFromSession: false,
  };
};
