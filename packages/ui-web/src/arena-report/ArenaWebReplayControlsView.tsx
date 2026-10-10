'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import type { WebPackageReplayStatus } from '@mahoshojo/web-package';
import type { ArenaWebPackageImportFeedback } from '../arena/features/web-package/web-package-contract';

const DEFAULT_COPY = {
  candidateLabel: '选择兼容重放版本',
  candidatePlaceholder: '请选择版本与 digest',
  confirmCompatibilityLabel: '仍尝试使用此 Web 包',
  importLabel: '重新导入本地 Web 包',
  importingLabel: '正在导入…',
  importAriaLabel: '重新导入本地 Web 包',
};

export type ArenaWebReplayControlsViewProps = Readonly<{
  status: WebPackageReplayStatus | null;
  message?: ReactNode;
  description?: ReactNode;
  candidates: readonly WebPackageRef[];
  selectedCandidateDigest: string | null;
  onSelectCandidate(digest: string): void;
  onConfirmCompatibility(ref: WebPackageRef): void;
  /** Host owns synchronous lock, input/scope freezing, validation, feedback and busy/leave guard. */
  onImportFile(file: File | null | undefined): Promise<void | 'cancelled' | 'failed'>;
  disabled?: boolean;
  importing?: boolean;
  importFeedback?: ArenaWebPackageImportFeedback | null;
  copy?: Partial<typeof DEFAULT_COPY>;
}>;

/** Controlled replay repair controls, extracted from the real Web report. Key by host result/scope. No resolver or execution authority. */
export function ArenaWebReplayControlsView({
  status, message, description, candidates, selectedCandidateDigest, onSelectCandidate,
  onConfirmCompatibility, onImportFile, disabled = false, importing = false, importFeedback, copy: copyInput,
}: ArenaWebReplayControlsViewProps) {
  const copy = { ...DEFAULT_COPY, ...copyInput };
  const inputRef = useRef<HTMLInputElement>(null);
  const importFlight = useRef<symbol | null>(null);
  const mounted = useRef(false);
  const [localImporting, setLocalImporting] = useState(false);
  const [importFailure, setImportFailure] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; importFlight.current = null; };
  }, []);
  const selectedCandidate = candidates.find((candidate) => candidate.digest === selectedCandidateDigest);
  const canRepair = status === 'missing-package' || status === 'mismatch-available' || status === 'rejected';
  const busy = disabled || importing || localImporting;

  return <div className="mb-3 space-y-2 text-xs" data-testid="arena-web-replay-controls">
    {message ? <p role="status">{message}</p> : null}
    {description ? <div>{description}</div> : null}
    {canRepair ? <div className="flex flex-wrap items-center gap-2">
      {status === 'mismatch-available' && candidates.length > 1 ? <label className="flex min-w-0 flex-col gap-1">
        {copy.candidateLabel}
        <select value={selectedCandidate?.digest ?? ''} disabled={busy}
          onChange={(event) => { if (!busy) onSelectCandidate(event.target.value); }}
          className="max-w-full rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-amber-900 disabled:opacity-50">
          <option value="" disabled>{copy.candidatePlaceholder}</option>
          {candidates.map((candidate) => <option key={candidate.digest} value={candidate.digest}>
            {candidate.version} · {candidate.digest}
          </option>)}
        </select>
      </label> : null}
      {status === 'mismatch-available' && candidates.length === 1 ? <p className="break-all">
        {candidates[0].id}@{candidates[0].version} · {candidates[0].digest}
      </p> : null}
      {status === 'mismatch-available' ? <button type="button" disabled={busy || !selectedCandidate}
        onClick={() => { if (!busy && selectedCandidate) onConfirmCompatibility(selectedCandidate); }}
        className="rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-300/40 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70">
        {copy.confirmCompatibilityLabel}
      </button> : null}
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
        className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 font-medium text-white hover:bg-white/20 disabled:opacity-60">
        {importing || localImporting ? copy.importingLabel : copy.importLabel}
      </button>
      <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" disabled={busy}
        aria-label={copy.importAriaLabel} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          // Cancel never clears the selected version or asks the host to re-resolve anything.
          if (busy || !file || importFlight.current) return;
          const flight = Symbol('web-package-import');
          importFlight.current = flight;
          setLocalImporting(true);
          setImportFailure(null);
          void (async () => {
            try { await onImportFile(file); }
            catch {
              if (mounted.current && importFlight.current === flight) setImportFailure('导入未完成，请重试或查看本地包状态。');
            } finally {
              if (mounted.current && importFlight.current === flight) {
                importFlight.current = null;
                setLocalImporting(false);
              }
            }
          })();
        }} />
    </div> : null}
    {importFailure ? <span role="alert" className="text-red-300">{importFailure}</span> : null}
    {importFeedback?.message ? <span className="text-red-300" role="alert">
      {importFeedback.message}
      {importFeedback.hint ? <span className="block text-xs text-gray-400">{importFeedback.hint}</span> : null}
    </span> : null}
    {importFeedback && importFeedback.diagnostics.length > 0 ? <ul className="text-xs text-gray-400">
      {importFeedback.diagnostics.map((note) => <li key={note}>· {note}</li>)}
    </ul> : null}
  </div>;
}
