import { decodeBase64ToBytes } from './base64';
import { extractPngTextChunks, parsePngChunkRanges } from './png';
import { isLikelyTavernCard, normalizeTavernCard } from './normalize';
import type {
  PngTextChunk,
  TavernCardCandidate,
  TavernChunkType,
  TavernImportMeta,
  TavernParseError,
  TavernParseErrorCode,
  TavernParseResult,
} from './types';

interface TavernCardCandidateWithSize extends TavernCardCandidate {
  payloadChars: number;
}

const safeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asLikelySpecVersion = (value: unknown): string | undefined => {
  const raw = safeString(value);
  if (raw) return raw;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const getCandidateSpecInfo = (candidate: TavernCardCandidate): { spec?: string; specVersion?: string; name?: string } => {
  const normalized = normalizeTavernCard(candidate).normalized;
  return {
    spec: normalized.spec,
    specVersion: normalized.specVersion,
    name: normalized.name,
  };
};

const createParseError = (
  code: TavernParseErrorCode,
  message: string,
  details?: Record<string, unknown>
): TavernParseError => ({ code, message, details });

const detectUnsupportedCompressedTextChunks = (bytes: Uint8Array): string[] => {
  const warnings: string[] = [];
  let ranges: ReturnType<typeof parsePngChunkRanges>;
  try {
    ranges = parsePngChunkRanges(bytes);
  } catch {
    return warnings;
  }

  for (const range of ranges) {
    if (range.type === 'zTXt') {
      warnings.push('检测到 zTXt 压缩文本块：当前版本未启用解压支持，已忽略。');
      continue;
    }
    if (range.type !== 'iTXt') continue;
    const data = bytes.subarray(range.dataStart, range.dataEnd);
    const nullIndex = data.indexOf(0);
    if (nullIndex <= 0) continue;
    const compressionFlag = data[nullIndex + 1];
    if (compressionFlag === 1) warnings.push('检测到 iTXt 压缩文本块：当前版本未启用解压支持，已忽略。');
  }

  return warnings;
};

export function parseTavernCandidates(chunks: PngTextChunk[]): TavernCardCandidate[] {
  const candidates: TavernCardCandidateWithSize[] = [];

  for (const chunk of chunks) {
    const payloadChars = chunk.text.length;
    const text = chunk.text;
    if (!text) continue;

    let parsed: unknown;
    let parseMethod: TavernCardCandidate['parseMethod'] = 'base64-json';

    try {
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(decodeBase64ToBytes(text));
      parsed = JSON.parse(decoded);
      parseMethod = 'base64-json';
    } catch {
      try {
        parsed = JSON.parse(text);
        parseMethod = 'json';
      } catch {
        continue;
      }
    }

    if (!isLikelyTavernCard(parsed)) continue;

    candidates.push({
      keyword: chunk.keyword,
      chunkType: chunk.chunkType,
      parseMethod,
      parsed,
      payloadChars,
    });
  }

  return candidates;
}

export function selectBestTavernCandidate(
  candidates: TavernCardCandidate[]
): { selected: TavernCardCandidate; warnings: string[] } {
  if (!candidates || candidates.length === 0) {
    throw createParseError('NO_TAVERN_CARD_FOUND', '未能在 PNG 文本块中识别到 SillyTavern 角色卡。');
  }

  const warnings: string[] = [];

  const scoreKeyword = (keyword: string): number => {
    if (keyword === 'ccv3') return 1000;
    if (keyword === 'chara') return 900;
    return 0;
  };

  const parseSpecVersionNumber = (value: string | undefined): number => {
    if (!value) return 0;
    const num = Number.parseFloat(value);
    return Number.isFinite(num) ? num : 0;
  };

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const info = getCandidateSpecInfo(candidate);
    const specScore = parseSpecVersionNumber(info.specVersion) * 10;
    const keywordScore = scoreKeyword(candidate.keyword);
    const candidateWithSize = candidate as Partial<TavernCardCandidateWithSize>;
    const payloadChars = typeof candidateWithSize.payloadChars === 'number' ? candidateWithSize.payloadChars : undefined;
    const sizeScore = payloadChars ? Math.min(100, Math.log10(Math.max(10, payloadChars)) * 10) : 0;

    const total = keywordScore + specScore + sizeScore + i / 10000;
    if (total >= bestScore) {
      bestScore = total;
      bestIndex = i;
    }
  }

  const selected = candidates[bestIndex];

  const ccv3 = candidates.find((item) => item.keyword === 'ccv3');
  const chara = candidates.find((item) => item.keyword === 'chara');
  if (ccv3 && chara) {
    const ccv3Info = getCandidateSpecInfo(ccv3);
    const charaInfo = getCandidateSpecInfo(chara);
    if (
      safeString(ccv3Info.spec) !== safeString(charaInfo.spec) ||
      asLikelySpecVersion(ccv3Info.specVersion) !== asLikelySpecVersion(charaInfo.specVersion) ||
      safeString(ccv3Info.name) !== safeString(charaInfo.name)
    ) {
      warnings.push('检测到多个块（ccv3/chara）关键信息不一致：建议手动切换预览后再导入。');
    }
  }

  if (selected.keyword !== 'ccv3' && candidates.some((item) => item.keyword === 'ccv3')) {
    warnings.push('未选择 ccv3 块作为来源（可能因为解析失败或内容不完整）。');
  }

  return { selected, warnings };
}

