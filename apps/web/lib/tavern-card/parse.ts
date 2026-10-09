import { MAX_TAVERN_FILE_BYTES, parseTavernCardFromPngBytes } from '@mahoshojo/domain/tavern-card';
import type { TavernParseResult, TavernParseError } from './types';
export { parseTavernCandidates, selectBestTavernCandidate, parseTavernCardFromPngBytes } from '@mahoshojo/domain/tavern-card';
export async function parseTavernCardFromPngFile(file: File): Promise<TavernParseResult | TavernParseError> {
  if (!file) return { code: 'NOT_PNG', message: '未选择文件。' };
  if (file.size > MAX_TAVERN_FILE_BYTES) return { code: 'PAYLOAD_DECODE_FAILED', message: '文件超过 32 MiB 本地解析上限。' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseTavernCardFromPngBytes(bytes);
}
