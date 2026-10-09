import { useId, useRef, useState } from 'react';
import { getPlaceholderPngBytes, normalizeTavernCard, validateTavernRaw, writeTavernCardToPngBytes, type TavernCardCandidate } from '@mahoshojo/domain/tavern-card';
import { buildSafeFileName } from '../client';

export function TavernFileInput({ disabled, onFileSelected }: { disabled?: boolean; onFileSelected: (file: File | null) => void }) {
  const id = useId();
  return <div className="input-group mt-4">
    <label className="input-label" htmlFor={id}>上传 SillyTavern 角色卡 PNG / JSON</label>
    <input id={id} type="file" accept="image/png,.png,application/json,.json"
      className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={disabled} onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = ''; onFileSelected(file); }} />
  </div>;
}

export function TavernCandidateSelector({ candidates, selectedIndex, disabled, onSelect }: {
  candidates: TavernCardCandidate[]; selectedIndex: number; disabled?: boolean; onSelect: (index: number) => void;
}) {
  const name = useId();
  return <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
    <div className="text-sm font-semibold text-pink-700">候选来源块</div>
    <div className="mt-2 grid grid-cols-1 gap-2">{candidates.map((candidate, index) => {
      const info = normalizeTavernCard(candidate).normalized;
      return <label key={`${candidate.keyword}-${candidate.chunkType}-${index}`} className="flex cursor-pointer items-start gap-2 rounded-lg border border-pink-100 bg-white/70 p-2 hover:bg-pink-50">
        <input type="radio" name={name} checked={selectedIndex === index} disabled={disabled} onChange={() => onSelect(index)} className="mt-1" />
        <div className="min-w-0"><div className="text-sm text-gray-900"><span className="font-semibold">{candidate.keyword}</span>
          <span className="ml-2 text-xs text-gray-600">{candidate.chunkType} · {candidate.parseMethod}{info.spec ? ` · ${info.spec}` : ''}{info.specVersion ? `@${info.specVersion}` : ''}</span></div>
          <div className="text-xs text-gray-700">name：{info.name}</div></div>
      </label>;
    })}</div>
  </div>;
}

export interface TavernExportFile { name: string; bytes: Uint8Array; mimeType: string }
export type TavernExportFilePort = (file: TavernExportFile) => void | Promise<void>;

export function TavernOriginalExport({ candidate, basePngBytes, disabled, exportFile }: {
  candidate: TavernCardCandidate; basePngBytes?: Uint8Array; disabled?: boolean; exportFile: TavernExportFilePort;
}) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ candidate: TavernCardCandidate; text: string } | null>(null);
  const selectedRef = useRef(candidate); selectedRef.current = candidate;
  async function run(format: 'json' | 'png') {
    if (busyRef.current || disabled) return;
    busyRef.current = true; setBusy(true); setStatus(null);
    const selected = candidate;
    try {
      const raw = validateTavernRaw(selected.parsed);
      const name = normalizeTavernCard(selected).normalized.name;
      const bytes = format === 'json' ? new TextEncoder().encode(JSON.stringify(raw)) : writeTavernCardToPngBytes(basePngBytes ?? getPlaceholderPngBytes(), raw);
      await exportFile({ name: buildSafeFileName(name, format, 'tavern'), bytes, mimeType: format === 'json' ? 'application/json' : 'image/png' });
      if (selectedRef.current === selected) setStatus({ candidate: selected, text: '已发起下载，请在系统下载界面确认保存。' });
    } catch { if (selectedRef.current === selected) setStatus({ candidate: selected, text: '导出失败或文件超限，原件仍保留；可尝试导出 JSON。' }); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
    <div className="text-sm font-semibold text-pink-700">酒馆原件与 PNG 导出</div>
    <p className="mt-2 text-xs text-gray-600">保留所选候选的未知字段；不验证签名或赋予官方来源。PNG 保留原图和其他元数据，ccv3/chara 块统一为所选候选。JSON 不含原图；没有底图时使用占位图。</p>
    <div className="mt-3 flex flex-wrap gap-2">{(['json', 'png'] as const).map((format) => <button key={format} type="button" disabled={disabled || busy} className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-sm text-pink-700 disabled:opacity-50" onClick={() => void run(format)}>{format === 'json' ? '导出原件 JSON' : '导出酒馆 PNG'}</button>)}</div>
    {status?.candidate === candidate ? <p role="status" className="mt-2 text-xs text-gray-600">{status.text}</p> : null}
  </div>;
}
