import {
  ARENA_COMPANION_JSON_LIMITS, ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION,
  ArenaCompanionEnvelopeSchema, ArenaCompanionMetadataSchema,
} from '@mahoshojo/contracts/arena-companion';
import { DesktopArenaHostedGenerationIdSchema, DesktopArenaHostedRequestIdSchema } from '@mahoshojo/contracts/desktop-arena-hosted';

const STREAM_META_HEADER = 'x-mahoshojo-stream-meta';
type HeadersRecord = Readonly<Record<string, string>>;
const getHeader = (headers: HeadersRecord, name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const wireBytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** Same public object feeds legacy Web and opt-in JSON. No serialize/parse of a success Response. */
export const createArenaCompanionResponseWriter = (optIn: boolean) => {
  const write = (body: unknown, status: number, headers: HeadersRecord = {}, decodedMetadata?: Record<string, unknown>, producerCompleted = false): Response => {
    if (!optIn) return new Response(JSON.stringify(body), {
      status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...headers },
    });
    const selectedHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => ![STREAM_META_HEADER, 'content-length', 'content-encoding'].includes(key.toLowerCase())));
    selectedHeaders[ARENA_COMPANION_PROTOCOL_HEADER] = ARENA_COMPANION_PROTOCOL_VERSION;
    const publicBody = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    const generationId = DesktopArenaHostedGenerationIdSchema.safeParse(getHeader(headers, 'x-mahoshojo-generation-id')).data
      ?? DesktopArenaHostedGenerationIdSchema.safeParse(publicBody?.generationId).data;
    const generationRequestId = DesktopArenaHostedRequestIdSchema.safeParse(getHeader(headers, 'x-mahoshojo-generation-request-id')).data
      ?? DesktopArenaHostedRequestIdSchema.safeParse(publicBody?.generationRequestId).data;
    const diagnostic = (code: string) => ({
      version: ARENA_COMPANION_PROTOCOL_VERSION,
      body: {
        code, error: 'Arena companion delivery is unavailable; recover the original generation.',
        ...(producerCompleted ? { status: 'completed' } : {}),
        ...(generationId ? { generationId } : {}), ...(generationRequestId ? { generationRequestId } : {}),
      },
      metadata: null,
    });
    const rawMeta = getHeader(headers, STREAM_META_HEADER);
    let metadata: unknown = null;
    let metadataInvalid = false;
    if (rawMeta !== undefined) {
      try { metadata = decodedMetadata ?? JSON.parse(decodeURIComponent(rawMeta)); } catch { metadataInvalid = true; }
      if (!ArenaCompanionMetadataSchema.safeParse(metadata).success) metadataInvalid = true;
    }
    const envelope = { version: ARENA_COMPANION_PROTOCOL_VERSION,
      body: producerCompleted && status >= 400 && body && typeof body === 'object' ? { ...body, status: 'completed' } : body,
      metadata };
    const isSuccess = status >= 200 && status < 300;
    const valid = !metadataInvalid && ArenaCompanionEnvelopeSchema.safeParse(envelope).success
      && (isSuccess === Boolean(body && typeof body === 'object' && 'report' in body));
    let wire = JSON.stringify(valid ? envelope : diagnostic(
      isSuccess && rawMeta === undefined ? 'ARENA_COMPANION_METADATA_UNAVAILABLE' : 'ARENA_COMPANION_PROTOCOL_UNSUPPORTED',
    ));
    let responseStatus = valid ? status : 502;
    if (wireBytes(wire) > ARENA_COMPANION_JSON_LIMITS.wireBytes) {
      wire = JSON.stringify(diagnostic('ARENA_COMPANION_RESPONSE_TOO_LARGE'));
      responseStatus = 502;
    }
    return new Response(wire, {
      status: responseStatus,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...selectedHeaders },
    });
  };
  return {
    write,
    /** Only pre-generation/error Responses use this bounded compatibility seam. */
    async upstream(response: Response): Promise<Response> {
      if (!optIn) return response;
      const headers = Object.fromEntries(response.headers.entries());
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        if (reader) while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          // The proven fixed public-error skeleton fits 64KiB; never buffer an arbitrary upstream error.
          if (bytes > 65536) {
            await reader.cancel().catch(() => undefined);
            return write({ code: 'ARENA_COMPANION_PROTOCOL_UNSUPPORTED', error: 'Unsupported Arena companion error response' }, 502, headers);
          }
          chunks.push(next.value);
        }
        const data = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
        return write(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)), response.status, headers);
      } catch {
        return write({ code: 'ARENA_COMPANION_PROTOCOL_UNSUPPORTED', error: 'Unsupported Arena companion error response' }, 502, headers);
      } finally { reader?.releaseLock(); }
    },
  };
};
