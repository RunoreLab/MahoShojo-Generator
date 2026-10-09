import { useRef, useState } from 'react';
import { MAX_TAVERN_TEXT_BYTES } from '@mahoshojo/domain/tavern-card';
import { buildSafeFileName } from '../client';
import type { TavernExportFilePort } from './controls';

/** Web may intentionally omit raw via its existing keepRaw option. */
export interface TavernGeneralProjection {
  templateId: string;
  name: string;
  content: string;
  _tavern?: { raw?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}
export function TavernLocalProjection({ data, disabled, exportFile, saveCard, hideExport = false }: {
  data: TavernGeneralProjection; disabled?: boolean; hideExport?: boolean; exportFile: TavernExportFilePort;
  saveCard: (data: TavernGeneralProjection) => Promise<'saved' | 'already-present'>;
}) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ data: TavernGeneralProjection; text: string } | null>(null);
  async function run(save: boolean) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setNotice(null);
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(data));
      if (bytes.length > MAX_TAVERN_TEXT_BYTES) throw new Error('通用卡连同原件超过 4 MiB 本地往返上限，请先导出酒馆原件。');
      if (save) {
        const outcome = await saveCard(data);
        setNotice({ data, text: outcome === 'saved' ? '已保存到本地卡库（未签名导入）。' : '本地已有相同内容，未覆盖已有记录。' });
      } else {
        await exportFile({ name: buildSafeFileName(data.name, 'json', 'character'), bytes, mimeType: 'application/json' });
        setNotice({ data, text: '已发起下载，请在系统下载界面确认保存。' });
      }
    } catch (error) { setNotice({ data, text: error instanceof Error ? error.message : '保存失败，原件仍保留，可重试。' }); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
    <div className="text-sm font-semibold text-pink-700">通用角色（规则映射）</div>
    <p className="mt-2 text-xs text-gray-600">正文仅映射描述、性格、场景、开场白、对话样例与标签。世界书、脚本、系统提示和其他扩展不会在通用卡中执行；{data._tavern?.raw !== undefined ? '完整原件保留在 _tavern.raw。' : '未保留完整原件；未映射字段不会出现在转换结果中。'}转换结果未签名，原件签名不适用于新正文。修改通用卡不会自动同步到酒馆原件。</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {!hideExport ? <button type="button" disabled={disabled || busy} onClick={() => void run(false)} className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-sm text-pink-700 disabled:opacity-50">下载通用卡 JSON</button> : null}
      <button type="button" disabled={disabled || busy} onClick={() => void run(true)} className="rounded-xl bg-pink-600 px-4 py-2 text-sm text-white disabled:opacity-50">保存通用卡到本地库</button>
    </div>
    {notice?.data === data ? <p role="status" className="mt-2 text-xs text-gray-700">{notice.text}</p> : null}
  </div>;
}
