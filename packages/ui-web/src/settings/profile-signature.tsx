import { useEffect, useRef, useState } from 'react';

export const PROFILE_SIGNATURE_MAX_LENGTH = 120;
/** 与线上签名一致：CRLF 归一、120 UTF-16 单位；不截出半个代理字符。 */
export const normalizeProfileSignature = (value: string): string => {
  const capped = value.replace(/\r\n/g, '\n').slice(0, PROFILE_SIGNATURE_MAX_LENGTH);
  return /[\uD800-\uDBFF]$/.test(capped) ? capped.slice(0, -1) : capped;
};

type SignatureState = {
  scope: string | null;
  source: string | undefined;
  baseline: string | undefined;
  draft: string;
  saving: boolean;
  saved: boolean;
  conflict: boolean;
  error: string | null;
};
const initialState = (scope: string | null, signature: string | undefined): SignatureState => ({
  scope, source: signature, baseline: signature, draft: signature ?? '', saving: false,
  saved: false, conflict: false, error: null,
});

/** 仅拥有带账号作用域的编辑状态；网络、鉴权、缓存与路由保护由宿主负责。 */
export function useProfileSignatureEditor({ scope, signature, canSave, save }: {
  scope: string | null;
  signature: string | undefined;
  canSave: boolean;
  save: (signature: string) => Promise<string>;
}) {
  const [state, setState] = useState(() => initialState(scope, signature));
  const identity = useRef({ scope, generation: 0 });
  const active = useRef(true);
  const pending = useRef<object | null>(null);
  if (identity.current.scope !== scope) {
    identity.current = { scope, generation: identity.current.generation + 1 };
    pending.current = null;
  }
  // 在同一次 render 清除旧账号草稿，避免 effect 前一帧暴露旧资料。
  if (state.scope !== scope) setState(initialState(scope, signature));
  const current = state.scope === scope ? state : initialState(scope, signature);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current = null; };
  }, []);
  useEffect(() => {
    setState((previous) => {
      if (previous.scope !== scope || signature === undefined || previous.source === signature) return previous;
      const dirty = previous.baseline !== undefined && previous.draft !== previous.baseline;
      return { ...previous, source: signature, baseline: signature,
        draft: dirty ? previous.draft : signature,
        conflict: dirty && previous.draft !== signature,
        saved: dirty && previous.draft === signature,
        error: dirty && previous.draft === signature ? null : previous.error };
    });
  }, [scope, signature]);
  const dirty = current.baseline !== undefined && current.draft !== current.baseline;
  const change = (value: string) => setState((previous) => ({
    ...previous, draft: normalizeProfileSignature(value), saved: false, error: null,
  }));
  const submit = async () => {
    if (!canSave || !dirty || current.baseline === undefined || pending.current !== null || scope === null) return;
    const fence = identity.current;
    const token = {}; pending.current = token;
    const submitted = normalizeProfileSignature(current.draft);
    setState((previous) => ({ ...previous, saving: true, saved: false, error: null }));
    const isCurrent = () => active.current && identity.current === fence && pending.current === token;
    try {
      const confirmed = await save(submitted);
      if (!isCurrent()) return;
      setState((previous) => ({ ...previous, baseline: confirmed, source: confirmed,
        draft: previous.draft === submitted ? confirmed : previous.draft,
        saving: false, saved: previous.draft === submitted, conflict: false, error: null }));
    } catch (cause) {
      if (!isCurrent()) return;
      setState((previous) => ({ ...previous, saving: false, saved: false,
        error: cause instanceof Error ? cause.message : '保存失败，请重试' }));
    } finally {
      if (pending.current === token) pending.current = null;
    }
  };
  return {
    draft: current.draft, dirty, saving: current.saving, saved: current.saved,
    loaded: current.baseline !== undefined, conflict: current.conflict, error: current.error,
    canSave: canSave && current.baseline !== undefined,
    change, submit,
    discard: () => setState((previous) => ({ ...previous, draft: previous.baseline ?? '',
      conflict: false, error: null, saved: false })),
  };
}
export type ProfileSignatureEditorState = ReturnType<typeof useProfileSignatureEditor>;

/** Web 原有签名字段与操作层级的受控共源。 */
export function ProfileSignatureField({ editor }: { editor: ProfileSignatureEditorState }) {
  const hint = editor.saving ? '保存中…' : editor.error ? '未能确认保存，草稿已保留' : !editor.loaded
    ? '资料尚未载入' : editor.dirty ? '未保存' : editor.saved ? '已保存' : '已同步';
  return <div>
    <div className="flex items-center justify-between">
      <label htmlFor="profile-signature" className="text-sm font-medium text-gray-900">个性签名</label>
      <div className="text-xs text-gray-500">{editor.draft.length}/{PROFILE_SIGNATURE_MAX_LENGTH}</div>
    </div>
    <textarea id="profile-signature" className="input-field mt-2 min-h-[90px] resize-y"
      placeholder="写一句你想展示的话…（最多 120 字）" maxLength={PROFILE_SIGNATURE_MAX_LENGTH}
      value={editor.draft} disabled={!editor.loaded} onChange={(event) => editor.change(event.target.value)} />
    <div className="mt-2 flex items-center justify-between gap-2">
      <div role="status" className="text-xs text-gray-500">提示：支持换行；{hint}</div>
      <div className="flex items-center gap-2">
        <button type="button" className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50"
          onClick={() => editor.change('')} disabled={!editor.draft || editor.saving}>清空</button>
        <button type="button" className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50"
          onClick={() => void editor.submit()} disabled={!editor.dirty || editor.saving || !editor.canSave}>保存</button>
      </div>
    </div>
    {editor.conflict && <div className="mt-2 text-xs text-amber-800">线上签名已变化，当前草稿已保留。保存将覆盖线上签名。
      <button type="button" className="ml-2 underline" disabled={editor.saving} onClick={editor.discard}>放弃草稿并采用线上签名</button>
    </div>}
    {editor.error && <div role="alert" className="mt-2 text-xs text-red-800">{editor.error}</div>}
  </div>;
}
