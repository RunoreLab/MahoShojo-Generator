import { ARENA_PRESET_AUTHORITY } from './generated/arena-preset-authority';

type VerifySignature = (_value: unknown) => Promise<boolean>;

const unsafeKeys = new Set(['__proto__', 'constructor']);

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('preset contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') throw new Error('preset is not JSON');
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (unsafeKeys.has(key)) throw new Error(`preset contains unsafe key: ${key}`);
    output[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return output;
};

const sha256VersionToken = async (value: unknown): Promise<string | null> => {
  try {
    const canonicalJson = JSON.stringify(canonicalize(value));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson));
    return `sha256:${Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')}`;
  } catch {
    return null;
  }
};

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
);

export const isCanonicalArenaCharacterPreset = async (value: unknown): Promise<boolean> => {
  const combatant = recordOf(value);
  if (!combatant || combatant.isPreset !== true || typeof combatant.filename !== 'string') {
    return false;
  }
  const authority = ARENA_PRESET_AUTHORITY.find((entry) => (
    entry.kind === 'character' && entry.id === combatant.filename
  ));
  if (!authority) return false;
  return await sha256VersionToken(combatant.data) === authority.versionToken;
};

/**
 * Resolves native authority from server-owned evidence only.
 * Exact bundled presets use their generated digest; all other cards must pass
 * the normal signature verifier. The caller-provided `isNative` flag is ignored.
 */
export const resolveArenaCombatantNativeAuthority = async (
  value: unknown,
  verifySignature: VerifySignature,
): Promise<boolean> => {
  if (await isCanonicalArenaCharacterPreset(value)) return true;
  return verifySignature(recordOf(value)?.data);
};
