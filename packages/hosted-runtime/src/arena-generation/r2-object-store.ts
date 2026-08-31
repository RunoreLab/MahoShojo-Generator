import { AwsClient } from 'aws4fetch';

import type { ArenaGenerationObjectStore } from './d1-finalization';

type R2Environment = Readonly<Record<string, string | undefined>>;

type AwsSigner = Pick<AwsClient, 'sign'>;

export type CreateArenaR2ObjectStoreOptions = {
  env?: R2Environment;
  fetch?: typeof fetch;
  signer?: AwsSigner;
};

const value = (env: R2Environment, key: string): string | null => env[key]?.trim() || null;

const encodeKey = (key: string): string => key
  .replace(/^\/+/, '')
  .split('/')
  .map((part) => encodeURIComponent(part))
  .join('/');

const gzipText = async (text: string): Promise<{
  body: ArrayBuffer;
  contentEncoding: string | null;
}> => {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream !== 'function') {
    return {
      body: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
      contentEncoding: null,
    };
  }
  const compressed = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  return {
    body: await new Response(compressed).arrayBuffer(),
    contentEncoding: 'gzip',
  };
};

export const createArenaR2ObjectStoreFromEnvironment = (
  options: CreateArenaR2ObjectStoreOptions = {},
): ArenaGenerationObjectStore | null => {
  const env = options.env ?? (typeof process === 'undefined' ? {} : process.env);
  const accessKeyId = value(env, 'R2_ACCESS_KEY_ID');
  const secretAccessKey = value(env, 'R2_SECRET_ACCESS_KEY');
  const bucket = value(env, 'R2_BUCKET_NAME');
  const accountId = value(env, 'R2_ACCOUNT_ID')
    ?? value(env, 'CF_ACCOUNT_ID')
    ?? value(env, 'CLOUDFLARE_ACCOUNT_ID');
  const endpoint = value(env, 'R2_ENDPOINT')
    ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) return null;
  const signer = options.signer ?? new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: 'auto',
    service: 's3',
  });
  const fetcher = options.fetch ?? globalThis.fetch;
  const objectUrl = (key: string): string => `${endpoint}/${encodeURIComponent(bucket)}/${encodeKey(key)}`;

  return Object.freeze({
    async put(input) {
      const rawBytes = new TextEncoder().encode(input.body).byteLength;
      const compressed = await gzipText(input.body);
      const headers = new Headers({
        'Cache-Control': 'private, max-age=0, no-store',
        'Content-Type': input.contentType,
        'x-amz-meta-generation-id': input.key.split('/').at(-2) ?? 'unknown',
        'x-amz-meta-kind': 'battle_report_generation_output',
      });
      if (compressed.contentEncoding) headers.set('Content-Encoding', compressed.contentEncoding);
      const signed = await signer.sign(objectUrl(input.key), {
        method: 'PUT',
        headers,
        body: compressed.body,
      });
      const response = await fetcher(signed, { signal: input.signal });
      if (!response.ok) throw new Error(`ARENA_R2_PUT_FAILED_${response.status}`);
      return {
        bytes: rawBytes,
        storedBytes: compressed.body.byteLength,
        contentEncoding: compressed.contentEncoding,
      };
    },

    async getText(key) {
      const signed = await signer.sign(objectUrl(key), { method: 'GET' });
      const response = await fetcher(signed.url, signed);
      if (response.status === 404) return { kind: 'not-found' };
      if (!response.ok) throw new Error(`ARENA_R2_GET_FAILED_${response.status}`);
      return { kind: 'found', text: await response.text() };
    },
  });
};
