import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SaveCardModal } from '@mahoshojo/ui-web/cloud-save';
import { useDesktopCloudSession } from '../account/use-desktop-cloud-session';
import { createPrivateCloudCopy, readPrivateCloudCapacity } from '../../platform/private-cloud-save';
import { useLeaveGuard } from '../../app/useLeaveGuard';
import { useDesktopCardLibraryHost } from '../../platform/card-library-host';
import { CardLibraryModal } from '@mahoshojo/ui-web/card-library';
import type { InvokeFn } from '../../platform/cloud-bridge';

/** 结果/账号作用域只拥有一次显式新建的表单；本地结果由原 session 继续拥有。 */
export function PrivateResultSave({ data, disabled = false, className, onBusyChange, invokeFn = invoke }: {
  data: unknown; disabled?: boolean; className?: string; invokeFn?: InvokeFn; onBusyChange?: (busy: boolean) => void;
}) {
  const { state, store } = useDesktopCloudSession();
  const host = useDesktopCardLibraryHost();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const epoch = store.getCredentialEpoch();
  const userId = state.account?.userId ?? null;
  const canSave = state.verification === 'verified' && state.authFlow.kind === 'idle';
  const source = JSON.stringify(data);
  return <><PrivateResultSaveScope key={`${userId}:${epoch}:${source}`} data={data} disabled={disabled}
    className={className} invokeFn={invokeFn} userId={userId} canSave={canSave} onBusyChange={onBusyChange} onCheckOwnCards={() => setLibraryOpen(true)}
    isCurrent={() => store.getSnapshot().account?.userId === userId && store.getCredentialEpoch() === epoch && store.getSnapshot().verification === 'verified' && store.getSnapshot().authFlow.kind === 'idle'} />
    <CardLibraryModal browseOnly host={host} isOpen={libraryOpen} onClose={() => setLibraryOpen(false)} selectedType="character"
      initialTab="my" visibleTabs={['my']} titleOverride="检查我的云端卡" allowDeckImport={false} allowCardDetails={false} />
  </>;
}

export function PrivateResultSaveScope({ data, disabled, className, invokeFn, userId, isCurrent, canSave, onBusyChange, onCheckOwnCards }: {
  data: unknown; disabled?: boolean; className?: string; invokeFn: InvokeFn;
  onCheckOwnCards: () => void; userId: number | null; canSave: boolean; onBusyChange?: (busy: boolean) => void; isCurrent: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => {
    const row = data as Record<string, unknown> | null;
    const value = row?.codename ?? row?.name;
    return typeof value === 'string' ? value.slice(0, 20) : '角色数据卡';
  });
  const [description, setDescription] = useState('角色数据卡');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [checkedOwnCards, setCheckedOwnCards] = useState(false);
  const capacityEpoch = useRef(0);
  const [saved, setSaved] = useState(false);
  const [capacity, setCapacity] = useState<{ capacity: number; usedSlots: number } | null>(null);
  const frozenData = useRef<unknown>(null);
  const pending = useRef(false);
  const active = useRef(true);
  const guard = useLeaveGuard(() => pending.current, '正在创建云端副本，请等待响应后再离开；本地结果保留。');
  const busyChanged = useRef(onBusyChange); busyChanged.current = onBusyChange;
  const current = useRef(isCurrent); current.current = isCurrent;
  useEffect(() => { active.current = true; return () => { active.current = false; busyChanged.current?.(false); }; }, []);
  const owns = () => active.current && current.current();
  const show = () => {
    if (!guard.ready || disabled || pending.current || saved) return;
    if (userId === null) { setError('请先在账号菜单登录云端账号；本地结果仍可保存'); return; }
    if (!canSave || !current.current()) { setError('请先确认云端登录状态，再保存私有副本；本地结果保留'); return; }
    if (frozenData.current === null) frozenData.current = JSON.parse(JSON.stringify(data));
    setOpen(true);
    const capacityRequest = ++capacityEpoch.current;
    setCapacity(null);
    void readPrivateCloudCapacity(invokeFn, userId).then((value) => { if (owns() && capacityRequest === capacityEpoch.current) setCapacity(value); });
  };
  const save = async () => {
    if (userId === null || pending.current || uncertain || saved || !open || !owns()) return;
    pending.current = true; busyChanged.current?.(true);
    setSaving(true); setError(null);
    const form = { name, description, data: frozenData.current };
    const outcome = await createPrivateCloudCopy(invokeFn, userId, form);
    if (!owns()) { pending.current = false; if (active.current) { setSaving(false); setError('账号状态已变化，请重新确认登录；刚才的云端创建结果可能不确定，请先检查我的云端卡'); setUncertain(true); busyChanged.current?.(false); } return; }
    pending.current = false; busyChanged.current?.(false); setSaving(false);
    if (outcome.kind === 'saved') { setSaved(true); setOpen(false); }
    else { setError(outcome.message); setUncertain(outcome.kind === 'uncertain'); setCheckedOwnCards(false); }
  };
  return <>
    <button className={className} disabled={!guard.ready || disabled || saving || saved} onClick={show}>
      {saved ? '已保存私有云端副本' : '保存私有云端副本'}
    </button>
    {saved && <p role="status">私有云端副本已保存，本地结果保持不变。</p>}
    {guard.message && <p role="alert">{guard.message}</p>}
    {!open && error && <p role="alert">{error}</p>}
    <SaveCardModal isOpen={open} onClose={() => { if (!pending.current) { capacityEpoch.current++; setOpen(false); } }} onSave={() => void save()}
      name={name} description={description} isPublic={0} privateOnly onNameChange={setName}
      onDescriptionChange={setDescription} onPublicChange={() => {}} error={error} isSaving={saving}
      submitDisabled={uncertain || saved} data={frozenData.current}
      usedSlots={capacity?.usedSlots} userCapacity={capacity?.capacity}
      supplementaryContent={uncertain ? <div className="mt-4 space-y-2 text-sm">
        <button onClick={() => { setCheckedOwnCards(true); onCheckOwnCards(); }}>检查“我的云端卡”</button>
        <button disabled={!checkedOwnCards} onClick={() => { if (!pending.current && checkedOwnCards && window.confirm('已检查我的云端卡？再次新建可能产生重复副本，是否继续？')) { setUncertain(false); setError(null); } }}>我已检查，仍要再次新建（可能重复）</button>
      </div> : undefined} />
  </>;
}
