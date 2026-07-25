import type { NextRequest } from 'next/server';

import { getLargeObjectByOwnerRef, queryFromD1 } from '@/lib/d1';
import { generatePresignedUrl } from '@/lib/r2';
import { buildBattleReportGenerationR2Key } from '@/lib/arena/large-object-r2';

export const runtime = 'edge';

type OutputCandidate = {
  format: 'json' | 'markdown';
  r2Key: string;
  downloadUrl: string;
};

const parseIntParam = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const inferFormatFromKey = (key: string): 'json' | 'markdown' | null => {
  const normalized = typeof key === 'string' ? key.trim().toLowerCase() : '';
  if (!normalized) return null;
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) return 'markdown';
  if (normalized.endsWith('.json')) return 'json';
  return null;
};

const readRow = <T,>(result: unknown): T | null => {
  const row = (result as any)?.result?.[0]?.results?.[0];
  return row ? (row as T) : null;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    const generationId = (url.searchParams.get('generationId') ?? '').trim();
    const expiresInSeconds = Math.max(30, Math.min(3600, parseIntParam(url.searchParams.get('expiresInSeconds'), 600)));

    if (!generationId) {
      return new Response(JSON.stringify({ success: false, error: '缺少 generationId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const lo = await getLargeObjectByOwnerRef('battle_report_generation_output', generationId);
    if (lo?.r2_key) {
      const format = inferFormatFromKey(lo.r2_key) ?? 'markdown';
      const responseContentType = lo.content_type ?? (format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8');
      const downloadUrl = await generatePresignedUrl(lo.r2_key, {
        method: 'GET',
        expiresInSeconds,
        responseContentType,
      });

      const candidate: OutputCandidate = { format, r2Key: lo.r2_key, downloadUrl };
      return new Response(JSON.stringify({ success: true, generationId, indexed: true, expiresInSeconds, candidates: [candidate] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const record = readRow<{ started_at: string | null }>(
      await queryFromD1('SELECT started_at FROM battle_report_generations WHERE id = ? LIMIT 1', [generationId]),
    );

    const startedAtIso = typeof record?.started_at === 'string' ? record.started_at : null;
    if (!startedAtIso) {
      return new Response(JSON.stringify({ success: false, error: '找不到 generation 记录，或无法推断 R2 key' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const jsonKey = buildBattleReportGenerationR2Key({ generationId, startedAtIso, format: 'json' });
    const mdKey = buildBattleReportGenerationR2Key({ generationId, startedAtIso, format: 'markdown' });

    const [jsonUrl, mdUrl] = await Promise.all([
      generatePresignedUrl(jsonKey.key, { method: 'GET', expiresInSeconds, responseContentType: jsonKey.contentType }),
      generatePresignedUrl(mdKey.key, { method: 'GET', expiresInSeconds, responseContentType: mdKey.contentType }),
    ]);

    const candidates: OutputCandidate[] = [
      { format: 'json', r2Key: jsonKey.key, downloadUrl: jsonUrl },
      { format: 'markdown', r2Key: mdKey.key, downloadUrl: mdUrl },
    ];

    return new Response(JSON.stringify({ success: true, generationId, indexed: false, expiresInSeconds, candidates }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin battle-report-output 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '无法生成下载链接' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

