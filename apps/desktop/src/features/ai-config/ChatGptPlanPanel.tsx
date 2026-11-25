import { useState } from 'react';
import { ArrowUpRight, Check, LogIn, LogOut, RefreshCw, UsersRound, X } from 'lucide-react';
import { Button } from '@mahoshojo/ui-web/card-library';
import { useExternalLinks } from '../external-links/external-links-provider';
import type { UseDesktopAiConfigResult } from './use-desktop-ai-config';

export function ChatGptPlanPanel({ state, store }: UseDesktopAiConfigResult) {
  const { openFixed } = useExternalLinks();
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const plan = state.chatgptPlan;
  if (plan?.supported === false || (!plan && !state.chatgptError)) return null;
  const busy = state.chatgptOperation !== null;
  const selected = state.selection.executionPreference === 'client' && state.selection.clientTarget?.kind === 'chatgpt-plan' &&
    state.selection.clientTarget.connectionId === plan?.connectionId;
  const activate = () => {
    try { store.activateChatgptPlan(); setSelectionError(null); }
    catch (failure) { setSelectionError(failure instanceof Error ? failure.message : '无法保存订阅选择。'); }
  };
  return <section className="flex flex-col gap-2 border-t border-(--app-border) pt-3" aria-label="ChatGPT 订阅连接">
    <h3 className="battle-lite-strong-text text-sm font-medium">ChatGPT 订阅</h3>
    <p className="battle-lite-muted-text text-xs">符合条件的订阅账户可以直接向 OpenAI 发送生成请求。使用此连接会消耗该账户的 ChatGPT 用量。</p>
    <p className="battle-lite-muted-text text-xs">应用在本机保存授权和用于区分账户的资料。所选功能的提示词及必要上下文会发给 OpenAI。<button type="button" className="battle-lite-link underline" onClick={() => openFixed('https://openai.com/policies/privacy-policy/')}>OpenAI 隐私政策</button></p>
    {plan?.accountLabel && <p className="break-all text-sm">{plan.accountLabel} · {plan.connected ? selected ? '正在使用 ChatGPT 订阅' : '已连接' : plan.consentRequired ? '待授权订阅用量' : '已断开'}</p>}
    {state.chatgptOperation === 'connect' && <p role="status" className="text-xs">请在系统浏览器完成 ChatGPT 授权。</p>}
    {state.chatgptOperation === 'load' && <p role="status" className="text-xs">正在读取 ChatGPT 连接和模型…</p>}
    {state.chatgptOperation === 'disconnect' && <p role="status" className="text-xs">正在断开 ChatGPT 连接…</p>}
    {(state.chatgptError || selectionError) && <p role="alert" className="text-sm">{state.chatgptError ?? selectionError}</p>}
    {plan?.revocationUnconfirmed && <p role="status" className="text-xs">本机授权已清除。可在 ChatGPT 的安全设置中检查并解除应用连接。</p>}
    <div className="flex flex-wrap items-center gap-2">
      {state.chatgptOperation === 'connect'
        ? <Button className="ui-web-settings-motion" onClick={() => void store.cancelChatgptPlanConnect()}>
          <X size={16} aria-hidden="true" />取消连接
        </Button>
        : plan?.connected ? <>
          {!selected && <Button
            className="ui-web-settings-motion"
            variant="primary"
            disabled={busy || !plan.models.length || state.overlayState !== 'ready'}
            onClick={activate}
          >
            <Check size={16} aria-hidden="true" />使用此连接
          </Button>}
          <Button className="ui-web-settings-motion" disabled={busy} onClick={() => void store.refreshChatgptPlan()}>
            <RefreshCw size={16} aria-hidden="true" />刷新模型
          </Button>
          <Button className="ui-web-settings-motion" disabled={busy} onClick={() => void store.disconnectChatgptPlan()}>
            <LogOut size={16} aria-hidden="true" />断开连接
          </Button>
        </> : plan ? <>
          <Button className="ui-web-settings-motion" variant="neutral" disabled={busy} onClick={() => void store.connectChatgptPlan()}>
            <LogIn size={16} aria-hidden="true" />Continue with ChatGPT
          </Button>
          {plan.connectionId && <Button className="ui-web-settings-motion" disabled={busy} onClick={() => void store.connectChatgptPlan(true)}>
            <UsersRound size={16} aria-hidden="true" />连接其他账户或工作区
          </Button>}
        </> : <Button className="ui-web-settings-motion" disabled={busy} onClick={() => void store.refreshChatgptPlan()}>
          <RefreshCw size={16} aria-hidden="true" />重新读取连接
        </Button>}
      <Button className="ui-web-settings-motion" onClick={() => openFixed('https://chatgpt.com/settings/usage')}>
        <ArrowUpRight size={16} aria-hidden="true" />管理用量
      </Button>
      {plan?.revocationUnconfirmed && <Button className="ui-web-settings-motion" onClick={() => openFixed('https://chatgpt.com/settings/security')}>
        <ArrowUpRight size={16} aria-hidden="true" />打开安全设置
      </Button>}
    </div>
  </section>;
}
