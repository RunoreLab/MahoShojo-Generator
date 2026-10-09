import { useEffect, useRef, useState } from 'react';
import { type QuestionnairePresetEntry, MAX_QUESTIONNAIRE_IMPORT_BYTES } from '@mahoshojo/domain/questionnaire-definition';
import { ensureQuestionnaireSelectionId, collectUsedQuestionnaireSelectionIds, removeQuestionnaireSelection, setQuestionnaireSelectionLore, type QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { CardLibraryModal, type BattleSelectionPayload, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { SublimationLoreSelection } from '@mahoshojo/ui-web/sublimation';
import { TokenIndicator } from '@mahoshojo/ui-web/details-controls';
import { useDesktopCardLibraryHost } from '../../platform/card-library-host';
import { loadBuiltinQuestionnaire, parseQuestionnaireCardSelection, toQuestionnaireSelection } from '../questionnaire/flow';
import presetIndex from '../../../../../content/questionnaires/presets/index.json';
import { importSublimationLore, retainSublimationLoreSource, parseSublimationLoreSelections, sublimationLoreText } from './lore-selection';

const presets = presetIndex.presets as QuestionnairePresetEntry[];
const family = { fallbackKind: 'magical-girl' as const, builtinQuestionnaireId: '', builtinPresetPath: '' };
export function DesktopSublimationLoreSelector({ selections, onChange, disabled, onLoadingChange, supplementalLore }: {
  supplementalLore?: { text: string; onChange: (text: string) => void };
  selections: QuestionnaireSelection[]; onChange: (value: QuestionnaireSelection[]) => void; disabled: boolean; onLoadingChange: (value: boolean) => void;
}) {
  const host = useDesktopCardLibraryHost();
  const identity = `${host.auth.status}:${host.auth.userId ?? ''}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const latest = useRef(selections); latest.current = selections;
  const epoch = useRef(0);
  const active = useRef<AbortController | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [details, setDetails] = useState<QuestionnaireSelection | null>(null);
  const onLoading = useRef(onLoadingChange); onLoading.current = onLoadingChange;
  useEffect(() => () => { epoch.current++; active.current?.abort(); onLoading.current(false); }, []);
  useEffect(() => { setPicker(false); }, [identity]);
  const append = (selection: QuestionnaireSelection) => {
    const key = (s: QuestionnaireSelection): string | null => s.source === 'upload' ? (s.selectionId ?? null) : `${s.source}:${s.dataCardId ?? s.questionnaire.id}`;
    const sourceKey = key(selection);
    if (sourceKey === null || !latest.current.some((s) => key(s) === sourceKey)) {
      onChange(parseSublimationLoreSelections([...latest.current, ensureQuestionnaireSelectionId(selection, collectUsedQuestionnaireSelectionIds(latest.current), () => crypto.randomUUID())]));
    }
    setError(null); setPaste(''); setPasteOpen(false);
  };
  const load = async (loader: (signal: AbortSignal) => Promise<QuestionnaireSelection>) => {
    if (disabled || active.current) return;
    const controller = new AbortController(); active.current = controller;
    const ticket = ++epoch.current;
    onLoading.current(true); setError(null);
    try { const selection = await loader(controller.signal); if (!controller.signal.aborted && ticket === epoch.current) append(selection); }
    catch (cause) { if (!controller.signal.aborted && ticket === epoch.current) setError(cause instanceof Error ? cause.message : '设定载入失败'); }
    finally { if (ticket === epoch.current) { active.current = null; onLoading.current(false); } }
  };
  const choose = (payload: BattleSelectionPayload, context: CardLibrarySelectionContext, openedIdentity: string) => {
    if (disabled || openedIdentity !== identityRef.current) return;
    const parsed = parseQuestionnaireCardSelection(family, payload, context);
    if ('error' in parsed) { setError(parsed.error); return; }
    try { append(retainSublimationLoreSource(toQuestionnaireSelection(parsed.source, parsed.questionnaire), context.rawSourceData ?? payload)); setPicker(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '设定来源无法读取'); }
  };
  const text = sublimationLoreText({ selectedQuestionnaires: selections, loreText: supplementalLore?.text ?? '', targetTemplate: 'general' });
  return <>
    <SublimationLoreSelection expanded={expanded} onExpandedChange={setExpanded} disabled={disabled} selections={selections} presets={presets}
      onSelectPreset={(id) => { const preset = presets.find((item) => item.id === id); if (preset) void load(async (signal) => ({ source: 'preset', questionnaire: await loadBuiltinQuestionnaire({ fallbackKind: preset.kind, builtinQuestionnaireId: preset.id, builtinPresetPath: preset.path }, signal) })); }}
      onUpload={(file) => { if (!file) return; if (file.size > MAX_QUESTIONNAIRE_IMPORT_BYTES) { setError('问卷文件超过大小上限（1 MiB）'); return; } void load(async () => importSublimationLore(await file.text())); }}
      onOpenPicker={() => setPicker(true)} pickerLabel="从本地 / 公共问卷库选择"
      onToggleLore={(id, enabled) => onChange(setQuestionnaireSelectionLore(selections, id, enabled))}
      onRemove={(id) => onChange(removeQuestionnaireSelection(selections, id))} onDetails={setDetails}
      pasteExpanded={pasteOpen} onPasteExpandedChange={setPasteOpen} pasteText={paste} onPasteTextChange={setPaste}
      onPasteImport={() => { try { append(importSublimationLore(paste)); } catch (cause) { setError(cause instanceof Error ? cause.message : '解析失败'); } }}
      onPasteClear={() => { setPaste(''); setError(null); }} loadError={error}
      tokenIndicator={text.trim() ? <TokenIndicator text={text} /> : undefined}
      supplementalLore={supplementalLore}
      warnNonNative={!!supplementalLore?.text.trim() || selections.some((s) => s.useLore !== false && !!s.questionnaire.loreMarkdown?.trim() && (s.source === 'upload' || s.questionnaire.nativeAllowed !== true))}
    />
    <CardLibraryModal key={identity} host={host} isOpen={picker} onClose={() => setPicker(false)} onSelectCard={(payload, context) => choose(payload, context, identity)} selectedType="questionnaire" allowedTypes={['questionnaire']} initialTab="local" titleOverride="选择问卷 / 设定卡" allowDeckImport={false} />
    {details && <div role="region" aria-label="设定来源详情" className="mb-6 rounded-lg border p-4"><h3>{details.questionnaire.title}</h3><pre className="max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify(details.questionnaire, null, 2)}</pre><button type="button" onClick={() => setDetails(null)}>关闭详情</button></div>}
  </>;
}
