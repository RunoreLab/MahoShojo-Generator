import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { normalizeArenaWebOutput, resolveWebDisplayTitle } from '@mahoshojo/ai-core/arena-generation';
import { BUILTIN_WEB_PACKAGE_PRESETS, prepareWebPackageReplay, resolveWebPackageTargetExtension, type WebPackageReplayOutcome } from '@mahoshojo/web-package';
import { scanWebPackageBase, scanWebPackageInstance, type WebPackageRiskProfile } from '@mahoshojo/web-package/security';
import { ArenaWebPackageSection, type ArenaWebPackageOptionView, type ArenaWebPackageSectionModel } from '@mahoshojo/ui-web/arena';
import { ArenaWebResultView, ArenaWebReplayControlsView, WebPackageRiskSummary } from '@mahoshojo/ui-web/arena-report';
import { buildSafeFileName } from '@mahoshojo/ui-web/client';
import { downloadBinaryFile, downloadTextFile } from '../../platform/download-text-file';
import type { ArenaSessionState } from './session';
import { DesktopArenaWebPackages } from './web-packages';

function BaseRisk({ owner, packageRef }: { owner: DesktopArenaWebPackages; packageRef: WebPackageRef }) {
  const [profile, setProfile] = useState<WebPackageRiskProfile | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true; setProfile(null); setError(false);
    void owner.resolveExact(packageRef).then((base) => {
      const next = scanWebPackageBase(base); if (current) setProfile(next);
    }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [owner, packageRef]);
  return profile ? <WebPackageRiskSummary profile={profile} /> : <p role="status">{error ? '无法完成本地安全预检；这不是安全认证，当前不开放执行。' : '正在进行本地安全预检…'}</p>;
}

