import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SaveCardModal, ReplaceCardModal } from '@mahoshojo/ui-web/cloud-save';
import type { OnlineDataCardType, OwnedDataCardReplacementTarget } from '@mahoshojo/contracts/data-cards';
import { useDesktopCloudSession } from '../account/use-desktop-cloud-session';
import { createCloudCard, readPrivateCloudCapacity, readCloudReplaceTarget, replaceCloudCard } from '../../platform/private-cloud-save';
import { useLeaveGuard } from '../../app/useLeaveGuard';
import { DesktopOwnedCardsModal, type DesktopOwnedCard } from './owned-cards-modal';
import type { InvokeFn } from '../../platform/cloud-bridge';

export interface DesktopCloudCardActionsProps {
  data: unknown;
  cardType?: OnlineDataCardType;
  isBlocked?: () => boolean;
  disabled?: boolean;
  className?: string;
  invokeFn?: InvokeFn;
  onBusyChange?: (busy: boolean) => void;
  defaultName?: string;
  defaultDescription?: string;
  manageOpen?: boolean;
  onManageClose?: () => void;
  onSelectCard?: (card: DesktopOwnedCard) => void | Promise<void>;
  showManageButton?: boolean;
}

/** One result/account scope owns creation, target selection, confirmation and unknown writes. */
export function DesktopCloudCardActions(props: DesktopCloudCardActionsProps) {
  const { state, store } = useDesktopCloudSession();
  const epoch = store.getCredentialEpoch();
  const userId = state.account?.userId ?? null;
  const canSave = state.verification === 'verified' && state.authFlow.kind === 'idle';
  let source = '';
  try { source = JSON.stringify([props.data, props.defaultName, props.defaultDescription]); } catch { source = 'invalid-data'; }
  return <DesktopCloudCardActionsScope key={`${userId}:${epoch}:${props.cardType ?? 'character'}:${source}`} {...props}
    userId={userId} canSave={canSave}
    isCurrent={() => store.getSnapshot().account?.userId === userId && store.getCredentialEpoch() === epoch && store.getSnapshot().verification === 'verified' && store.getSnapshot().authFlow.kind === 'idle'} />;
}

