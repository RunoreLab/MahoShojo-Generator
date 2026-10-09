import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { JsonValue } from '@mahoshojo/contracts/json-value';
import { inferDataCardTemplate } from '@mahoshojo/domain/data-cards';
import { mergeTeamDataCards, type TeamMergeOutputTemplate, type TeamMergeResult } from '@mahoshojo/domain/team-merge';
import { checkTeamBudget, checkTeamCompositionBudget, checkTeamResult, projectUnsignedTeamData, MAX_TEAM_MEMBERS, parseTeamInput, teamMemberName } from '@mahoshojo/domain/team-input';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { TavernLocalSources } from '../tavern/local-sources';
import { useTavernSourceSelection } from '../tavern/source-selection';
import { TeamMembersPanel, TeamMergeSettings, TeamResultJson, TeamResultPreview, TeamDraftNotice } from './controls';
import { readTeamFile, type TeamInputFile } from './file';

type Member = { id: string; label: string; data: Record<string, unknown>; sourceLabel: string };
export interface LocalTeamPanelProps {
  repository: CardRepository;
  saveCard: (data: Record<string, unknown>, name: string) => Promise<'saved' | 'already-present'>;
  downloadJson: (data: unknown, name: string) => void | Promise<void>;
  renderPreview: (result: TeamMergeResult) => ReactNode;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/** Local composition only. Web keeps its existing online/signing controller and uses the same controls/core. */
export function LocalTeamPanel({ repository, saveCard, downloadJson, renderPreview, disabled, onBusyChange, onDirtyChange }: LocalTeamPanelProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [template, setTemplate] = useState<TeamMergeOutputTemplate>('auto');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const snapshot = useMemo(() => JSON.stringify({ members: members.map(({ label, data }) => ({ label, data })), template }), [members, template]);
  const dirty = !!paste.trim() || (members.length > 0 && snapshot !== savedSnapshot);
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const lock = useRef(false);
  const alive = useRef(true);
  const serial = useRef(0);
  const selection = useTavernSourceSelection();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const blocked = disabled || busy;
  const composition = useMemo(() => {
    try {
      checkTeamCompositionBudget(members);
      const result = mergeTeamDataCards(members.map((member) => ({ name: member.label, data: projectUnsignedTeamData(member.data as Record<string, JsonValue>) })), { outputTemplate: template });
      checkTeamResult(result.data);
      return { result, error: '' };
    } catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : '合并失败' }; }
  }, [members, template]);
  const merged = composition.result;
  function changed() { selection.begin(); setError(''); setStatus(''); }
  function append(data: Record<string, unknown>[], sourceLabel: string) {
    checkTeamBudget([...members.map((member) => member.data), ...data]);
    setMembers((previous) => [...previous, ...data.map((card) => ({ id: `team-${++serial.current}`, label: teamMemberName(card), data: card, sourceLabel }))]);
  }
  async function run(action: () => Promise<void>) {
    if (lock.current || disabled) return;
    selection.begin(); lock.current = true; setBusy(true); setError(''); setStatus(''); onBusyChange?.(true);
    try { await action(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '操作失败，可重试。'); }
    finally { lock.current = false; onBusyChange?.(false); if (alive.current) setBusy(false); }
  }
  async function read(files: TeamInputFile[], sourceLabel = '文件') {
    await run(async () => {
      if (files.length > MAX_TEAM_MEMBERS) throw new Error('单次最多选择 32 个文件。');
      const data: Record<string, unknown>[] = [];
      for (const file of files) {
        data.push(...await readTeamFile(file));
        checkTeamBudget([...members.map((member) => member.data), ...data]);
        if (!alive.current) return;
      }
      if (!alive.current) return;
      append(data, sourceLabel); setStatus(`已添加 ${data.length} 个角色卡。`);
    });
  }
  return <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
    <div className="min-w-0 space-y-6">
      <p className="text-xs text-gray-600">本地组队不上传内容、不验证原生性，另存结果均为未签名卡。不按下划线批量删除扩展；顶层签名和原生标记不会继承。合并仍沿用原有字段拼接规则（可能转换字段类型或移除系统字段）；队员源 JSON 可另存。</p>
      <TeamDraftNotice />
      <TavernLocalSources mode="character" repository={repository} selection={selection} disabled={blocked} onSource={(file) => void read([file], '本地卡库')} />
      <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
        <div className="text-base font-semibold text-gray-800">从本地添加</div>
        <p className="mt-1 text-xs text-gray-600">支持 JSON 对象或对象数组。单次/单文件 1 MiB、队伍最多 32 人、源数据共 3 MiB；批次失败时不添加任何队员。</p>
        <label className="input-group mt-3 block"><span className="input-label">上传 JSON 文件（可多选）</span><input aria-label="上传队员 JSON" type="file" accept="application/json,.json" multiple disabled={blocked} className="input-field" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) void read(files); }} /></label>
        <label className="input-group mt-3 block"><span className="input-label">粘贴 JSON（对象或对象数组）</span><textarea aria-label="粘贴队员 JSON" className="input-field h-32 resize-y font-mono text-xs" value={paste} disabled={blocked} onChange={(event) => setPaste(event.target.value)} /></label>
        <button type="button" className="generate-button mt-2 mb-0" disabled={blocked || !paste.trim()} onClick={() => void run(async () => { const data = parseTeamInput(paste); append(data, '粘贴'); setPaste(''); setStatus(`已添加 ${data.length} 个角色卡。`); })}>解析并添加</button>
      </div>
      <TeamMembersPanel members={members.map((member) => ({ ...member, template: inferDataCardTemplate(member.data), trustLabel: <span className="text-xs text-gray-500">未作在线验证</span> }))} disabled={blocked}
        onClear={() => { changed(); setMembers([]); }} onRename={(id, label) => { changed(); setMembers((items) => items.map((item) => item.id === id ? { ...item, label } : item)); }}
        onRemove={(id) => { changed(); setMembers((items) => items.filter((item) => item.id !== id)); }}
        onMove={(index, direction) => { changed(); setMembers((items) => { const next = [...items]; const target = index + direction; if (target < 0 || target >= next.length) return items; [next[index], next[target]] = [next[target], next[index]]; return next; }); }} />
      <TeamMergeSettings outputTemplate={template} onChange={(value) => { changed(); setTemplate(value); }} warnings={merged?.warnings ?? []} disabled={blocked || members.length === 0} />
    </div>
    <div className="min-w-0 space-y-6">
      <TeamResultPreview>{merged ? renderPreview(merged) : <p role="alert">{composition.error}</p>}</TeamResultPreview>
      <div className="card !max-w-none"><h3 className="mb-4 text-center text-lg font-medium">后续操作</h3>
        <div className="flex flex-wrap gap-3"><button type="button" className="generate-button flex-1" disabled={blocked || members.length === 0 || !merged} onClick={() => void run(async () => { if (!merged) return; const outcome = await saveCard(merged.data, teamMemberName(merged.data)); if (alive.current) { setSavedSnapshot(snapshot); setStatus(outcome === 'saved' ? '已保存到本地卡库（未签名）。' : '本地卡库已存在相同内容，原记录保持不变。'); } })}>保存到本地卡库</button>
        <button type="button" className="generate-button flex-1" disabled={blocked || members.length === 0 || !merged} onClick={() => void run(async () => { if (!merged) return; await downloadJson(merged.data, teamMemberName(merged.data)); if (alive.current) { setSavedSnapshot(snapshot); setStatus('已发起 JSON 下载，请在系统下载界面确认保存。'); } })}>下载 JSON</button>
        <button type="button" className="generate-button flex-1" disabled={blocked || members.length === 0} onClick={() => void run(async () => { await downloadJson(members.map((member) => member.data), '队员源数据'); if (alive.current) setStatus('已发起完整队员源 JSON 下载，原始签名仅作来源数据，不代表已验证。'); })}>另存队员源 JSON</button></div>
        {merged ? <TeamResultJson data={merged.data} /> : null}
      </div>
      {busy ? <p role="status">处理中…</p> : null}{status ? <p role="status" className="text-sm text-emerald-700">{status}</p> : null}{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  </div>;
}
