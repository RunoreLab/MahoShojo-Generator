import type { NextRequest } from 'next/server';

import { queryFromD1 } from '@/lib/d1';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { verifySignature } from '@/lib/signature';
import { upsertDataCardMetrics } from '@/lib/database/data-card-metrics';

export const runtime = 'edge';

type PutBody = {
  dataCardIds?: unknown;
  force?: unknown;
};

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as PutBody;
    const ids = Array.isArray(body.dataCardIds)
      ? (body.dataCardIds as unknown[]).filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean)
      : [];
    const force = body.force === true;

    if (ids.length === 0) {
      return new Response(JSON.stringify({ success: false, error: '缺少 dataCardIds' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (ids.length > 120) {
      return new Response(JSON.stringify({ success: false, error: '单次最多重算 120 张卡' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const placeholders = ids.map(() => '?').join(', ');
    const cardRows = readRows<{
      id: string;
      type: 'character' | 'scenario' | 'history' | 'questionnaire';
      data: string;
      updated_at: string;
    }>(
      await queryFromD1(
        `SELECT id, type, data, updated_at
         FROM data_cards
         WHERE id IN (${placeholders})
           AND deleted_at IS NULL`,
        ids,
      ),
    );

    const metricsRows = readRows<{
      data_card_id: string;
      data_card_updated_at: string;
    }>(
      await queryFromD1(
        `SELECT data_card_id, data_card_updated_at
         FROM data_card_metrics
         WHERE data_card_id IN (${placeholders})`,
        ids,
      ),
    );

    const metricsUpdatedAtById = new Map<string, string>();
    for (const row of metricsRows) {
      if (!row?.data_card_id) continue;
      if (typeof row.data_card_updated_at !== 'string') continue;
      metricsUpdatedAtById.set(row.data_card_id, row.data_card_updated_at);
    }

    const hasSignatureKey = Boolean(process.env.SIGNATURE_SECRET_KEY);

    let processed = 0;
    let skipped = 0;
    const failedIds: string[] = [];
    const missingIds = ids.filter((id) => !cardRows.some((c) => c.id === id));

    for (const card of cardRows) {
      const lastMetricsAt = metricsUpdatedAtById.get(card.id) ?? null;
      const isStale = !lastMetricsAt || lastMetricsAt !== card.updated_at;
      if (!force && !isStale) {
        skipped += 1;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(card.data) as unknown;
      } catch {
        failedIds.push(card.id);
        continue;
      }

      try {
        const tech = computeTechIndex(parsed);
        const isNative = hasSignatureKey ? await verifySignature(parsed as any) : null;
        const ok = await upsertDataCardMetrics({
          dataCardId: card.id,
          techScore: tech.techScore,
          techLevel: tech.techLevel,
          isNative,
          dataCardUpdatedAt: card.updated_at,
          detailsJson: {
            raw: tech.raw,
            derived: tech.derived,
            components: tech.components,
            notes: tech.notes,
          },
        });
        if (!ok) failedIds.push(card.id);
        else processed += 1;
      } catch {
        failedIds.push(card.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        skipped,
        failed: failedIds.length,
        failedIds,
        missing: missingIds.length,
        missingIds,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Admin data-card-metrics/recompute 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '重算失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

