import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import { parseGameCardForgeImport, serializeGameCardForgeDocument, type GameCardForgeRuntimeState } from '@mahoshojo/domain/card-forge-document';
import { decodeForgeDataUrl, validateForgeImage, FORGE_JSON_MAX_BYTES } from './local-media';

export type LocalForgeSource = { original: Uint8Array; name: string; state: GameCardForgeRuntimeState; warning: string };
export async function readLocalForgeDocument(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<LocalForgeSource> {
  if (file.size > FORGE_JSON_MAX_BYTES) throw new Error('JSON 超过本地 32 MiB 上限；未读取或替换当前卡面。');
  const original = new Uint8Array(await file.arrayBuffer());
  if (original.length > FORGE_JSON_MAX_BYTES) throw new Error('JSON 超过本地 32 MiB 上限。');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(original).replace(/^\uFEFF/, '');
  const value: unknown = JSON.parse(text);
  if (!SafeJsonValueSchema.safeParse(value).success) throw new Error('JSON 结构过深、节点过多或包含不安全字段，未替换当前卡面。');
  const state = parseGameCardForgeImport(value);
  let warning = '';
  if (state.imageUrl) {
    const embedded = decodeForgeDataUrl(state.imageUrl);
    if (embedded) state.imageUrl = await validateForgeImage(embedded.bytes);
    else {
      state.imageUrl = null;
      state.imageSource = null;
      warning = '原文件图片未加载：仅允许经过校验的内嵌静态 PNG / JPEG / WebP。可选择本地插图；原始图片地址仍完整保留在原件中。';
    }
  }
  return { original, name: file.name, state, warning };
}
export function exportLocalForgeDocument(state: GameCardForgeRuntimeState): string {
  if (!SafeJsonValueSchema.safeParse(state).success) throw new Error('卡面结构超过本地 JSON 安全预算，未截断内容。');
  const json = serializeGameCardForgeDocument({ ...state, imageDataUrl: state.imageUrl });
  if (new TextEncoder().encode(json).byteLength > FORGE_JSON_MAX_BYTES) throw new Error('格式化后的工坊 JSON 超过 32 MiB，未截断内容；请缩小插图或导出原件。');
  return json;
}
