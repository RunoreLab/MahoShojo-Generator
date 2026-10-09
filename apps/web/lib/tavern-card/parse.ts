import { parseTavernCardFromPngBytes } from '@mahoshojo/domain/tavern-card';
import type { TavernParseResult, TavernParseError } from './types';
export { parseTavernCandidates, selectBestTavernCandidate, parseTavernCardFromPngBytes } from '@mahoshojo/domain/tavern-card';
export async function parseTavernCardFromPngFile(file: File): Promise<TavernParseResult | TavernParseError> {
  if (!file) return { code: 'NOT_PNG', message: '未选择文件。' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseTavernCardFromPngBytes(bytes);
}
