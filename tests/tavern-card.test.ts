import { describe, expect, it } from 'bun:test';
import { zlibSync } from 'fflate';

import {
  createTavernV3Card,
  extractPngTextChunks,
  getPlaceholderPngBytes,
  parseTavernCardFromPngBytes,
  writeTavernCardToPngBytes,
} from '@/lib/tavern-card';
import { encodeBytesToBase64 } from '@/lib/tavern-card/base64';
import { crc32Concat } from '@/lib/tavern-card/crc32';
import { parsePngChunkRanges } from '@/lib/tavern-card/png';

const encodeAscii = (value: string): Uint8Array => {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
  return out;
};

const buildPngChunkBytes = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = encodeAscii(type);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32Concat([typeBytes, data]), false);
  return out;
};

const insertChunkBeforeIend = (bytes: Uint8Array, chunkBytes: Uint8Array): Uint8Array => {
  const ranges = parsePngChunkRanges(bytes);
  const iend = ranges.find((range) => range.type === 'IEND');
  if (!iend) throw new Error('PNG 缺少 IEND 块');

  const out = new Uint8Array(bytes.length + chunkBytes.length);
  out.set(bytes.subarray(0, iend.start), 0);
  out.set(chunkBytes, iend.start);
  out.set(bytes.subarray(iend.start), iend.start + chunkBytes.length);
  return out;
};

describe('tavern-card', () => {
  it('parses repo sample and prefers ccv3', async () => {
    const bytes = new Uint8Array(await Bun.file('docs/雪沫（酒馆角色卡测试）.png').arrayBuffer());
    const result = parseTavernCardFromPngBytes(bytes);
    if ('code' in result) {
      throw new Error(`解析失败：${result.code} ${result.message}`);
    }

    expect(result.selected.keyword).toBe('ccv3');
    expect(result.normalized.spec).toBe('chara_card_v3');
    expect(result.normalized.specVersion).toBe('3.0');
    expect(typeof result.normalized.name).toBe('string');
    expect(result.normalized.name.length).toBeGreaterThan(0);
  });

  it('parses compressed iTXt/zTXt chunks', () => {
    const card = createTavernV3Card({
      name: '压缩测试',
      description: '这是一个用于压缩块解析测试的角色。',
    });
    const base64 = encodeBytesToBase64(new TextEncoder().encode(JSON.stringify(card)));

    const ztxtPayload = (() => {
      const keyword = encodeAscii('ccv3');
      const compressed = zlibSync(new TextEncoder().encode(base64));
      const data = new Uint8Array(keyword.length + 2 + compressed.length);
      data.set(keyword, 0);
      data[keyword.length] = 0;
      data[keyword.length + 1] = 0;
      data.set(compressed, keyword.length + 2);
      return buildPngChunkBytes('zTXt', data);
    })();

    const itxtPayload = (() => {
      const keyword = encodeAscii('chara');
      const compressed = zlibSync(new TextEncoder().encode(base64));
      const data = new Uint8Array(keyword.length + 5 + compressed.length);
      data.set(keyword, 0);
      data[keyword.length] = 0;
      data[keyword.length + 1] = 1;
      data[keyword.length + 2] = 0;
      data[keyword.length + 3] = 0;
      data[keyword.length + 4] = 0;
      data.set(compressed, keyword.length + 5);
      return buildPngChunkBytes('iTXt', data);
    })();

    let bytes = getPlaceholderPngBytes();
    bytes = insertChunkBeforeIend(bytes, ztxtPayload);
    bytes = insertChunkBeforeIend(bytes, itxtPayload);

    const chunks = extractPngTextChunks(bytes);
    const ztxt = chunks.find((chunk) => chunk.chunkType === 'zTXt' && chunk.keyword === 'ccv3');
    const itxt = chunks.find((chunk) => chunk.chunkType === 'iTXt' && chunk.keyword === 'chara');
    expect(ztxt?.text).toBe(base64);
    expect(itxt?.text).toBe(base64);

    const parsed = parseTavernCardFromPngBytes(bytes);
    if ('code' in parsed) {
      throw new Error(`读回失败：${parsed.code} ${parsed.message}`);
    }
    expect(parsed.selected.keyword).toBe('ccv3');
    expect(parsed.normalized.name).toBe('压缩测试');
  });

  it('writes placeholder png and reads it back', () => {
    const base = getPlaceholderPngBytes();
    const card = createTavernV3Card({
      name: '测试角色',
      description: '这是一个用于导出测试的角色。',
      personality: '沉静、克制，但在关键时刻会果断出手。',
      scenario: '夜晚的街角小酒馆，雨声与霓虹交织。',
      first_mes: '（她抬起眼，像是早就知道你会来。）',
      mes_example: '你：你是谁？\\n她：只是一个路过的人。',
      tags: ['测试', '魔法少女'],
      creator_notes: '来源：MahoShojo-Generator（测试）',
    });

    const outBytes = writeTavernCardToPngBytes(base, card, { overwriteExisting: true, includeCcv3Chunk: true, includeCharaChunk: true });
    const parsed = parseTavernCardFromPngBytes(outBytes);
    if ('code' in parsed) {
      throw new Error(`读回失败：${parsed.code} ${parsed.message}`);
    }

    expect(parsed.selected.keyword).toBe('ccv3');
    expect(parsed.normalized.name).toBe('测试角色');
    expect(parsed.normalized.description).toContain('导出测试');
  });

  it('overwrites existing ccv3/chara blocks by default', async () => {
    const base = new Uint8Array(await Bun.file('docs/雪沫（酒馆角色卡测试）.png').arrayBuffer());
    const card = createTavernV3Card({
      name: '覆盖测试',
      description: '覆盖已有块。',
      creator_notes: '覆盖测试',
    });

    const outBytes = writeTavernCardToPngBytes(base, card, { overwriteExisting: true, includeCcv3Chunk: true, includeCharaChunk: true });
    const chunks = extractPngTextChunks(outBytes);
    const ccv3Count = chunks.filter((chunk) => chunk.chunkType === 'tEXt' && chunk.keyword === 'ccv3').length;
    const charaCount = chunks.filter((chunk) => chunk.chunkType === 'tEXt' && chunk.keyword === 'chara').length;
    expect(ccv3Count).toBe(1);
    expect(charaCount).toBe(1);

    const parsed = parseTavernCardFromPngBytes(outBytes);
    if ('code' in parsed) {
      throw new Error(`读回失败：${parsed.code} ${parsed.message}`);
    }
    expect(parsed.normalized.name).toBe('覆盖测试');
  });
});