const buildCandidatesMeta = (chunks: PngTextChunk[]): TavernImportMeta['candidates'] => {
  const meta: TavernImportMeta['candidates'] = [];

  for (const chunk of chunks) {
    const payloadChars = chunk.text.length;
    let parsed: unknown;
    let ok = false;
    let parseMethod: TavernCardCandidate['parseMethod'] = 'base64-json';

    try {
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(decodeBase64ToBytes(chunk.text));
      parsed = JSON.parse(decoded);
      parseMethod = 'base64-json';
      ok = isLikelyTavernCard(parsed);
    } catch {
      try {
        parsed = JSON.parse(chunk.text);
        parseMethod = 'json';
        ok = isLikelyTavernCard(parsed);
      } catch {
        ok = false;
      }
    }

    let spec: string | undefined;
    let specVersion: string | undefined;
    let name: string | undefined;
    if (ok) {
      const info = getCandidateSpecInfo({
        keyword: chunk.keyword,
        chunkType: chunk.chunkType,
        parseMethod,
        parsed,
      });
      spec = info.spec;
      specVersion = info.specVersion;
      name = info.name;
    }

    meta.push({
      keyword: chunk.keyword,
      chunkType: chunk.chunkType,
      parseMethod,
      ok,
      spec,
      specVersion,
      name,
      sizeChars: payloadChars,
    });
  }

  return meta;
};

export function parseTavernCardFromPngBytes(bytes: Uint8Array): TavernParseResult | TavernParseError {
  try {
    const warnings: string[] = [];
    warnings.push(...detectUnsupportedCompressedTextChunks(bytes));

    const chunks = extractPngTextChunks(bytes);
    if (chunks.length === 0) {
      return createParseError('NO_TEXT_CHUNKS', 'PNG 内未找到可读取的文本块（tEXt/iTXt）。');
    }

    const candidates = parseTavernCandidates(chunks);
    if (candidates.length === 0) {
      return createParseError('NO_TAVERN_CARD_FOUND', '未能在 PNG 文本块中识别到 SillyTavern 角色卡。', {
        chunks: chunks.map((item) => ({ keyword: item.keyword, chunkType: item.chunkType, sizeChars: item.text.length })),
      });
    }

    let selected: TavernCardCandidate;
    let selectWarnings: string[] = [];
    try {
      const selection = selectBestTavernCandidate(candidates);
      selected = selection.selected;
      selectWarnings = selection.warnings;
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error) {
        return error as TavernParseError;
      }
      return createParseError('NO_TAVERN_CARD_FOUND', '未能选择一个可用的 SillyTavern 角色卡候选。');
    }

    const normalizedResult = normalizeTavernCard(selected);
    warnings.push(...selectWarnings, ...normalizedResult.warnings);

    const candidatesMeta = buildCandidatesMeta(chunks);
    const selectedMeta = candidatesMeta.find(
      (item) => item.keyword === selected.keyword && item.chunkType === (selected.chunkType as TavernChunkType) && item.ok
    );

    const meta: TavernImportMeta = {
      extractedAt: new Date().toISOString(),
      sourceChunk: selected.keyword,
      spec: normalizedResult.normalized.spec,
      specVersion: normalizedResult.normalized.specVersion,
      name: normalizedResult.normalized.name,
      description: normalizedResult.normalized.description,
      personality: normalizedResult.normalized.personality,
      scenario: normalizedResult.normalized.scenario,
      firstMes: normalizedResult.normalized.firstMes,
      mesExample: normalizedResult.normalized.mesExample,
      tags: normalizedResult.normalized.tags,
      candidates: candidatesMeta,
      warnings,
      sizes: {
        pngBytes: bytes.length,
        selectedPayloadChars: selectedMeta?.sizeChars,
      },
    };

    return {
      normalized: normalizedResult.normalized,
      meta,
      candidates,
      selected,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'NOT_PNG') {
      return createParseError('NOT_PNG', '文件不是 PNG。');
    }
    if (message === 'PNG_SIGNATURE_MISMATCH') {
      return createParseError('PNG_SIGNATURE_MISMATCH', 'PNG 签名不匹配，可能是伪装的文件。');
    }
    if (message === 'PNG_TRUNCATED') {
      return createParseError('PNG_TRUNCATED', 'PNG 文件不完整或已损坏。');
    }
    return createParseError('PAYLOAD_DECODE_FAILED', '解析 PNG 失败。', { message });
  }
}

export async function parseTavernCardFromPngFile(file: File): Promise<TavernParseResult | TavernParseError> {
  if (!file) return createParseError('NOT_PNG', '未选择文件。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseTavernCardFromPngBytes(bytes);
}
