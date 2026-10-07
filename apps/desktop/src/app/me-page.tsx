// Desktop `/me`：最小个人页（D5.1d-1）。
//
// 范围刻意收敛：账号身份投影（头像 + 名字）+ 会话状态与登录/退出操作面
// ——后者复用设置页同一块 `AccountPanel`，两份面板读同一个 store，语义
// 不可能分叉。战报记录等 Web 个人页内容尚未在 Desktop 交付，不在这里
// 放占位或死链（DESK-PROD-001）。
//
// 身份显示遵循与顶栏相同的诚实口径：`account` 是本机凭据投影（不可达
// 时依然显示并标注离线），绝不把本机缓存冒称服务端验证结果；
// `verification` 结论由 AccountPanel 的状态徽标如实表达。

import { AccountPanel } from '../features/account/AccountPanel';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useTopbarAvatar } from '../features/account/use-topbar-avatar';

export function DesktopMe() {
  const { state: cloudSession, store: sessionStore } = useDesktopCloudSession();
  const account = cloudSession.account;
  const avatarDataUrl = useTopbarAvatar(account, {
    onSessionRejected: () => void sessionStore.refresh(),
  });

  const displayName = account?.displayName ?? account?.username ?? null;
  const initial = displayName?.slice(0, 1).toUpperCase() ?? '？';

  return (
    <div data-testid="page-me" className="magic-background-white">
      <div className="container">
        <div className="card flex flex-col gap-6">
          <section className="flex items-center gap-4">
            {avatarDataUrl ? (
              <img
                src={avatarDataUrl}
                alt={displayName ?? '账号头像'}
                className="h-14 w-14 rounded-full border border-(--app-border) object-cover"
              />
            ) : (
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-(--app-border) bg-(--app-surface-muted) text-lg font-semibold text-(--app-text-muted)">
                {initial}
              </span>
            )}
            <div>
              <h1 className="text-xl font-bold">
                {displayName ?? '个人页'}
              </h1>
              {account !== null ? (
                <p className="text-sm text-(--app-text-muted)">@{account.username}</p>
              ) : (
                <p className="text-sm text-(--app-text-muted)">
                  登录云端账号后可同步消息与更多功能
                </p>
              )}
            </div>
          </section>

          <AccountPanel />
        </div>
      </div>
    </div>
  );
}
