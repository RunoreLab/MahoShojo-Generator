export type SignatureSanitizationOptions = {
  ignoreKeys?: string[];
  ignoreKeyPrefixes?: string[];
};

export type GenerateSignatureOptions = {
  sanitizeIgnoredKeys?: boolean;
};

export type VerifySignatureOptions = {
  acceptSanitizedPayload?: boolean;
};

export type SigningKey = Parameters<typeof globalThis.crypto.subtle.sign>[1];

export type SignatureService = {
  generateSignature(_data: object, _options?: GenerateSignatureOptions): Promise<string | null>;
  verifySignature(
    _dataWithSignature: unknown,
    _options?: VerifySignatureOptions,
  ): Promise<boolean>;
};

export type SignatureServicePorts = {
  getSigningKey(): Promise<SigningKey | null>;
  subtle?: typeof globalThis.crypto.subtle;
};

type StripResult<T> = {
  value: T;
  changed: boolean;
};

type SignaturePayload = {
  signatures: string[];
  candidates: object[];
};

const DEFAULT_SANITIZATION_OPTIONS: Required<SignatureSanitizationOptions> = {
  ignoreKeys: [],
  ignoreKeyPrefixes: ['_'],
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const extractSignaturePayload = (dataWithSignature: unknown): SignaturePayload | null => {
  if (!isObjectRecord(dataWithSignature)) return null;

  const topSignature =
    typeof dataWithSignature.signature === 'string' ? dataWithSignature.signature : null;
  const metadataSignature =
    isObjectRecord(dataWithSignature.metadata) && typeof dataWithSignature.metadata.signature === 'string'
      ? dataWithSignature.metadata.signature
      : null;

  if (!topSignature && !metadataSignature) return null;

  const dataWithoutSignature = { ...dataWithSignature };
  delete dataWithoutSignature.signature;
  const candidates: object[] = [dataWithoutSignature];

  if (
    metadataSignature &&
    isObjectRecord(dataWithoutSignature.metadata) &&
    'signature' in dataWithoutSignature.metadata
  ) {
    const nextMetadata = { ...dataWithoutSignature.metadata };
    delete nextMetadata.signature;
    candidates.push({ ...dataWithoutSignature, metadata: nextMetadata });
  }

  const signatures: string[] = [];
  if (topSignature) signatures.push(topSignature);
  if (metadataSignature && metadataSignature !== topSignature) signatures.push(metadataSignature);

  return { signatures, candidates };
};

const shouldIgnoreKey = (
  key: string,
  options: Required<SignatureSanitizationOptions>,
): boolean => {
  if (options.ignoreKeys.includes(key)) return true;
  return options.ignoreKeyPrefixes.some((prefix) => key.startsWith(prefix));
};

const stripIgnoredKeysDeep = <T>(
  input: T,
  options: Required<SignatureSanitizationOptions>,
): StripResult<T> => {
  if (Array.isArray(input)) {
    let changed = false;
    const result = input.map((item) => {
      const child = stripIgnoredKeysDeep(item, options);
      changed ||= child.changed || child.value !== item;
      return child.value;
    });

    return changed
      ? { value: result as T, changed: true }
      : { value: input, changed: false };
  }

  if (isObjectRecord(input)) {
    let changed = false;
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      if (shouldIgnoreKey(key, options)) {
        changed = true;
        continue;
      }

      const child = stripIgnoredKeysDeep(value, options);
      changed ||= child.changed || child.value !== value;
      result[key] = child.value;
    }

    return changed
      ? { value: result as T, changed: true }
      : { value: input, changed: false };
  }

  return { value: input, changed: false };
};

const sortObjectKeys = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortObjectKeys);

  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
    result[key] = sortObjectKeys(record[key]);
  }
  return result;
};

const canonicalBytes = (
  data: object,
  options: GenerateSignatureOptions,
): Uint8Array<ArrayBuffer> => {
  const dataToSign = { ...data } as Record<string, unknown>;
  delete dataToSign.signature;

  const target =
    (options.sanitizeIgnoredKeys ?? true)
      ? stripIgnoredKeysDeep(dataToSign, DEFAULT_SANITIZATION_OPTIONS).value
      : dataToSign;
  const serialized = JSON.stringify(sortObjectKeys(target));
  return new TextEncoder().encode(serialized);
};

const bytesToHex = (buffer: ArrayBuffer): string => {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const hexToBytes = (value: string): Uint8Array<ArrayBuffer> | null => {
  // HMAC-SHA-256 is exactly 32 bytes. Reject before allocating so untrusted
  // signatures cannot turn verification into an input-sized memory operation.
  if (value.length !== 64 || !/^[0-9a-f]{64}$/.test(value)) return null;

  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
};

export const createSignatureService = ({
  getSigningKey,
  subtle = globalThis.crypto.subtle,
}: SignatureServicePorts): SignatureService => {
  const generateSignature = async (
    data: object,
    options: GenerateSignatureOptions = {},
  ): Promise<string | null> => {
    const key = await getSigningKey();
    if (!key) return null;

    const signature = await subtle.sign('HMAC', key, canonicalBytes(data, options));
    return bytesToHex(signature);
  };

  const verifySignature = async (
    dataWithSignature: unknown,
    options: VerifySignatureOptions = {},
  ): Promise<boolean> => {
    const key = await getSigningKey();
    if (!key) return false;

    const payload = extractSignaturePayload(dataWithSignature);
    if (!payload) return false;

    const candidates = [...payload.candidates];
    if (options.acceptSanitizedPayload !== false) {
      for (const candidate of payload.candidates) {
        const sanitized = stripIgnoredKeysDeep(candidate, DEFAULT_SANITIZATION_OPTIONS);
        if (sanitized.changed) candidates.push(sanitized.value);
      }
    }

    const signatureBytes = payload.signatures
      .map(hexToBytes)
      .filter((value): value is Uint8Array<ArrayBuffer> => value !== null);

    for (const candidate of candidates) {
      const canonicalOptions = options.acceptSanitizedPayload === false
        ? [{ sanitizeIgnoredKeys: false }]
        : [{ sanitizeIgnoredKeys: true }, { sanitizeIgnoredKeys: false }];
      for (const canonicalOption of canonicalOptions satisfies GenerateSignatureOptions[]) {
        const data = canonicalBytes(candidate, canonicalOption);
        for (const signature of signatureBytes) {
          if (await subtle.verify('HMAC', key, signature, data)) return true;
        }
      }
    }

    return false;
  };

  return Object.freeze({ generateSignature, verifySignature });
};
