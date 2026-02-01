import { randomUUID } from '@/lib/crypto';
import type { MagicTeaPartyRole, MagicTeaPartyUpdateDraft } from '@/lib/magic-tea-party/types';

export type MagicTeaPartyUpdateSummaryMeta = {
  summaryId?: string;
  messageRange?: {
    fromMessageId: string;
    toMessageId: string;
    count: number;
  };
};

export type MagicTeaPartyApplyUpdatesInput = {
  sessionId: string;
  sessionTitle?: string;
  drafts: MagicTeaPartyUpdateDraft[];
  roles: MagicTeaPartyRole[];
  summaryMeta?: MagicTeaPartyUpdateSummaryMeta;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
  nowISO?: string;
  createWorldLineId?: () => string;
};

export type MagicTeaPartyApplyUpdatesResult = {
  updatedRoles: MagicTeaPartyRole[];
  writeLog: {
    sessionId: string;
    summaryId?: string;
  };
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const applyMagicTeaPartyUpdateDrafts = (params: MagicTeaPartyApplyUpdatesInput): MagicTeaPartyApplyUpdatesResult => {
  const {
    sessionId,
    sessionTitle,
    drafts,
    roles,
    summaryMeta,
    writeArenaHistory,
    writeCurrentState,
    nowISO,
    createWorldLineId,
  } = params;
  const normalizedDrafts: MagicTeaPartyUpdateDraft[] = Array.isArray(drafts) ? drafts : [];
  const normalizedRoles: MagicTeaPartyRole[] = Array.isArray(roles)
    ? roles.map((role) => ({
        ...role,
        source: (role as any).source || 'cloud',
        card: typeof (role as any).card === 'object' && (role as any).card ? (role as any).card : {},
      }))
    : [];
  const now = nowISO ?? new Date().toISOString();
  const worldLineId = createWorldLineId ?? randomUUID;
  const participantNames = normalizedRoles.map((role) => role.name).filter(Boolean);

  const updatedRoles: MagicTeaPartyRole[] = normalizedRoles.map((role) => {
    const draft = normalizedDrafts.find((item) => item.roleId === role.id || item.characterName === role.name);
    if (!draft) return role;

    const card = { ...toRecord(role.card) };
    let didMutate = false;

    const impactText = readString(draft.impact);
    if (writeArenaHistory && impactText) {
      const history = { ...(card.arena_history as Record<string, unknown> | undefined) };
      const entries = Array.isArray(history.entries) ? [...(history.entries as any[])] : [];
      const attributes = toRecord(history.attributes);

      const lastEntryId =
        entries.length > 0 && typeof entries[entries.length - 1]?.id === 'number' ? entries[entries.length - 1].id : 0;
      const hasWinner = Boolean(draft.hasWinner && readString(draft.winner));
      const winner = hasWinner ? readString(draft.winner) : '不适用';
      const impact = impactText;

      const nextAttributes = {
        world_line_id: typeof attributes.world_line_id === 'string' ? attributes.world_line_id : worldLineId(),
        created_at: typeof attributes.created_at === 'string' ? attributes.created_at : now,
        updated_at: now,
        sublimation_count: typeof attributes.sublimation_count === 'number' ? attributes.sublimation_count : 0,
        last_sublimation_at: typeof attributes.last_sublimation_at === 'string' ? attributes.last_sublimation_at : null,
      };

      const entry = {
        id: lastEntryId + 1,
        type: 'tea-party',
        title: readString(sessionTitle) || '魔法茶会',
        participants: participantNames,
        winner,
        impact,
        metadata: {
          user_guidance: null,
          scenario_title: null,
          non_native_data_involved: true,
          source: 'magic-tea-party',
          has_winner: hasWinner,
          session_id: sessionId,
          ...(summaryMeta?.summaryId ? { summary_id: summaryMeta.summaryId } : {}),
          ...(summaryMeta?.messageRange ? { message_range: summaryMeta.messageRange } : {}),
        },
      };

      entries.push(entry);
      card.arena_history = { attributes: nextAttributes, entries };
      didMutate = true;
    }

    const stateSummary = readString(draft.currentStateSummary);
    if (writeCurrentState && stateSummary) {
      const existingState = toRecord(card.current_state);
      card.current_state = {
        ...existingState,
        summary: stateSummary,
        updated_at: now,
      };
      didMutate = true;
    }

    if (!didMutate) return role;

    delete (card as any).signature;

    return {
      ...role,
      card,
      isNative: false,
      signature: undefined,
    };
  });

  return {
    updatedRoles,
    writeLog: {
      sessionId,
      ...(summaryMeta?.summaryId ? { summaryId: summaryMeta.summaryId } : {}),
    },
  };
};
