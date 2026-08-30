import { upsertLargeObjectByOwnerRef } from '@/lib/database/large-objects';
import { putObject } from '@/lib/r2';
import { battleReportOutputPreviewConfig } from '@/config/battle-report';

import { buildBattleReportGenerationR2Key, gzipStreamIfSupported, gzipTextIfSupported } from './large-object-r2';

const shouldPersistPreviewInD1 = (): boolean => {
  return battleReportOutputPreviewConfig.persistPreviewInD1;
};

export type StoredBattleReportOutput = {
  ok: boolean;
  r2Key: string | null;
  bytes: number;
  storedBytes: number | null;
  contentType: string;
  contentEncoding: string | null;
  persistPreviewInD1: boolean;
  error?: string;
};

export const getBattleReportOutputPersistPreviewFlag = (): boolean => shouldPersistPreviewInD1();

export async function storeBattleReportGenerationOutputTextToR2(input: {
  generationId: string;
  startedAtIso: string;
  ownerUserId: number | null;
  format: 'json' | 'markdown';
  text: string;
}): Promise<StoredBattleReportOutput> {
  const persistPreviewInD1 = shouldPersistPreviewInD1();
  const bytes = new TextEncoder().encode(input.text || '').byteLength;
  const { key, contentType } = buildBattleReportGenerationR2Key({
    generationId: input.generationId,
    startedAtIso: input.startedAtIso,
    format: input.format,
  });

  try {
    const gz = await gzipTextIfSupported(input.text || '');
    const storedBytes = gz.body.byteLength;
    const put = await putObject(key, gz.body, {
      contentType,
      ...(gz.contentEncoding ? { contentEncoding: gz.contentEncoding } : {}),
      cacheControl: 'private, max-age=0, no-store',
      metadata: {
        kind: 'battle_report_generation_output',
        generationId: input.generationId,
        format: input.format,
      },
    });
    if (!put.success) {
      return { ok: false, r2Key: null, bytes, storedBytes: null, contentType, contentEncoding: null, persistPreviewInD1, error: put.error || 'R2 上传失败' };
    }

    const upsert = await upsertLargeObjectByOwnerRef({
      kind: 'battle_report_generation_output',
      ownerRefId: input.generationId,
      ownerUserId: input.ownerUserId ?? null,
      r2Key: key,
      bytes,
      storedBytes,
      contentType,
      contentEncoding: gz.contentEncoding,
      sha256: null,
    });

    if (!upsert.ok) {
      return { ok: false, r2Key: null, bytes, storedBytes, contentType, contentEncoding: gz.contentEncoding, persistPreviewInD1, error: upsert.error || 'large_objects 写入失败' };
    }

    return { ok: true, r2Key: key, bytes, storedBytes, contentType, contentEncoding: gz.contentEncoding, persistPreviewInD1 };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, r2Key: null, bytes, storedBytes: null, contentType, contentEncoding: null, persistPreviewInD1, error: msg || '未知错误' };
  }
}

export async function storeBattleReportGenerationOutputStreamToR2(input: {
  generationId: string;
  startedAtIso: string;
  stream: ReadableStream<Uint8Array>;
  signal?: AbortSignal;
}): Promise<StoredBattleReportOutput> {
  const persistPreviewInD1 = shouldPersistPreviewInD1();
  const { key, contentType } = buildBattleReportGenerationR2Key({
    generationId: input.generationId,
    startedAtIso: input.startedAtIso,
    format: 'markdown',
  });

  let bytes = 0;
  const rawCounter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  let storedBytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      storedBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  const rawStream = input.stream.pipeThrough(rawCounter);
  const gz = gzipStreamIfSupported(rawStream);
  const uploadBody = gz.stream.pipeThrough(counter);

  const put = await putObject(key, uploadBody, {
    contentType,
    ...(gz.contentEncoding ? { contentEncoding: gz.contentEncoding } : {}),
    cacheControl: 'private, max-age=0, no-store',
    metadata: {
      kind: 'battle_report_generation_output',
      generationId: input.generationId,
      format: 'markdown',
    },
    signal: input.signal,
  });

  if (!put.success) {
    return { ok: false, r2Key: null, bytes, storedBytes: null, contentType, contentEncoding: gz.contentEncoding, persistPreviewInD1, error: put.error || 'R2 上传失败' };
  }

  return { ok: true, r2Key: key, bytes, storedBytes, contentType, contentEncoding: gz.contentEncoding, persistPreviewInD1 };
}
