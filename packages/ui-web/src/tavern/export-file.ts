import { SafeJsonValueSchema, type JsonValue } from '@mahoshojo/contracts/json-value';
import { MAX_TAVERN_FILE_BYTES, MAX_TAVERN_TEXT_BYTES, parsePngChunkRanges } from '@mahoshojo/domain/tavern-card';
import type { TavernInputFile } from './file';

/** Size is checked before I/O and again after I/O, including custom library file adapters. */
export async function readTavernSourceJson(file: TavernInputFile): Promise<JsonValue> {
  if (file.size > MAX_TAVERN_TEXT_BYTES) throw new Error('源 JSON 超过 4 MiB 上限。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_TAVERN_TEXT_BYTES) throw new Error('源 JSON 超过 4 MiB 上限。');
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const parsed = SafeJsonValueSchema.safeParse(value);
  if (!parsed.success || typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) throw new Error('请选择安全有效的数据卡 JSON 对象。');
  return parsed.data;
}

export async function readTavernBasePng(file: TavernInputFile): Promise<Uint8Array> {
  if (file.size > MAX_TAVERN_FILE_BYTES) throw new Error('PNG 超过 32 MiB 上限。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_TAVERN_FILE_BYTES) throw new Error('PNG 超过 32 MiB 上限。');
  parsePngChunkRanges(bytes);
  return bytes;
}