export function DesktopCloudCardActionsScope({ data, cardType = 'character', isBlocked, disabled = false, className, invokeFn = invoke, userId, isCurrent, canSave, onBusyChange,
  defaultName, defaultDescription, manageOpen, onManageClose, onSelectCard, showManageButton = false }: DesktopCloudCardActionsProps & {
    userId: number | null; canSave: boolean; isCurrent: () => boolean;
  }) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryPurpose, setLibraryPurpose] = useState<'replace' | 'check' | 'manage'>('manage');
  const [target, setTarget] = useState<OwnedDataCardReplacementTarget | null>(null);
  const [name, setName] = useState(() => {
    const row = data as Record<string, unknown> | null;
    const value = defaultName ?? (cardType === 'character' ? row?.codename ?? row?.name : row?.title ?? row?.name);
    return typeof value === 'string' ? value.slice(0, 20) : cardType === 'scenario' ? '情景数据卡' : cardType === 'history' ? '叙事历史' : cardType === 'questionnaire' ? '问卷' : '角色数据卡';
  });
  const [description, setDescription] = useState(defaultDescription ?? (cardType === 'scenario' ? '情景数据卡' : cardType === 'history' ? '叙事历史数据卡' : cardType === 'questionnaire' ? '问卷数据卡' : '角色数据卡'));
  const [isPublic, setPublic] = useState<0 | 1>(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [uncertain, setUncertain] = useState<'create' | 'replace' | null>(null);
  const [conflict, setConflict] = useState(false);
  const [checkedOwnCards, setCheckedOwnCards] = useState(false);
  const [created, setCreated] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [capacity, setCapacity] = useState<{ capacity: number; usedSlots: number } | null>(null);
  const capacityEpoch = useRef(0);
  const operation = useRef(0);
  const frozenData = useRef<unknown>(null);
  const pending = useRef(false);
  const preparingRef = useRef(false);
  const active = useRef(true);
  const guard = useLeaveGuard(() => pending.current, '正在保存云端数据卡，请等待响应后再离开；本地结果保留。');
  const busyChanged = useRef(onBusyChange); busyChanged.current = onBusyChange;
  const current = useRef(isCurrent); current.current = isCurrent;
  useEffect(() => { active.current = true; return () => { active.current = false; operation.current++; busyChanged.current?.(false); }; }, []);
  useEffect(() => { if (manageOpen) setLibraryPurpose('manage'); }, [manageOpen]);
  const owns = () => active.current && current.current();
  const available = () => {
    if (!guard.ready || disabled || isBlocked?.() || pending.current || preparingRef.current) return false;
    if (userId === null || !canSave || !owns()) { setError('请先确认云端登录状态；本地结果保留'); return false; }
    return true;
  };
  const freeze = () => {
    if (data == null) return false;
    if (frozenData.current === null) {
      try { frozenData.current = JSON.parse(JSON.stringify(data)); }
      catch { setError('结果无法序列化，请检查数据；原内容已保留'); return false; }
    }
    return true;
  };
  const closeLibrary = () => {
    if (pending.current) return;
    operation.current++; preparingRef.current = false; setPreparing(false);
    setLibraryOpen(false); onManageClose?.();
  };
  const showSave = () => {
    if (!available() || created || !freeze()) return;
    setSaveOpen(true);
    const request = ++capacityEpoch.current; setCapacity(null);
    void readPrivateCloudCapacity(invokeFn, userId!).then((value) => { if (owns() && request === capacityEpoch.current) setCapacity(value); });
  };
  const showReplace = () => {
    if (!available() || !freeze()) return;
    if (uncertain) { setReplaceOpen(uncertain === 'replace'); setSaveOpen(uncertain === 'create'); return; }
    setError(null); setLibraryPurpose('replace'); setLibraryOpen(true);
  };
  const chooseTarget = async (card: DesktopOwnedCard) => {
    if (!available() || uncertain || !freeze()) return;
    if (card.type !== cardType) { setError('请选择与当前内容类型相同的数据卡'); return; }
    preparingRef.current = true; setPreparing(true); setError(null);
    const ticket = ++operation.current;
    const result = await readCloudReplaceTarget(invokeFn, userId!, card.id);
    if (!owns() || ticket !== operation.current) return;
    preparingRef.current = false; setPreparing(false);
    if (result.kind !== 'ready') { setError(result.message); throw new Error(result.message); }
    if (result.target.type !== cardType) { setError('目标卡片类型已变化，请重新选择'); throw new Error('目标卡片类型已变化，请重新选择'); }
    setTarget(result.target); setConflict(false); setLibraryOpen(false); onManageClose?.(); setReplaceOpen(true);
  };
  const finish = () => { pending.current = false; if (active.current) { setSaving(false); busyChanged.current?.(false); } };
  const save = async (replace: boolean) => {
    if (!available() || uncertain || (replace ? !replaceOpen || !target || conflict : !saveOpen || created) || frozenData.current === null) return;
    pending.current = true; setSaving(true); setError(null); busyChanged.current?.(true);
    const snapshot = target;
    const result = replace
      ? await replaceCloudCard(invokeFn, userId!, snapshot!, frozenData.current)
      : await createCloudCard(invokeFn, userId!, { type: cardType, name, description, isPublic, data: frozenData.current });
    finish();
    if (!owns()) { if (active.current) { setError('账号状态已变化，刚才的云端写入结果可能不确定，请先检查原账号的云端卡'); setUncertain(replace ? 'replace' : 'create'); } return; }
    if (result.kind === 'saved') {
      setStatus(replace ? ('pendingReview' in result && result.pendingReview ? '更新已提交审核，审核通过后生效；本地结果保持不变。' : '云端数据卡已替换，本地结果保持不变。') : `${isPublic === 1 ? '公开' : '私有'}云端副本已保存，本地结果保持不变。`);
      if (replace) { setTarget(null); setReplaceOpen(false); } else { setCreated(true); setSaveOpen(false); }
      setRefresh((value) => value + 1);
    } else {
      setError(result.message); setCheckedOwnCards(false);
      if (result.kind === 'uncertain') setUncertain(replace ? 'replace' : 'create');
      if (result.kind === 'conflict') setConflict(true);
    }
  };
  const checkOwnCards = () => { setCheckedOwnCards(true); setLibraryPurpose('check'); setLibraryOpen(true); setRefresh((value) => value + 1); };
  const uncertaintyControls = uncertain ? <div className="mt-4 space-y-2 text-sm">
    <button onClick={checkOwnCards}>检查“我的云端卡”</button>
    <button disabled={!checkedOwnCards} onClick={() => {
      if (!pending.current && checkedOwnCards && window.confirm(uncertain === 'create' ? '已检查我的云端卡？再次新建可能产生重复副本，是否继续？' : '已检查我的云端卡及待审版本？请重新选择目标并确认新的替换，是否继续？')) {
        const wasReplace = uncertain === 'replace'; setUncertain(null); setError(null); setCheckedOwnCards(false);
        if (wasReplace) { setTarget(null); setReplaceOpen(false); setLibraryPurpose('replace'); setLibraryOpen(true); }
      }
    }}>{uncertain === 'create' ? '我已检查，仍要再次新建（可能重复）' : '我已检查，重新选择替换目标'}</button>
  </div> : conflict ? <button onClick={() => { if (!pending.current) { setTarget(null); setReplaceOpen(false); setLibraryPurpose('replace'); setLibraryOpen(true); } }}>重新选择替换目标</button> : undefined;
  return <>
    {data != null && <>
      <button className={className} disabled={!guard.ready || disabled || saving || preparing || created} onClick={showSave}>{created ? '已保存到云端' : '保存到云端'}</button>
      <button className={className} disabled={!guard.ready || disabled || saving || preparing} onClick={showReplace}>替换已有</button>
    </>}
    {showManageButton && <button disabled={saving || preparing} onClick={() => { if (available()) { setLibraryPurpose('manage'); setLibraryOpen(true); } }}>我的云端卡</button>}
    {status && <p role="status">{status}</p>}
    {guard.message && <p role="alert">{guard.message}</p>}
    {!saveOpen && !replaceOpen && error && <p role="alert">{error}</p>}
    <SaveCardModal isOpen={saveOpen} onClose={() => { if (!pending.current) { capacityEpoch.current++; setSaveOpen(false); } }} onSave={() => void save(false)}
      name={name} description={description} isPublic={isPublic} onNameChange={setName} onDescriptionChange={setDescription} onPublicChange={(value) => setPublic(value === 1 ? 1 : 0)}
      error={error} isSaving={saving} submitDisabled={disabled || Boolean(uncertain) || created} data={frozenData.current}
      usedSlots={capacity?.usedSlots} userCapacity={capacity?.capacity} supplementaryContent={uncertaintyControls} />
    <ReplaceCardModal isOpen={replaceOpen} target={target ? { ...target, reviewStatus: target.reviewStatus ?? undefined } : null} onClose={() => { if (!pending.current) setReplaceOpen(false); }} onConfirm={() => void save(true)}
      error={error} isSaving={saving} submitDisabled={disabled || Boolean(uncertain) || conflict} supplementaryContent={uncertaintyControls} />
    {userId !== null && <DesktopOwnedCardsModal isOpen={libraryOpen || manageOpen === true} onClose={closeLibrary} expectedUserId={userId} selectedType={libraryPurpose === 'manage' ? undefined : cardType}
      invokeFn={invokeFn} isBusy={saving} refreshToken={refresh} titleOverride={libraryPurpose === 'check' ? '检查我的云端卡' : libraryPurpose === 'replace' ? '选择要替换的数据卡' : undefined}
      onReplaceCard={libraryPurpose !== 'check' && !uncertain && data != null ? chooseTarget : undefined}
      onSelectCard={libraryPurpose === 'manage' && onSelectCard ? async (card) => { if (owns() && !pending.current) { await onSelectCard(card); if (owns()) closeLibrary(); } } : undefined} />}
  </>;
}

// Keep existing page imports while all six result routes gain the shared complete flow.
export const PrivateResultSave = DesktopCloudCardActions;
export const PrivateResultSaveScope = DesktopCloudCardActionsScope;