export function DesktopArenaWebPackageControls({ owner, selectedRef, disabled, onSelect }: {
  owner: DesktopArenaWebPackages; selectedRef?: WebPackageRef | null; disabled: boolean; onSelect(ref: WebPackageRef | null): void;
}) {
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const [saveImported, setSaveImported] = useState(false);
  const [actionDigest, setActionDigest] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  useEffect(() => { void owner.reload(); }, [owner]);
  const presets = useMemo<readonly ArenaWebPackageOptionView[]>(() => BUILTIN_WEB_PACKAGE_PRESETS.map((item) => ({ digest: item.packageRef.digest, title: item.title, kind: 'builtin', ref: item.packageRef, summary: item.description })), []);
  const library = useMemo<readonly ArenaWebPackageOptionView[]>(() => [
    ...state.records.map((record) => ({ digest: record.ref.digest, title: record.title, kind: 'local' as const, ref: record.ref, summary: `${record.ref.id}@${record.ref.version}`, byteLength: record.archiveByteLength })),
    ...state.temporary.filter((temporary) => !state.records.some((record) => record.ref.digest === temporary.ref.digest)).map((item) => ({ digest: item.ref.digest, title: item.title, kind: 'local' as const, ref: item.ref, summary: `${item.ref.id}@${item.ref.version}`, byteLength: item.byteLength, sessionOnly: true })),
  ], [state.records, state.temporary]);
  const selected = selectedRef ? [...library, ...presets].find((item) => item.ref?.digest === selectedRef.digest && item.ref.id === selectedRef.id && item.ref.version === selectedRef.version)
    ?? { digest: selectedRef.digest, title: `${selectedRef.id}@${selectedRef.version}（精确版本尚未加载）`, kind: 'unknown' as const, ref: selectedRef } : null;
  const download = async (digest: string, original: boolean) => {
    if (owner.isBusy()) return;
    const option = [...library, ...presets].find((item) => item.digest === digest);
    if (!option?.ref) return;
    const current = owner.captureScope();
    setActionDigest(digest); setDownloadError(null);
    try {
      const bytes = await owner.exportBase(option.ref, original);
      if (bytes && current()) downloadBinaryFile(buildSafeFileName(`${option.ref.id}@${option.ref.version}${original ? '_原件' : '_Base'}`, 'zip', 'Web包'), bytes, 'application/zip');
    } catch { if (current()) setDownloadError('ZIP 导出失败，原包仍保留。'); }
    finally { if (current()) setActionDigest(null); }
  };
  const model: ArenaWebPackageSectionModel = {
    disabled, active: true, selected, presets, library,
    importFeedback: state.error || state.diagnostics.length ? { message: state.error ?? '', hint: '', diagnostics: state.diagnostics } : null,
    downloadError, libraryError: !state.loaded && state.error ? state.error : null, importing: state.busy && !actionDigest,
    downloadingDigest: actionDigest, busyDigest: actionDigest, saveImportedToLibrary: saveImported,
    capabilities: { importLocal: true, downloadPreset: true, remove: true, replace: true, manageLibrary: true },
    actions: {
      select: (digest) => { if (!disabled) { if (digest === null) { onSelect(null); return; } const option = [...library, ...presets].find((item) => item.digest === digest); if (option?.ref) onSelect(option.ref); } },
      remove: () => { if (!disabled) onSelect(null); },
      downloadPreset: (digest) => download(digest, false), downloadFromLibrary: (digest) => download(digest, true),
      importFile: async (file) => {
        if (!file || disabled || owner.isBusy()) return 'cancelled';
        const current = owner.captureScope(), result = await owner.importFile(file, saveImported);
        if (!current()) return 'cancelled';
        if ('cancelled' in result) return 'cancelled'; if ('failed' in result) return 'failed';
        onSelect(result.ref);
      },
      removeFromLibrary: async (digest) => {
        if (disabled || owner.isBusy()) return 'cancelled';
        const option = library.find((item) => item.digest === digest); if (!option?.ref) return 'cancelled';
        const current = owner.captureScope(); setActionDigest(digest);
        try { const removed = await owner.remove(option.ref); if (!current()) return 'cancelled'; if (!removed) return 'failed'; if (selectedRef?.digest === digest) onSelect(null); }
        finally { if (current()) setActionDigest(null); }
      },
      setSaveImportedToLibrary: (next) => { if (!disabled) setSaveImported(next); }, reloadLibrary: () => { if (!disabled) void owner.reload(); },
    },
  };
  return <ArenaWebPackageSection model={model} host={{ renderRisk: (ref) => <BaseRisk owner={owner} packageRef={ref} />, libraryStatus: !state.loaded && !state.error ? <p role="status">正在读取本地 Web 包…</p> : null }} />;
}

