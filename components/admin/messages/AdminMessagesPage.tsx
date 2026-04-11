import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { AdminDirectMessageDto, AdminMessageScope, AdminSiteMessageDto } from '@/lib/admin/messages';
import type { MessagePriority } from '@/lib/messages/types';

type AdminMessagesResponse = {
  siteMessages: AdminSiteMessageDto[];
  directMessages: AdminDirectMessageDto[];
  fetchedAt: string;
  error?: string;
};

const SCOPE_OPTIONS: Array<{ value: AdminMessageScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'site', label: '全站消息' },
  { value: 'direct', label: '定向消息' },
];

const PRIORITY_OPTIONS: MessagePriority[] = ['low', 'normal', 'high'];

export function AdminMessagesPage() {
  const [scope, setScope] = useState<AdminMessageScope>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [siteMessages, setSiteMessages] = useState<AdminSiteMessageDto[]>([]);
  const [directMessages, setDirectMessages] = useState<AdminDirectMessageDto[]>([]);

  const [siteForm, setSiteForm] = useState({
    messageType: 'generic',
    templateKey: 'site.generic.notice',
    titleText: '',
    bodyText: '',
    actionUrl: '',
    priority: 'normal' as MessagePriority,
    expiresAt: '',
    payloadText: '{}',
  });
  const [directForm, setDirectForm] = useState({
    recipientUserIdsText: '',
    messageType: 'generic',
    templateKey: 'user.generic.notice',
    titleText: '',
    bodyText: '',
    actionUrl: '',
    priority: 'normal' as MessagePriority,
    expiresAt: '',
    payloadText: '{}',
  });
  const [sendingSite, setSendingSite] = useState(false);
  const [sendingDirect, setSendingDirect] = useState(false);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/messages?scope=${encodeURIComponent(scope)}`);
      const payload = (await response.json()) as AdminMessagesResponse;
      if (!response.ok) {
        throw new Error(payload.error || '获取消息列表失败');
      }
      setSiteMessages(payload.siteMessages);
      setDirectMessages(payload.directMessages);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '获取消息列表失败');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const sitePayloadPreview = useMemo(() => siteForm.payloadText.trim(), [siteForm.payloadText]);
  const directPayloadPreview = useMemo(() => directForm.payloadText.trim(), [directForm.payloadText]);

  const handleSendSiteMessage = async () => {
    setSendingSite(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/messages/site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...siteForm,
          payload: sitePayloadPreview ? JSON.parse(sitePayloadPreview) : {},
          expiresAt: siteForm.expiresAt || null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '发送全站消息失败');
      }
      await loadMessages();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '发送全站消息失败');
    } finally {
      setSendingSite(false);
    }
  };

  const handleSendDirectMessage = async () => {
    setSendingDirect(true);
    setError(null);
    try {
      const recipientUserIds = directForm.recipientUserIdsText
        .split(/[,\s\n]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => Number.parseInt(item, 10));
      const response = await fetch('/api/admin/messages/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...directForm,
          recipientUserIds,
          payload: directPayloadPreview ? JSON.parse(directPayloadPreview) : {},
          expiresAt: directForm.expiresAt || null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '发送定向消息失败');
      }
      await loadMessages();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '发送定向消息失败');
    } finally {
      setSendingDirect(false);
    }
  };

  const handleExpireSiteMessage = async (id: number) => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/messages/site/${id}/expire`, { method: 'POST' });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '消息失效失败');
      }
      await loadMessages();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '消息失效失败');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div>
          <Link href="/admin" className="text-sm text-purple-600 hover:underline">
            &larr; 返回管理后台主页
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">消息管理</h1>
              <p className="mt-2 text-sm text-gray-500">发送全站通知、定向消息，并查看最近消息状态。</p>
            </div>
            <div className="w-full md:w-48">
              <label className="mb-1 block text-sm font-medium text-gray-700">列表筛选</label>
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as AdminMessageScope)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">发送全站消息</h2>
            <div className="mt-4 grid gap-3">
              <input
                value={siteForm.messageType}
                onChange={(event) => setSiteForm((prev) => ({ ...prev, messageType: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="messageType，例如 issue"
              />
              <input
                value={siteForm.templateKey}
                onChange={(event) => setSiteForm((prev) => ({ ...prev, templateKey: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="templateKey，例如 site.issue.update"
              />
              <input
                value={siteForm.titleText}
                onChange={(event) => setSiteForm((prev) => ({ ...prev, titleText: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="标题兜底"
              />
              <textarea
                value={siteForm.bodyText}
                onChange={(event) => setSiteForm((prev) => ({ ...prev, bodyText: event.target.value }))}
                className="min-h-28 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="正文兜底"
              />
              <div className="grid gap-3 md:grid-cols-3">
                <input
                  value={siteForm.actionUrl}
                  onChange={(event) => setSiteForm((prev) => ({ ...prev, actionUrl: event.target.value }))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  placeholder="跳转链接"
                />
                <select
                  value={siteForm.priority}
                  onChange={(event) => setSiteForm((prev) => ({ ...prev, priority: event.target.value as MessagePriority }))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={siteForm.expiresAt}
                  onChange={(event) => setSiteForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
              <textarea
                value={siteForm.payloadText}
                onChange={(event) => setSiteForm((prev) => ({ ...prev, payloadText: event.target.value }))}
                className="min-h-28 rounded-xl border border-gray-200 px-3 py-2 font-mono text-sm"
                placeholder='JSON payload，例如 {"issueTitle":"服务状态"}'
              />
              <button
                type="button"
                onClick={() => void handleSendSiteMessage()}
                disabled={sendingSite}
                className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
              >
                {sendingSite ? '发送中...' : '发送全站消息'}
              </button>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">发送定向消息</h2>
            <div className="mt-4 grid gap-3">
              <textarea
                value={directForm.recipientUserIdsText}
                onChange={(event) => setDirectForm((prev) => ({ ...prev, recipientUserIdsText: event.target.value }))}
                className="min-h-20 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="接收用户 ID，支持英文逗号、空格或换行分隔"
              />
              <input
                value={directForm.messageType}
                onChange={(event) => setDirectForm((prev) => ({ ...prev, messageType: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="messageType，例如 moderation"
              />
              <input
                value={directForm.templateKey}
                onChange={(event) => setDirectForm((prev) => ({ ...prev, templateKey: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="templateKey，例如 user.generic.notice"
              />
              <input
                value={directForm.titleText}
                onChange={(event) => setDirectForm((prev) => ({ ...prev, titleText: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="标题兜底"
              />
              <textarea
                value={directForm.bodyText}
                onChange={(event) => setDirectForm((prev) => ({ ...prev, bodyText: event.target.value }))}
                className="min-h-28 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="正文兜底"
              />
              <div className="grid gap-3 md:grid-cols-3">
                <input
                  value={directForm.actionUrl}
                  onChange={(event) => setDirectForm((prev) => ({ ...prev, actionUrl: event.target.value }))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  placeholder="跳转链接"
                />
                <select
                  value={directForm.priority}
                  onChange={(event) => setDirectForm((prev) => ({ ...prev, priority: event.target.value as MessagePriority }))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={directForm.expiresAt}
                  onChange={(event) => setDirectForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
              <textarea
                value={directForm.payloadText}
                onChange={(event) => setDirectForm((prev) => ({ ...prev, payloadText: event.target.value }))}
                className="min-h-28 rounded-xl border border-gray-200 px-3 py-2 font-mono text-sm"
                placeholder='JSON payload，例如 {"summary":"请查看最新处理说明"}'
              />
              <button
                type="button"
                onClick={() => void handleSendDirectMessage()}
                disabled={sendingDirect}
                className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-800 disabled:opacity-60"
              >
                {sendingDirect ? '发送中...' : '发送定向消息'}
              </button>
            </div>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">最近全站消息</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3">模板 / 文案</th>
                    <th className="px-4 py-3">优先级</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        加载中...
                      </td>
                    </tr>
                  ) : siteMessages.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        暂无全站消息
                      </td>
                    </tr>
                  ) : (
                    siteMessages.map((message) => (
                      <tr key={message.id} className="border-t">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{message.title}</div>
                          <div className="mt-1 text-xs text-gray-500">{message.templateKey}</div>
                          <div className="mt-2 whitespace-pre-wrap text-gray-700">{message.body}</div>
                        </td>
                        <td className="px-4 py-3">{message.priority}</td>
                        <td className="px-4 py-3">
                          {message.isExpired ? <span className="text-red-600">已失效</span> : <span className="text-emerald-600">生效中</span>}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void handleExpireSiteMessage(message.id)}
                            disabled={message.isExpired}
                            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                          >
                            立即失效
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">最近定向消息</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3">接收者 / 模板</th>
                    <th className="px-4 py-3">正文</th>
                    <th className="px-4 py-3">已读</th>
                    <th className="px-4 py-3">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        加载中...
                      </td>
                    </tr>
                  ) : directMessages.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        暂无定向消息
                      </td>
                    </tr>
                  ) : (
                    directMessages.map((message) => (
                      <tr key={message.id} className="border-t">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">用户 {message.recipientUserId}</div>
                          <div className="mt-1 text-xs text-gray-500">{message.templateKey}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{message.title}</div>
                          <div className="mt-1 whitespace-pre-wrap text-gray-700">{message.body}</div>
                        </td>
                        <td className="px-4 py-3">{message.readAt ? '已读' : '未读'}</td>
                        <td className="px-4 py-3 text-gray-500">{new Date(message.createdAt).toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
