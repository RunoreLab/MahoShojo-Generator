const safeDatePartsFromIso = (iso: string | null | undefined): { yyyy: string; mm: string; dd: string } => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return { yyyy: '0000', mm: '00', dd: '00' };
  const d = new Date(ms);
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { yyyy, mm, dd };
};

export const buildBattleReportGenerationR2Key = (input: {
  generationId: string;
  startedAtIso: string;
  format: 'json' | 'markdown';
}): { key: string; contentType: string; fileName: string } => {
  const id = String(input.generationId || '').trim();
  const { yyyy, mm, dd } = safeDatePartsFromIso(input.startedAtIso);
  const base = `v1/battle-report-generations/${yyyy}/${mm}/${dd}/${id}`;
  if (input.format === 'markdown') {
    return {
      key: `${base}/output.md`,
      contentType: 'text/markdown; charset=utf-8',
      fileName: 'output.md',
    };
  }
  return {
    key: `${base}/output.json`,
    contentType: 'application/json; charset=utf-8',
    fileName: 'output.json',
  };
};

export const gzipTextIfSupported = async (text: string): Promise<{ body: Uint8Array; contentEncoding: string | null }> => {
  const raw = new TextEncoder().encode(text || '');
  const CompressionStreamCtor = (globalThis as any).CompressionStream as any;
  if (typeof CompressionStreamCtor !== 'function') {
    return { body: raw, contentEncoding: null };
  }

  const cs = new CompressionStreamCtor('gzip');
  const writer = cs.writable.getWriter();
  await writer.write(raw);
  await writer.close();
  const res = new Response(cs.readable);
  const ab = await res.arrayBuffer();
  return { body: new Uint8Array(ab), contentEncoding: 'gzip' };
};

export const gzipStreamIfSupported = (stream: ReadableStream<Uint8Array>): { stream: ReadableStream<Uint8Array>; contentEncoding: string | null } => {
  const CompressionStreamCtor = (globalThis as any).CompressionStream as any;
  if (typeof CompressionStreamCtor !== 'function') {
    return { stream, contentEncoding: null };
  }
  const cs = new CompressionStreamCtor('gzip');
  return { stream: stream.pipeThrough(cs), contentEncoding: 'gzip' };
};
