import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { getLogger } from '@/lib/logger';
import { applyMagicTeaPartyUpdateDrafts } from '@/lib/magic-tea-party/apply-updates';
import type { MagicTeaPartyRole, MagicTeaPartyUpdateDraft } from '@/lib/magic-tea-party/types';

const log = getLogger('api-magic-tea-party-apply-updates');

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

    const result = applyMagicTeaPartyUpdateDrafts({
      sessionId,
      sessionTitle,
      drafts: drafts as MagicTeaPartyUpdateDraft[],
      roles: roles as MagicTeaPartyRole[],
      summaryMeta,
      writeArenaHistory,
      writeCurrentState,
    });

    return json(result);
  } catch (error) {
    log.error('魔法茶会应用更新失败', { error });
    const message = error instanceof Error ? error.message : '未知错误';
    return json({ error: '写入失败', message }, { status: 500 });
  }
}
