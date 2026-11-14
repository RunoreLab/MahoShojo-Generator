import type { ReactNode } from 'react';

/**
 * 账号区状态：`loading` 覆盖「查询/授权在途」，`unauthenticated` 必须是确认过的
 * 登出，`unknown` 是「尚未查询或服务不可达」——宿主不得把未知压扁成登出
 *（Desktop `idle`/`unreachable` 都属此类）。`unknown` 与 `unauthenticated` 渲染
 * 同一块宿主注入区，文案与动作由 `signedOut` 按实际语义给出。
 */
export type CharacterManagerAccountStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unknown';

export interface CharacterManagerMyDataCardsAction {
  readonly onOpen: () => void;
  readonly label?: ReactNode;
  /** 槽位计数；提供时渲染 `(已用/容量 槽)`。 */
  readonly usedSlots?: number | null;
  readonly capacity?: number | null;
}

export interface CharacterManagerSignedOutContent {
  readonly text?: ReactNode;
  readonly actionLabel?: ReactNode;
  readonly onAction?: () => void;
  /** 登录按钮旁的附加元素（Web：找回密码链接）。 */
  readonly extra?: ReactNode;
}

export interface CharacterManagerAccountPanelProps {
  readonly status: CharacterManagerAccountStatus;
  readonly loadingText?: ReactNode;
  readonly title?: ReactNode;
  /** 「用户中心」的操作项，由面板负责排列和换行。 */
  readonly actions?: ReactNode;
  /** 已登录分支顶部的提示条（Web：账号迁移提醒）。 */
  readonly banner?: ReactNode;
  readonly welcomePrefix?: ReactNode;
  readonly userDisplay?: ReactNode;
  /**
   * 「我的数据卡」CTA。由宿主按账号状态决定是否提供，始终指向云端卡管理；
   * 本地/公开卡的载入入口由导入或编辑区域承载，不复用此账号动作。
   */
  readonly myDataCards?: CharacterManagerMyDataCardsAction;
  /** 未登录分支文案与动作。 */
  readonly signedOut?: CharacterManagerSignedOutContent;
}

const MyDataCardsButton = ({ action }: { action: CharacterManagerMyDataCardsAction }) => (
  <button
    onClick={action.onOpen}
    className="flex items-center cursor-pointer justify-center w-full gap-2 px-8 py-2.5 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors font-medium"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
    <span className="text-sm">
      {action.label ?? '我的数据卡'}{' '}
      {typeof action.usedSlots === 'number' && typeof action.capacity === 'number' ? (
        <span className="font-bold">({action.usedSlots}/{action.capacity} 槽)</span>
      ) : null}
    </span>
  </button>
);

/**
 * 角色管理页的粉色账号区：标题行（用户中心 + 宿主动作）、欢迎行与「我的数据卡」CTA。
 * 未登录分支的文案、登录动作与找回密码等均由宿主注入——共享组件不知道账号系统长什么样。
 */
export function CharacterManagerAccountPanel({
  status,
  loadingText = '加载中...',
  title = '用户中心',
  actions,
  banner,
  welcomePrefix = '欢迎回来，',
  userDisplay,
  myDataCards,
  signedOut,
}: CharacterManagerAccountPanelProps) {
  return (
    <div className="mt-4 p-3 bg-pink-50 rounded-lg">
      {status === 'loading' ? (
        <p className="text-sm text-gray-600">{loadingText}</p>
      ) : status === 'authenticated' ? (
        <div className="space-y-4">
          {banner}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-left">
            <div className="shrink-0 whitespace-nowrap font-semibold text-pink-800 leading-[28px]">
              {title}
            </div>
            {actions ? <div className="flex max-w-full flex-wrap gap-2">{actions}</div> : null}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{welcomePrefix}</span>
              <div className="flex flex-col">
                {userDisplay}
              </div>
            </div>
          </div>
          {myDataCards ? (
            <div className="flex items-end justify-between">
              <MyDataCardsButton action={myDataCards} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-center">
          <p className="text-sm text-gray-600 mb-2">{signedOut?.text ?? '登录后可以保存和管理您的角色数据卡'}</p>
          {signedOut?.actionLabel ? (
            <button
              onClick={signedOut.onAction}
              className="px-4 py-2 bg-pink-600 text-white rounded hover:bg-pink-700"
            >
              {signedOut.actionLabel}
            </button>
          ) : null}
          {signedOut?.extra}
          {myDataCards ? (
            <div className="mt-3 flex items-end justify-between">
              <MyDataCardsButton action={myDataCards} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
