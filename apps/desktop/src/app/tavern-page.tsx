import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useRouter } from '@tanstack/react-router';
import { convertTavernToGeneralCard, normalizeTavernCard, type TavernParseResult } from '@mahoshojo/domain/tavern-card';
import { TavernTabs, TavernTabPanels, TavernLocalExportPanel, TavernHeroBanner, TavernFileInput, TavernCandidateSelector, TavernCardPreview, TavernOriginalExport, TavernLocalProjection, TavernLocalSources, useTavernSourceSelection, readTavernFile, type TavernInputFile } from '@mahoshojo/ui-web/tavern';
import { GeneralCharacterCard } from '@mahoshojo/ui-web/character-card';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { exportTavernFile, getDesktopTavernBase, saveDesktopTavernCard } from '../features/tavern/host';
import { useLeaveGuard } from './useLeaveGuard';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';

/** Shared Web intake, preview and local actions; this slice has no AI/cloud executor. */
export function DesktopTavern() {
  const router = useRouter();
  const idPrefix = useId();
  const { openFixed } = useExternalLinks();
  const repository = useMemo(() => new IpcLocalCardRepository((command, args) => invoke(command, args as never)), []);
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const onExportBusy = useCallback((value: boolean) => { exportBusy.current = value; setExporting(value); }, []);
  const [result, setResult] = useState<TavernParseResult | null>(null);
  const [basePng, setBasePng] = useState<Uint8Array>();
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const sourceSelection = useTavernSourceSelection();
  const busy = useRef(false);
  const guard = useLeaveGuard(() => busy.current || exportBusy.current);
  async function read(file: TavernInputFile | null) {
    if (!file || busy.current) return;
    const current = sourceSelection.begin();
    busy.current = true; setReading(true); setError(''); setResult(null); setBasePng(undefined);
    try {
      const next = await readTavernFile(file);
      if (!sourceSelection.isCurrent(current)) return;
      setResult(next.parsed); setBasePng(next.basePngBytes); setIndex(next.parsed.candidates.indexOf(next.parsed.selected));
    } catch (cause) { if (sourceSelection.isCurrent(current)) setError(cause instanceof Error ? cause.message : '读取失败'); }
    finally { busy.current = false; if (sourceSelection.isCurrent(current)) setReading(false); }
  }
  const candidate = result?.candidates[index];
  const normalized = useMemo(() => candidate ? normalizeTavernCard(candidate).normalized : null, [candidate]);
  const projection = useMemo(() => candidate ? convertTavernToGeneralCard(candidate) : null, [candidate]);
  return <div className="magic-background-white"><div className="container !max-w-[980px]"><div className="card !max-w-none !p-0">
    <TavernHeroBanner title="酒馆生态" subtitle="SillyTavern 角色卡（PNG 内嵌 JSON）导入/导出工具" actions={<TavernTabs idPrefix={idPrefix} tab={tab} onChange={setTab} disabled={reading || saving || exporting} />} right={<Link to="/" className="text-sm text-pink-700 hover:underline">返回首页</Link>} />
    <div className="p-6">
      <p className="text-center text-xs text-gray-600">本地解析与导出 PNG / JSON、规则映射和卡库读写，不上传角色内容。AI 深度转换和云保存尚未接入。</p>
      <TavernTabPanels idPrefix={idPrefix} tab={tab} exportPanel={<TavernLocalExportPanel repository={repository} exportFile={exportTavernFile} getDefaultBase={getDesktopTavernBase} disabled={!guard.ready} onBusyChange={onExportBusy} />} importPanel={<>
      <TavernLocalSources selection={sourceSelection} repository={repository} disabled={reading || saving || !guard.ready} onSource={(file) => void read(file)} />
      <TavernFileInput disabled={reading || saving || !guard.ready} onFileSelected={(file) => void read(file)} />
      {reading ? <p role="status">解析中…</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {candidate && normalized && projection && result ? <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4"><TavernCandidateSelector candidates={result.candidates} selectedIndex={index} onSelect={setIndex} disabled={saving} />
          <TavernLocalProjection disabled={!guard.ready} data={projection} exportFile={exportTavernFile} saveCard={async (data) => {
            busy.current = true; setSaving(true);
            try { return await saveDesktopTavernCard(repository, data); } finally { busy.current = false; setSaving(false); }
          }} />
          <GeneralCharacterCard general={projection} /></div>
        <div className="space-y-4"><TavernCardPreview normalized={normalized} warnings={result.meta.warnings} />
          <TavernOriginalExport disabled={saving} candidate={candidate} basePngBytes={basePng} exportFile={exportTavernFile} /></div>
      </div> : null}
      </>} />
      {guard.message ? <p role="alert" className="mt-3 text-sm text-red-700">{guard.message}</p> : null}
      <ProductFooter className="footer mt-8" assetSource={{ baseUrl: '/' }} onNavigateInternal={(href) => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} onNavigateExternal={openFixed} />
    </div>
  </div></div></div>;
}
