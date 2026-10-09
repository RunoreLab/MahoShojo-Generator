import { useEffect, useRef, useState } from 'react';
import type { OnlineDataCardType, OwnedDataCardReplacementTarget } from '@mahoshojo/contracts/data-cards';
import type { ReplaceCardModalProps, SaveCardModalProps } from '@mahoshojo/ui-web/cloud-save';
import { authStorage, dataCardApi, type OwnedDataCardWriteGuard } from '@/lib/auth';
import { quickCheck } from '@/lib/sensitive-word-filter';

type Input = {
  data: unknown;
  cardType: OnlineDataCardType;
  userId: number | null;
  isAuthenticated: boolean;
  authSource?: string | null;
  prepareData: (isCurrent: () => boolean) => Promise<unknown | null>;
  onSuccess: (message: string) => void;
  onSensitive: () => void;
  onInspectCards: () => void;
  usedSlots?: number;
  userCapacity?: number;
  onBusyChange?: (busy: boolean) => void;
};
type Operation = { scope: string; writing: boolean };
type ReplacementDraft = {
  scope: string;
  target: OwnedDataCardReplacementTarget;
  guard: OwnedDataCardWriteGuard;
  prepareData: Input['prepareData'];
};

/** Web 角色管理宿主控制：沿用签名准备流程，表单和确认UI由两端共享组件负责。 */
export function useCharacterManagerCloudWrite(input: Input) {
  const scope = JSON.stringify([input.userId, input.isAuthenticated, input.authSource, input.cardType, input.data]);
  const latest = useRef({ input, scope }); latest.current = { input, scope };
  const mounted = useRef(true);
  const operation = useRef<Operation | null>(null);
  const selection = useRef(0);
  const uncertainCreates = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [formScope, setFormScope] = useState('');
  const [form, setForm] = useState({ name: '', description: '', isPublic: 0 });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createUncertain, setCreateUncertain] = useState(false);
  const [checkedOwnCards, setCheckedOwnCards] = useState(false);
  const [replacement, setReplacement] = useState<ReplacementDraft | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceBlocked, setReplaceBlocked] = useState(false);
  const [replacementPreparing, setReplacementPreparing] = useState(false);
  const owns = (captured: string) => mounted.current && latest.current.scope === captured;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    selection.current++;
    setSaveOpen(false); setReplacement(null); setSaveError(null); setReplaceError(null); setReplaceBlocked(false);
    setCheckedOwnCards(false); setCreateUncertain(uncertainCreates.current.has(scope));
    // 已发出的写入不可取消/重放；它完成前不开放另一写入，正文仍归原编辑器所有。
  }, [scope]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!operation.current?.writing) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const begin = (selectionOnly = false): Operation | null => {
    if (operation.current || !input.isAuthenticated || input.userId === null || input.data === null) return null;
    const op = { scope, writing: false }; operation.current = op; setBusy(true); input.onBusyChange?.(!selectionOnly); return op;
  };
  const finish = (op: Operation) => {
    if (operation.current !== op) return;
    operation.current = null; latest.current.input.onBusyChange?.(false);
    if (mounted.current) { setBusy(false); setReplacementPreparing(false); }
  };
  const captureGuard = async (captured: string): Promise<OwnedDataCardWriteGuard | null> => {
    const expectedUserId = input.userId;
    const expectedAuth = await authStorage.getAuth();
    if (expectedUserId === null || !owns(captured) || expectedAuth?.userId !== expectedUserId) return null;
    return { expectedUserId, expectedAuth: JSON.parse(JSON.stringify(expectedAuth)), isCurrent: () => owns(captured) };
  };
  const check = async (text: string, captured: string) => {
    const result = await quickCheck(text);
    if (!owns(captured)) return false;
    if (result.hasSensitiveWords) { latest.current.input.onSensitive(); return false; }
    return true;
  };
  const openSave = () => {
    if (operation.current || !input.isAuthenticated || input.userId === null || input.data === null) return;
    if (formScope !== scope) {
      const row = input.data as Record<string, unknown>;
      const name = input.cardType === 'scenario' ? row.title ?? row.name : row.codename ?? row.name;
      setForm({ name: typeof name === 'string' ? name.slice(0, 20) : '', description: input.cardType === 'scenario' ? '情景数据卡' : '角色数据卡', isPublic: 0 });
      setFormScope(scope);
    }
    setSaveError(uncertainCreates.current.has(scope) ? '先前保存结果不确定，请先检查我的云端卡，再决定是否再次新建。' : null);
    setCreateUncertain(uncertainCreates.current.has(scope)); setCheckedOwnCards(false); setSaveOpen(true);
  };
  const save = async () => {
    if (!saveOpen || formScope !== scope || uncertainCreates.current.has(scope)) return;
    if (!form.name.trim()) { setSaveError('请输入数据卡名称'); return; }
    const op = begin(); if (!op) return;
    const frozenForm = { ...form }; const prepareData = input.prepareData;
    setSaveError(null);
    try {
      const guard = await captureGuard(op.scope);
      if (!guard) { if (owns(op.scope)) setSaveError('登录状态已改变，请重新打开保存窗口；编辑内容保留。'); return; }
      const data = await prepareData(() => owns(op.scope));
      if (data === null || !owns(op.scope)) return;
      if (!await check(`${frozenForm.name} ${frozenForm.description} ${JSON.stringify(data)}`, op.scope)) return;
      op.writing = true;
      const result = await dataCardApi.createCard(input.cardType, frozenForm.name, frozenForm.description, data, frozenForm.isPublic, guard);
      if (result.uncertain) uncertainCreates.current.add(op.scope);
      if (!owns(op.scope)) return;
      if (result.success) { setSaveOpen(false); latest.current.input.onSuccess('数据卡保存成功！公开与审核状态以云端卡库为准。'); }
      else if (result.error === 'SENSITIVE_WORD_DETECTED' || result.redirect === '/arrested') latest.current.input.onSensitive();
      else { setSaveError(result.error || '保存失败，输入已保留'); setCreateUncertain(result.uncertain === true); setCheckedOwnCards(false); }
    } catch (cause) {
      if (op.writing) uncertainCreates.current.add(op.scope);
      if (owns(op.scope)) { setCreateUncertain(op.writing); setSaveError(op.writing ? '保存结果不确定，请先检查我的云端卡，不要直接重发。' : cause instanceof Error ? cause.message : '准备保存失败，输入已保留'); }
    } finally { finish(op); }
  };
  const selectReplacement = async (id: string): Promise<boolean> => {
    const op = begin(true); if (!op) return false;
    const request = ++selection.current; const prepareData = input.prepareData;
    setReplacementPreparing(true); setReplaceError(null);
    try {
      const guard = await captureGuard(op.scope);
      if (request !== selection.current) return false;
      if (!guard) throw new Error('登录状态已改变，请重新登录后选择目标；编辑内容保留');
      const result = await dataCardApi.readOwnedReplacementTarget(id, guard);
      if (!owns(op.scope) || request !== selection.current) return false;
      if (!result.success || !result.target) throw new Error(result.error || '无法读取替换目标，输入已保留');
      if (result.target.type !== input.cardType) throw new Error('目标卡片类型与当前内容不一致，请选择相同类型的数据卡');
      setSaveOpen(false); setReplacement({ scope: op.scope, target: result.target, guard, prepareData }); setReplaceBlocked(false); return true;
    } finally { finish(op); }
  };
  const replace = async () => {
    if (!replacement || replacement.scope !== scope || replaceBlocked) return;
    const draft = replacement; const op = begin(); if (!op) return;
    setReplaceError(null);
    try {
      const data = await draft.prepareData(() => owns(op.scope));
      if (data === null || !owns(op.scope)) return;
      if (!await check(`${draft.target.name} ${draft.target.description ?? ''} ${JSON.stringify(data)}`, op.scope)) return;
      op.writing = true;
      const result = await dataCardApi.replaceOwnedCard(draft.target, data, draft.guard);
      if (!owns(op.scope)) return;
      if (result.success) { setReplacement(null); latest.current.input.onSuccess(result.pendingReview ? '更新已提交审核，审核通过后生效' : '替换成功'); }
      else { setReplaceError(result.error || '替换失败，编辑内容已保留'); setReplaceBlocked(result.uncertain === true || result.conflict === true); }
    } catch (cause) {
      if (owns(op.scope)) { setReplaceBlocked(op.writing); setReplaceError(op.writing ? '替换结果不确定，请检查我的云端卡及待审版本，重新选择目标后再确认。' : cause instanceof Error ? cause.message : '准备替换失败，输入已保留'); }
    } finally { finish(op); }
  };
  const saveModal: SaveCardModalProps = {
    isOpen: saveOpen && formScope === scope, onClose: () => { if (!operation.current) setSaveOpen(false); }, onSave: () => void save(),
    ...form, onNameChange: (name) => setForm((value) => ({ ...value, name })), onDescriptionChange: (description) => setForm((value) => ({ ...value, description })), onPublicChange: (isPublic) => setForm((value) => ({ ...value, isPublic })),
    error: saveError, isSaving: busy && !replacementPreparing, submitDisabled: createUncertain || busy, data: input.data, usedSlots: input.usedSlots, userCapacity: input.userCapacity,
    supplementaryContent: createUncertain ? <div className="mt-4 space-y-2 text-sm"><button type="button" onClick={() => { setCheckedOwnCards(true); latest.current.input.onInspectCards(); }}>检查我的云端卡</button><button type="button" disabled={!checkedOwnCards || busy} onClick={() => { if (!operation.current && checkedOwnCards && window.confirm('已检查我的云端卡？再次新建可能产生重复数据卡，确认继续？')) { uncertainCreates.current.delete(scope); setCreateUncertain(false); setSaveError(null); } }}>我已检查，仍要再次新建（可能重复）</button></div> : undefined,
  };
  const replaceModal: ReplaceCardModalProps = {
    isOpen: replacement?.scope === scope, target: replacement?.scope === scope ? { ...replacement.target, reviewStatus: replacement.target.reviewStatus ?? undefined } : null,
    onClose: () => { if (!operation.current) setReplacement(null); }, onConfirm: () => void replace(), isSaving: busy && !replacementPreparing, error: replaceError, submitDisabled: replaceBlocked || busy,
    supplementaryContent: replaceBlocked ? <button type="button" onClick={() => { setReplacement(null); latest.current.input.onInspectCards(); }}>检查我的云端卡并重新选择目标</button> : undefined,
  };
  return { openSave, selectReplacement, cancelReplacementSelection: () => { selection.current++; if (replacementPreparing && operation.current && !operation.current.writing) finish(operation.current); }, saveModal, replaceModal, busy, replacementPreparing, scope };
}