export function DesktopArenaWebResult({ state, owner, disabled }: { state: ArenaSessionState; owner: DesktopArenaWebPackages; disabled: boolean }) {
  const packageState = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const artifact = state.renderSnapshot?.webPackage;
  const ready = state.phase === 'completed';
  const normalized = useMemo(() => normalizeArenaWebOutput(state.markdown), [state.markdown]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [compatibilityRef, setCompatibilityRef] = useState<WebPackageRef | undefined>();
  const [selectedDigest, setSelectedDigest] = useState('');
  const [resolution, setResolution] = useState<WebPackageReplayOutcome | null>(null);
  const [profile, setProfile] = useState<WebPackageRiskProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true; setResolution(null); setProfile(null); setError(null);
    if (!ready || !artifact) return;
    void prepareWebPackageReplay({ artifact, generatedContent: state.markdown, ...(compatibilityRef ? { allowCompatibility: true, compatibilityRef } : {}) }, { resolveExact: owner.resolveExact, findCandidatesById: owner.findCandidatesById }).then((value) => {
      if (!current) return; setResolution(value);
      if (value.instance) { try { setProfile(scanWebPackageInstance(value.instance)); } catch { setError('安全预检不可用；不能据此认为内容安全。'); } }
    }).catch(() => { if (current) setError('精确 Web 包校验失败，源码仍可导出。'); });
    return () => { current = false; };
  }, [artifact, compatibilityRef, owner, packageState.revision, ready, state.markdown]);
  const title = resolveWebDisplayTitle({ headline: state.report?.headline, html: artifact ? undefined : state.markdown });
  const downloadSource = () => {
    const isHtml = !artifact && Boolean(normalized.document), extension = artifact ? resolveWebPackageTargetExtension(artifact.targetMediaType) : isHtml ? 'html' : 'txt';
    if (isHtml || artifact && ['text/html', 'text/javascript', 'application/javascript', 'text/css', 'image/svg+xml'].includes(artifact.targetMediaType)) {
      if (!window.confirm('下载可执行内容？在应用外打开时不受 Desktop 隔离保护，可能执行脚本或访问网络。')) return;
    }
    try { downloadTextFile(buildSafeFileName(artifact?.targetPath.split('/').at(-1)?.replace(/\.[^.]+$/u, '') || title, extension, 'Web战报'), isHtml ? `\uFEFF${normalized.document}` : state.markdown, artifact?.targetMediaType ?? (isHtml ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8')); }
    catch { setError('目标文件导出失败；完整原文仍保留。'); }
  };
  const downloadBase = async () => {
    if (!artifact || disabled || owner.isBusy()) return;
    const current = owner.captureScope(), bytes = await owner.exportBase(artifact.packageRef, false);
    if (bytes && current() && alive.current) downloadBinaryFile(buildSafeFileName(`${artifact.packageRef.id}@${artifact.packageRef.version}_Base`, 'zip', 'Web包'), bytes, 'application/zip');
  };
  return <ArenaWebResultView source={state.markdown} ready={ready} title={title} prelude={artifact ? '' : normalized.prelude} epilogue={artifact ? '' : normalized.epilogue} riskProfile={profile}
    status={<>{artifact && ready ? <ArenaWebReplayControlsView status={resolution?.status ?? null} message={resolution?.message} description="兼容只验证当前工作副本，不改历史记录，也不会执行内容；重新导入仅在本页暂存。" copy={{ confirmCompatibilityLabel: '确认兼容校验此版本' }} candidates={resolution?.candidates ?? []} selectedCandidateDigest={selectedDigest || (resolution?.candidates?.length === 1 ? resolution.candidates[0]!.digest : '')}
      onSelectCandidate={setSelectedDigest} onConfirmCompatibility={(ref) => { if (!disabled && !owner.isBusy()) setCompatibilityRef(ref); }} disabled={disabled} importing={packageState.busy} importFeedback={packageState.error || packageState.diagnostics.length ? { message: packageState.error ?? '', hint: '', diagnostics: packageState.diagnostics } : null}
      onImportFile={async (file) => { if (!file || disabled || owner.isBusy()) return 'cancelled'; const current = owner.captureScope(), imported = await owner.importFile(file, false); if (!current() || 'cancelled' in imported) return 'cancelled'; if ('failed' in imported) return 'failed'; }} /> : null}{error ? <p role="alert">{error}</p> : null}<p role="status">{!ready ? '尚未取得合格完成结果；仅保留安全文本。' : artifact ? resolution?.message ?? (resolution?.status === 'exact' ? '已验证精确包与生成目标；隔离运行仍待 D4 验收。' : '正在验证精确包与生成目标…') : normalized.document ? '已识别完整 HTML；这不是安全认证，隔离运行仍待 D4 验收。' : '未识别完整 HTML，保留安全源码，不能运行。'}</p></>}
    actions={[{ id: 'download-web-source', label: artifact ? '下载生成目标' : normalized.document ? '下载 HTML' : '下载源码文本', disabled: !ready, onClick: downloadSource }, ...(artifact ? [{ id: 'download-web-base', label: '下载精确 Base ZIP（不含生成目标）', disabled: disabled || resolution?.status !== 'exact', onClick: () => { void downloadBase().catch(() => { if (alive.current) setError('Base ZIP 导出失败，原文仍保留。'); }); } }] : [])]}
    execution={{ available: false, reason: '隔离运行待验：当前不会创建运行窗口，也不会在主界面执行网页。生成、校验、保存与导出可正常使用。' }} />;
}
