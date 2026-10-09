import { MAX_TAVERN_FILE_BYTES, MAX_TAVERN_TEXT_BYTES, normalizeTavernCard, readTavernLocalDocument, type TavernParseResult } from '@mahoshojo/domain/tavern-card';

export type TavernInputFile = Pick<File, 'name' | 'size' | 'arrayBuffer'>;

export async function readTavernFile(file: TavernInputFile): Promise<{ parsed: TavernParseResult; basePngBytes?: Uint8Array }> {
  if (file.size > MAX_TAVERN_FILE_BYTES) throw new Error('文件超过 32 MiB 上限。');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'png' && extension !== 'json') throw new Error('请选择 PNG 或 JSON 文件。');
  if (extension === 'json' && file.size > MAX_TAVERN_TEXT_BYTES) throw new Error('酒馆 JSON 超过 4 MiB 上限。');
  const document = readTavernLocalDocument(new Uint8Array(await file.arrayBuffer()), extension);
  if (document.parsed) return { parsed: document.parsed, basePngBytes: document.basePngBytes };
  const selected = document.candidates[document.selectedIndex];
  const { normalized, warnings } = normalizeTavernCard(selected);
  const parsed: TavernParseResult = {
    selected, normalized, candidates: document.candidates,
    meta: {
      extractedAt: new Date().toISOString(), sourceChunk: selected.keyword,
      spec: normalized.spec, specVersion: normalized.specVersion, name: normalized.name,
      description: normalized.description, personality: normalized.personality, scenario: normalized.scenario, firstMes: normalized.firstMes, mesExample: normalized.mesExample, tags: normalized.tags,
      warnings: [...document.warnings, ...warnings],
      candidates: document.candidates.map((candidate) => ({ keyword: candidate.keyword, chunkType: candidate.chunkType, parseMethod: candidate.parseMethod, ok: true, name: normalizeTavernCard(candidate).normalized.name })),
    },
  };
  return { parsed, basePngBytes: document.basePngBytes };
}
