import { invoke } from '@tauri-apps/api/core';
import { ProfileSignatureField, useProfileSignatureEditor } from '@mahoshojo/ui-web/settings';
import { useLeaveGuard } from '../../app/useLeaveGuard';
import { saveMyProfileSignature } from '../../platform/cloud-bridge';
import { useDesktopCloudSession } from './use-desktop-cloud-session';
import { acceptSavedProfileSignature, getMyProfileGeneration, useMyProfile } from './use-topbar-avatar';

/** DESK-SET-002：服务端确认才成功，无后台写入队列或自动重试。 */
export function ProfileSignaturePanel() {
  const { state, store } = useDesktopCloudSession();
  const userId = state.account?.userId ?? null;
  const epoch = store.getCredentialEpoch();
  const { profile, error, retry } = useMyProfile(state.account, epoch);
  const editor = useProfileSignatureEditor({
    scope: userId === null ? null : `desktop:${userId}:${epoch}`,
    signature: profile === null ? undefined : profile.signature ?? '',
    canSave: state.verification === 'verified' && state.authFlow.kind === 'idle',
    save: async (signature) => {
      const isCurrent = () => store.getSnapshot().account?.userId === userId
        && store.getCredentialEpoch() === epoch;
      if (userId === null || !isCurrent() || store.getSnapshot().verification !== 'verified'
        || store.getSnapshot().authFlow.kind !== 'idle') throw new Error('请先验证当前账号后再保存');
      const generation = getMyProfileGeneration(userId);
      const confirmed = await saveMyProfileSignature(invoke, { expectedUserId: userId, signature });
      if (!isCurrent() || confirmed.userId !== userId) throw new Error('账号已变化，旧请求结果已忽略');
      if (!acceptSavedProfileSignature(userId, confirmed.signature, generation)) {
        throw new Error('资料状态已变化，请重新载入后确认；本次请求不会自动重发');
      }
      return confirmed.signature;
    },
  });
  const guard = useLeaveGuard(
    () => editor.dirty || editor.saving,
    '个性签名尚未保存，请确认后再离开。',
    '签名离开保护初始化失败，请重新打开页面后重试。',
    () => !editor.saving && window.confirm('个性签名尚未保存。确认放弃当前草稿并离开？'),
  );
  if (userId === null) return null;
  return <section className="rounded-2xl border bg-white p-4" aria-label="个人资料">
    <h3 className="mb-3 font-semibold text-gray-900">个人资料</h3>
    {state.verification !== 'verified' && <p className="mb-3 text-xs text-gray-500">当前账号尚未验证；草稿可保留，验证成功后由你点击保存。</p>}
    <ProfileSignatureField editor={{ ...editor, canSave: editor.canSave && guard.ready }} />
    {editor.error && <div className="mt-2 text-xs text-gray-500">
      请求中断时服务端仍可能已保存；可先读取线上签名核对，再决定是否重试。
      <button type="button" className="ml-2 underline" disabled={editor.saving} onClick={retry}>读取线上签名</button>
    </div>}
    {error && <div className="mt-2 text-xs text-red-800">{error} <button type="button" className="underline" onClick={retry}>重试载入</button></div>}
    {guard.message && <p role="alert" className="mt-2 text-xs text-red-800">{guard.message}</p>}
  </section>;
}
