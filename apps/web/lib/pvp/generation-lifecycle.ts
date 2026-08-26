import { readDurablePvpGenerationId } from './generation-authority';

export type PvpGenerationFailureOutcome = Readonly<{
  generationId: string | null;
  errorMessage: string | null;
  shouldRedirect: boolean;
  redirectReason: string | null;
}>;

const isJsonLike = (contentType: string | null, raw: string): boolean => {
  const normalized = contentType?.toLowerCase() ?? '';
  if (normalized.includes('json')) return true;
  const trimmed = raw.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

export const handlePvpGenerationFailure = async (input: {
  response: Response;
  raw: string;
  persistGenerationId(_generationId: string): Promise<void>;
}): Promise<PvpGenerationFailureOutcome> => {
  let parsed: unknown = null;
  if (isJsonLike(input.response.headers.get('content-type'), input.raw)) {
    try {
      parsed = JSON.parse(input.raw) as unknown;
    } catch {
      parsed = null;
    }
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const generationId = readDurablePvpGenerationId(input.response, record);
  if (generationId) await input.persistGenerationId(generationId);
  return {
    generationId,
    errorMessage: typeof record?.error === 'string' ? record.error : null,
    shouldRedirect: Boolean(record?.shouldRedirect) || record?.redirect === '/arrested',
    redirectReason: typeof record?.reason === 'string' ? record.reason : null,
  };
};

export type PvpResolutionOwnership =
  | { kind: 'claimed' }
  | { kind: 'resolving' }
  | { kind: 'missing' }
  | { kind: 'conflict' };

export const claimPvpResolutionOwnership = async (input: {
  tryClaim(): Promise<boolean>;
  readPhase(): Promise<string | null>;
}): Promise<PvpResolutionOwnership> => {
  if (await input.tryClaim()) return { kind: 'claimed' };
  const phase = await input.readPhase();
  if (phase === null) return { kind: 'missing' };
  return phase === 'resolving' ? { kind: 'resolving' } : { kind: 'conflict' };
};
