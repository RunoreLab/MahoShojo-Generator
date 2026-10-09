import { useEffect, useMemo, useRef, useState } from 'react';
import type { JsonValue } from '@mahoshojo/contracts/json-value';
import { inferDataCardTemplate } from '@mahoshojo/domain/data-cards';
import { buildDefaultFieldsFromDataCard, buildTavernExportCard, buildTavernScenarioFragment, getPlaceholderPngBytes, normalizeTavernCard, writeTavernCardToPngBytes, type ExportFields, type TavernScenarioFragment } from '@mahoshojo/domain/tavern-card';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { buildSafeFileName } from '../client';
import { TavernCardPreview } from './TavernCardPreview';
import type { TavernExportFilePort } from './controls';
import { TavernExportFields, TavernExportDialogueFields, TavernExportCreatorFields, TavernExportAdvancedFields, TavernExportChunkOptions, type TavernChunkOptions } from './export-fields';
import { readTavernBasePng, readTavernSourceJson } from './export-file';
import type { TavernInputFile } from './file';
import { TavernLocalSources } from './local-sources';
import { useTavernSourceSelection } from './source-selection';

const localMeta = { source: 'local' as const };
const initialOptions = { autoArenaScenario: true, includeArenaWorldbook: true, includeScenarioInScenario: true, includeScenarioInWorldbook: true, includeSourceSnapshot: true };
const optionLabels: Record<keyof typeof initialOptions, string> = {
  autoArenaScenario: 'scenario 为空时注入竞技场默认场景', includeArenaWorldbook: '写入竞技场默认世界书',
  includeScenarioInScenario: '把情景片段写入 scenario', includeScenarioInWorldbook: '把情景片段写入世界书', includeSourceSnapshot: '附带源 JSON 诊断快照（最多 24,000 字符）',
};
const buttonClass = 'rounded-xl border border-pink-200 bg-white px-4 py-2 text-sm text-pink-700 disabled:opacity-50';

