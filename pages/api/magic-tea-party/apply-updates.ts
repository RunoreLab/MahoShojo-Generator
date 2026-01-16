import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { getLogger } from '@/lib/logger';
import { randomUUID } from '@/lib/crypto';
import type { MagicTeaPartyRole, MagicTeaPartyUpdateDraft } from '@/lib/magic-tea-party/types';

const log = getLogger('api-magic-tea-party-apply-updates');

export const config = {
  runtime: 'edge',
};

const DraftSchema = z
  .object({
    roleId: z.string().optional(),
    characterName: z.string().min(1),
    impact: z.string().optional(),
    currentStateSummary: z.string().optional(),
    hasWinner: z.boolean().optional(),
    winner: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

const RoleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: z.string().optional(),
    isNative: z.boolean().optional(),
    signature: z.string().optional(),
    card: z.record(z.unknown()).default({}),
  })
  .passthrough();

const SettingsSchema = z.object({
  writeArenaHistory: z.boolean().optional(),
  writeCurrentState: z.boolean().optional(),
});

const RequestBodySchema = z.object({
  sessionId: z.string().min(1),
  sessionTitle: z.string().optional(),
  drafts: z.array(DraftSchema).default([]),
  roles: z.array(RoleSchema).max(20).default([]),
  summaryMeta: z
    .object({
      summaryId: z.string().optional(),
      messageRange: z
        .object({
          fromMessageId: z.string().min(1),
          toMessageId: z.string().min(1),
          count: z.number().int().min(1),
        })
        .optional(),
    })
    .optional(),
  settings: SettingsSchema,
});

const json = (payload: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const parsedBody = RequestBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return json({ error: '请求参数无效' }, { status: 400 });
    }

    const { sessionId, sessionTitle, drafts, roles, summaryMeta, settings } = parsedBody.data;
    const writeArenaHistory = Boolean(settings.writeArenaHistory);
    const writeCurrentState = Boolean(settings.writeCurrentState);

    if (!writeArenaHistory && !writeCurrentState) {
      return json({ error: '未开启写入开关' }, { status: 400 });
    }

    const normalizedDrafts: MagicTeaPartyUpdateDraft[] = Array.isArray(drafts) ? (drafts as MagicTeaPartyUpdateDraft[]) : [];
    const normalizedRoles: MagicTeaPartyRole[] = Array.isArray(roles)
      ? (roles as unknown as MagicTeaPartyRole[]).map((role) => ({
          ...role,
          source: (role as any).source || 'cloud',
          card: typeof (role as any).card === 'object' && (role as any).card ? (role as any).card : {},
        }))
      : [];
    const nowISO = new Date().toISOString();
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

        const lastEntryId = entries.length > 0 && typeof entries[entries.length - 1]?.id === 'number' ? entries[entries.length - 1].id : 0;
        const hasWinner = Boolean(draft.hasWinner && readString(draft.winner));
        const winner = hasWinner ? readString(draft.winner) : '不适用';
        const impact = impactText;

        const nextAttributes = {
          world_line_id: typeof attributes.world_line_id === 'string' ? attributes.world_line_id : randomUUID(),
          created_at: typeof attributes.created_at === 'string' ? attributes.created_at : nowISO,
          updated_at: nowISO,
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
          updated_at: nowISO,
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

    return json({
      updatedRoles,
      writeLog: {
        sessionId,
        ...(summaryMeta?.summaryId ? { summaryId: summaryMeta.summaryId } : {}),
      },
    });
  } catch (error) {
    log.error('魔法茶会应用更新失败', { error });
    const message = error instanceof Error ? error.message : '未知错误';
    return json({ error: '写入失败', message }, { status: 500 });
  }
}
