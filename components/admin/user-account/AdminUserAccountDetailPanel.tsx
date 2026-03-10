import type { Dispatch, SetStateAction } from 'react';
import { Activity, AlertTriangle, Clock, KeyRound, RefreshCw, Save, ShieldCheck, Users } from 'lucide-react';

import {
  DETAIL_TABS,
  type DetailTab,
  type EditorState,
  type UserAccountDetail,
  type UserAccountListItem,
  SummaryCard,
  StatusPill,
  formatDateTime,
  formatNumber,
  getDetailTabLabel,
} from '@/components/admin/user-account/shared';

type AdminUserAccountDetailPanelProps = {
  selectedUser: UserAccountListItem | null;
  detail: UserAccountDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  detailTab: DetailTab;
  setDetailTab: Dispatch<SetStateAction<DetailTab>>;
  editor: EditorState;
  setEditor: Dispatch<SetStateAction<EditorState>>;
  saving: boolean;
  loadDetail: (input: { userId?: number; username?: string }, options?: { tab?: DetailTab }) => Promise<void>;
  runBatchAction: (action: 'set_exempt' | 'remove_exempt' | 'ban' | 'unban', userIds?: number[]) => Promise<void>;
  saveCurrentUser: () => Promise<void>;
};

function DetailKeyValueList(props: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="space-y-2 text-sm text-slate-700">
      {props.items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <dt className="text-slate-500">{item.label}</dt>
          <dd className="break-all text-left sm:text-right">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminUserAccountDetailPanel(props: AdminUserAccountDetailPanelProps) {
  const { selectedUser, detail, detailLoading, detailError, detailTab, setDetailTab, editor, setEditor, saving, loadDetail, runBatchAction, saveCurrentUser } = props;

  return (
    <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">用户详情</h2>
          <p className="text-xs text-slate-500">基础信息、认证状态、迁移判断与安全审计集中在同一面板。</p>
        </div>
        {selectedUser ? (
          <button
            type="button"
            onClick={() => void loadDetail({ userId: selectedUser.id })}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${detailLoading ? 'animate-spin' : ''}`} />
            刷新详情
          </button>
        ) : null}
      </div>

      {detailError ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{detailError}</div> : null}

      {!selectedUser ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          从左侧列表选择一名用户，或通过主页快捷跳转带 `search` / `username` 参数打开。
        </div>
      ) : detailLoading && !detail ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">正在读取详情…</div>
      ) : detail ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {DETAIL_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDetailTab(tab)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  detailTab === tab ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {getDetailTabLabel(tab)}
              </button>
            ))}
          </div>

          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">{detail.user.username}</h3>
              <span className="text-xs text-slate-400">#{detail.user.id}</span>
              {detail.user.isBanned ? <StatusPill tone="red">已封禁</StatusPill> : <StatusPill tone="green">正常</StatusPill>}
              {detail.user.isReviewExempt ? <StatusPill tone="amber">审查豁免</StatusPill> : null}
              {detail.user.auth.migrationRequired ? <StatusPill tone="red">待迁移</StatusPill> : <StatusPill tone="green">迁移完成</StatusPill>}
            </div>
            <p className="mt-2 break-all text-sm text-slate-600">{detail.user.businessEmail}</p>
          </div>

          {detailTab === 'basic' ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-900">可编辑业务字段</h4>
                <div className="space-y-3">
                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block text-xs font-medium text-slate-500">槽位数量</span>
                    <input
                      value={editor.slotCount}
                      onChange={(event) => setEditor((prev) => ({ ...prev, slotCount: event.target.value }))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      placeholder="为空表示 NULL"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block text-xs font-medium text-slate-500">前缀</span>
                    <input
                      value={editor.prefix}
                      onChange={(event) => setEditor((prev) => ({ ...prev, prefix: event.target.value }))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      placeholder="例如：魔法评审官"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block text-xs font-medium text-slate-500">封禁原因</span>
                    <textarea
                      value={editor.banReason}
                      onChange={(event) => setEditor((prev) => ({ ...prev, banReason: event.target.value }))}
                      className="h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      placeholder="留空表示解封"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveCurrentUser()}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      保存业务字段
                    </button>
                    <button
                      type="button"
                      onClick={() => void runBatchAction(detail.user.isReviewExempt ? 'remove_exempt' : 'set_exempt', [detail.user.id])}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700"
                    >
                      {detail.user.isReviewExempt ? '取消审查豁免' : '设为审查豁免'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">创作概览</h4>
                  <p className="text-xs text-slate-500">改为纵向信息段，避免中等屏宽下表单与统计卡相互挤压。</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SummaryCard title="总卡片" value={formatNumber(detail.user.totalCards)} icon={Users} color="bg-sky-600" />
                  <SummaryCard title="公开卡片" value={formatNumber(detail.user.publicCards)} icon={Users} color="bg-emerald-600" />
                  <SummaryCard title="封禁卡片" value={formatNumber(detail.user.bannedCards)} icon={AlertTriangle} color="bg-rose-600" />
                  <SummaryCard title="驳回卡片" value={formatNumber(detail.user.rejectedCards)} icon={AlertTriangle} color="bg-amber-600" />
                </div>
              </div>
            </div>
          ) : null}

          {detailTab === 'auth' ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-900">认证映射</h4>
                <DetailKeyValueList
                  items={[
                    { label: 'Auth 用户 ID', value: detail.user.auth.authUserId ?? '—' },
                    { label: 'Auth 邮箱', value: detail.user.auth.authEmail ?? '—' },
                    { label: '业务 / Auth 邮箱一致', value: detail.user.auth.authEmailMatchesBusinessEmail ? '是' : '否' },
                    { label: '最近认证来源', value: detail.user.auth.latestAuthSource ?? '—' },
                  ]}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">认证健康度</h4>
                  <p className="text-xs text-slate-500">由双栏改为上下分段，避免标签堆叠时遮挡右侧统计。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.user.auth.hasAuthLink ? <StatusPill tone="blue">已建链</StatusPill> : <StatusPill tone="red">未建链</StatusPill>}
                  {detail.user.auth.hasPassword ? <StatusPill tone="green">已设密</StatusPill> : <StatusPill tone="amber">未设密</StatusPill>}
                  {detail.user.auth.authEmailVerified ? <StatusPill tone="green">邮箱已验证</StatusPill> : <StatusPill tone="amber">邮箱未验证</StatusPill>}
                  {detail.user.auth.legacyOnly ? <StatusPill tone="red">Legacy Only</StatusPill> : <StatusPill tone="green">可用 Better Auth</StatusPill>}
                </div>
                <div className="mt-4">
                  <DetailKeyValueList
                    items={[
                      { label: '最近 Auth 事件', value: formatDateTime(detail.user.auth.latestAuthEventAt) },
                      { label: '24h 成功 / 失败', value: `${formatNumber(detail.user.auth.authSuccess24h)} / ${formatNumber(detail.user.auth.authFailures24h)}` },
                      { label: '7d 失败事件', value: formatNumber(detail.user.auth.authFailures7d) },
                    ]}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {detailTab === 'migration' ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-900">迁移判定</h4>
                <div className="space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="font-medium text-slate-900">{detail.user.auth.migrationRequired ? '该用户仍处于待迁移状态' : '该用户已满足当前迁移条件'}</div>
                    <p className="mt-1 text-xs text-slate-500">当前口径：未建链或未设置密码视为迁移未完成；邮箱验证单独展示，不阻断 legacyOnly 判断。</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <KeyRound className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      建链：{detail.user.auth.hasAuthLink ? '已完成' : '缺失'}
                      <br />
                      密码：{detail.user.auth.hasPassword ? '已设置' : '未设置'}
                      <br />
                      验邮：{detail.user.auth.authEmailVerified ? '已验证' : '未验证'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-900">关键时间点</h4>
                <DetailKeyValueList
                  items={[
                    { label: '最近设密成功', value: formatDateTime(detail.auth.lastPasswordSetAt) },
                    { label: '最近改密成功', value: formatDateTime(detail.auth.lastPasswordChangeAt) },
                    { label: '最近改绑邮箱成功', value: formatDateTime(detail.auth.lastEmailChangeAt) },
                    { label: '最近重置密码申请', value: formatDateTime(detail.auth.lastPasswordResetRequestedAt) },
                    { label: '最近邮件频控命中', value: formatDateTime(detail.auth.lastMailRateLimitedAt) },
                  ]}
                />
              </div>
            </div>
          ) : null}

          {detailTab === 'audit' ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard title="审计总事件" value={formatNumber(detail.audit.totalEvents)} icon={Activity} color="bg-slate-700" />
                <SummaryCard title="成功事件" value={formatNumber(detail.audit.successEvents)} icon={ShieldCheck} color="bg-emerald-600" />
                <SummaryCard title="失败事件" value={formatNumber(detail.audit.failureEvents)} icon={AlertTriangle} color="bg-rose-600" />
                <SummaryCard
                  title="24h / 7d 失败"
                  value={`${formatNumber(detail.audit.failureEvents24h)} / ${formatNumber(detail.audit.failureEvents7d)}`}
                  icon={Clock}
                  color="bg-orange-600"
                />
              </div>

              <div className="rounded-2xl border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-3">
                  <h4 className="text-sm font-semibold text-slate-900">最近 25 条审计事件</h4>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">时间</th>
                        <th className="px-4 py-3">事件</th>
                        <th className="px-4 py-3">来源</th>
                        <th className="px-4 py-3">结果</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.recentAuditEvents.length <= 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                            暂无审计事件
                          </td>
                        </tr>
                      ) : (
                        detail.recentAuditEvents.map((event) => (
                          <tr key={event.id}>
                            <td className="px-4 py-3 align-top text-xs text-slate-500">{formatDateTime(event.createdAt)}</td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-medium text-slate-900">{event.eventType}</div>
                              <div className="mt-1 text-xs text-slate-500">{event.identifierType ?? '未标注 identifierType'}</div>
                            </td>
                            <td className="px-4 py-3 align-top text-xs text-slate-600">{event.authSource}</td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-medium text-slate-900">{event.resultCode}</div>
                              {event.resultMessage ? <div className="mt-1 text-xs text-slate-500">{event.resultMessage}</div> : null}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {detailTab === 'activity' ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-900">时间轴</h4>
                <DetailKeyValueList
                  items={[
                    { label: '注册时间', value: formatDateTime(detail.user.createdAt) },
                    { label: '最近登录', value: formatDateTime(detail.user.lastLoginAt) },
                    { label: '最近活跃', value: formatDateTime(detail.user.lastActiveAt) },
                    { label: '最近 Auth 审计', value: formatDateTime(detail.user.auth.latestAuthEventAt) },
                  ]}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-900">账号健康度</h4>
                <div className="space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    最近 24 小时 Auth 成功 {formatNumber(detail.user.auth.authSuccess24h)} 次，失败 {formatNumber(detail.user.auth.authFailures24h)} 次。
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    最近 7 天 Auth 失败 {formatNumber(detail.user.auth.authFailures7d)} 次。若这里异常升高，再结合安全审计标签页查看失败原因。
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