/** Local-only controller. Shared fields/assembly also power the existing Web export tab. */
export function TavernLocalExportPanel({ repository, exportFile, getDefaultBase, disabled, onBusyChange }: {
  repository: CardRepository; exportFile: TavernExportFilePort; getDefaultBase?: () => Promise<Uint8Array>;
  disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [source, setSource] = useState<{ data: JsonValue; name: string; fields: ExportFields }>();
  const [base, setBase] = useState<{ bytes: Uint8Array; name: string }>();
  const [scenarios, setScenarios] = useState<TavernScenarioFragment[]>([]);
  const [options, setOptions] = useState(initialOptions);
  const [chunkOptions, setChunkOptions] = useState<TavernChunkOptions>({ overwriteExisting: true, includeCcv3: true, includeChara: true });
  const [reading, setReading] = useState(false);
  const [baseReading, setBaseReading] = useState(false);
  const [scenarioReading, setScenarioReading] = useState(false);
  const scenarioLock = useRef<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const sourceIntent = useTavernSourceSelection();
  const baseIntent = useTavernSourceSelection();
  const scenarioIntent = useTavernSourceSelection();
  const alive = useRef(true);
  const exportLock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onBusyChange?.(reading || baseReading || scenarioReading || exporting); return () => onBusyChange?.(false); }, [reading, baseReading, scenarioReading, exporting, onBusyChange]);
  const blocked = disabled || exporting;
  async function readSource(file: TavernInputFile | null) {
    if (!file || disabled || exportLock.current) return;
    const token = sourceIntent.begin(); setReading(true); setStatus(''); setError('');
    try {
      const data = await readTavernSourceJson(file);
      if (!sourceIntent.isCurrent(token)) return;
      const template = inferDataCardTemplate(data);
      if (template === 'scenario' || template === 'general-scenario') throw new Error('请选择角色数据卡；情景可从下方单独附加。');
      if (template === 'unknown') throw new Error('未识别到本项目角色数据卡。');
      setSource({ data, name: file.name, fields: buildDefaultFieldsFromDataCard(template, data, localMeta) });
    } catch (cause) { if (sourceIntent.isCurrent(token)) setError(cause instanceof Error ? cause.message : '读取失败'); }
    finally { if (sourceIntent.isCurrent(token)) setReading(false); }
  }
  async function readAuxiliary(file: TavernInputFile | null, kind: 'base' | 'scenario') {
    if (!file || disabled || exportLock.current) return;
    if (kind === 'scenario' && scenarioLock.current !== null) return;
    const intent = kind === 'base' ? baseIntent : scenarioIntent;
    const token = intent.begin(); setStatus(''); setError('');
    if (kind === 'base') setBaseReading(true);
    else { scenarioLock.current = token; setScenarioReading(true); }
    try {
      if (kind === 'base') {
        const bytes = await readTavernBasePng(file);
        if (intent.isCurrent(token)) setBase({ bytes, name: file.name });
      } else {
        const data = await readTavernSourceJson(file);
        const fragment = buildTavernScenarioFragment(data, { maxChars: 24_000 });
        if (!fragment) throw new Error('未识别到情景卡。');
        if (intent.isCurrent(token)) setScenarios((items) => [...items, fragment]);
      }
    } catch (cause) { if (intent.isCurrent(token)) setError(cause instanceof Error ? cause.message : '读取失败'); }
    finally {
      if (kind === 'scenario' && scenarioLock.current === token) scenarioLock.current = null;
      if (intent.isCurrent(token)) { if (kind === 'base') setBaseReading(false); else setScenarioReading(false); }
    }
  }
  const built = useMemo(() => {
    if (!source) return null;
    try { return { result: buildTavernExportCard({ fields: source.fields, dataCard: source.data, exportMeta: localMeta, exportedAt: new Date().toISOString(), options, scenarioFragments: scenarios }) }; }
    catch (cause) { return { error: cause instanceof Error ? cause.message : '组装失败' }; }
  }, [source, options, scenarios]);
  const preview = built?.result ? normalizeTavernCard({ keyword: 'json', chunkType: 'tEXt', parseMethod: 'json', parsed: built.result.card }).normalized : null;
  async function download(format: 'source' | 'json' | 'png') {
    if (!source || exportLock.current || disabled) return;
    // A later export intent owns its source; an older pending library/file read cannot replace it.
    sourceIntent.begin(); baseIntent.begin(); scenarioIntent.begin(); scenarioLock.current = null; setReading(false); setBaseReading(false); setScenarioReading(false);
    exportLock.current = true; setExporting(true); setError(''); setStatus('');
    try {
      let bytes: Uint8Array;
      if (format === 'source') bytes = new TextEncoder().encode(JSON.stringify(source.data));
      else {
        if (!built?.result) throw new Error(built?.error || '请先完成角色字段。');
        if (format === 'json') bytes = new TextEncoder().encode(JSON.stringify(built.result.card));
        else {
          if (!chunkOptions.includeCcv3 && !chunkOptions.includeChara) throw new Error('请至少写入一个 ccv3 / chara 角色块。');
          const baseBytes = base?.bytes ?? (getDefaultBase ? await getDefaultBase() : getPlaceholderPngBytes());
          if (!alive.current) return;
          bytes = writeTavernCardToPngBytes(baseBytes, built.result.card, { overwriteExisting: chunkOptions.overwriteExisting, includeCcv3Chunk: chunkOptions.includeCcv3, includeCharaChunk: chunkOptions.includeChara });
        }
      }
      if (!alive.current) return;
      await exportFile({ name: buildSafeFileName(format === 'source' ? `${source.fields.name}_源数据` : source.fields.name, format === 'png' ? 'png' : 'json', 'tavern'), bytes, mimeType: format === 'png' ? 'image/png' : 'application/json' });
      if (alive.current) setStatus('已发起下载，请在系统下载界面确认保存。');
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '导出失败'); }
    finally { exportLock.current = false; if (alive.current) setExporting(false); }
  }
  const onFieldChange = (key: keyof ExportFields, value: string | number | boolean) => {
    sourceIntent.begin(); setReading(false); setStatus('');
    setSource((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current);
  };
  return <div className="mt-4 space-y-4">
    <p className="rounded-xl border border-pink-200 bg-white/70 p-4 text-sm text-gray-700">把本项目角色卡按规则映射为新酒馆卡，可编辑字段并导出 PNG / JSON。这不是所有字段的无损转换；完整源 JSON 可另存。源 signature、原生标记和排名均不作为本地验证结果。</p>
    <TavernLocalSources mode="character" selection={sourceIntent} repository={repository} disabled={blocked} onSource={(file) => void readSource(file)} />
    <label className="input-group block"><span className="input-label">选择本项目数据卡 JSON</span><input aria-label="选择本项目数据卡 JSON" type="file" accept="application/json,.json" disabled={blocked} className="input-field" onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = ''; void readSource(file); }} /></label>
    {reading ? <p role="status">正在读取角色卡…</p> : null}
    {source ? <>
      <p className="text-xs text-gray-600">当前来源：{source.name}；本地来源未作在线签名验证。</p>
      <label className="input-group block"><span className="input-label">自定义 PNG 底图（可选）</span><input aria-label="自定义 PNG 底图" type="file" accept="image/png,.png" disabled={blocked} className="input-field" onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = ''; void readAuxiliary(file, 'base'); }} /></label>
      <div className="flex items-center gap-2 text-xs text-gray-600">{base?.name ?? '默认 Logo 底图，加载失败使用占位图'}{base ? <button type="button" disabled={blocked} className={buttonClass} onClick={() => { baseIntent.begin(); setBaseReading(false); setBase(undefined); }}>恢复默认底图</button> : null}</div>
      {baseReading || scenarioReading ? <p role="status">{baseReading ? '正在读取底图… ' : ''}{scenarioReading ? '正在附加情景…' : ''}</p> : null}
      <TavernExportFields fields={source.fields} onFieldChange={onFieldChange} disabled={blocked} scenarioTools={<div className="mt-3 space-y-2">
        {(Object.keys(initialOptions) as Array<keyof typeof initialOptions>).map((key) => <label key={key} className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={options[key]} disabled={blocked} onChange={(event) => { setOptions((previous) => ({ ...previous, [key]: event.target.checked })); setStatus(''); }} />{optionLabels[key]}</label>)}
        <label className="block text-xs text-gray-700">附加本地情景 JSON<input aria-label="附加本地情景 JSON" type="file" accept="application/json,.json" disabled={blocked || scenarioReading} className="input-field mt-1" onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = ''; void readAuxiliary(file, 'scenario'); }} /></label>
        {scenarios.map((scenario, index) => <div key={index} className="flex items-center justify-between text-xs"><span>{scenario.title}</span><button type="button" disabled={blocked} onClick={() => { setScenarios((items) => items.filter((_, at) => at !== index)); }}>移除情景</button></div>)}
      </div>} />
      <TavernExportDialogueFields fields={source.fields} onFieldChange={onFieldChange} disabled={blocked} />
      <TavernExportCreatorFields fields={source.fields} onFieldChange={onFieldChange} disabled={blocked} />
      <TavernExportAdvancedFields fields={source.fields} onFieldChange={onFieldChange} disabled={blocked} />
      <TavernExportChunkOptions options={chunkOptions} onOptionChange={(key, value) => { setChunkOptions((previous) => ({ ...previous, [key]: value })); setStatus(''); }} disabled={blocked} />
      {preview && built?.result ? <TavernCardPreview normalized={preview} warnings={built.result.warnings} /> : null}
      {built?.error ? <p role="alert" className="text-sm text-red-700">{built.error} 完整源 JSON 仍可另存。</p> : null}
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={blocked || !built?.result} onClick={() => void download('png')}>导出酒馆 PNG</button><button type="button" className={buttonClass} disabled={blocked || !built?.result} onClick={() => void download('json')}>导出酒馆 JSON</button><button type="button" className={buttonClass} disabled={blocked} onClick={() => void download('source')}>另存完整源 JSON</button></div>
    </> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {status ? <p role="status" className="text-xs text-gray-600">{status}</p> : null}
  </div>;
}
