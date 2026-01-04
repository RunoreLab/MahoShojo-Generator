import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';

type TagScope = 'user' | 'system' | 'admin';

type TagRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagScope;
  isActive: boolean;
  aliasCount: number;
  createdAt: string;
  updatedAt: string;
};

type TagsResponse =
  | { success: true; tags: TagRow[]; total: number; page: number; limit: number }
  | { success: false; error?: string };

type TagAliasRow = {
  alias: string;
  tag_id: string;
  created_at: string;
};

type TagAliasesResponse =
  | { success: true; aliases: TagAliasRow[] }
  | { success: false; error?: string };

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
};

export default function AdminTagManagementPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 50;

  const [filters, setFilters] = useState({
    search: '',
    scope: 'all' as 'all' | TagScope,
    includeInactive: true,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTag = useMemo(() => tags.find((t) => t.id === selectedId) ?? null, [selectedId, tags]);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    id: '',
    name: '',
    description: '',
    category: '',
    scope: 'user' as TagScope,
    isActive: true,
  });

  const [aliasesLoading, setAliasesLoading] = useState(false);
  const [aliasesError, setAliasesError] = useState<string | null>(null);
  const [aliases, setAliases] = useState<TagAliasRow[]>([]);
  const [newAlias, setNewAlias] = useState('');

  const loadTags = async (nextPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(nextPage));
      params.set('limit', String(limit));
      params.set('includeInactive', filters.includeInactive ? '1' : '0');
      if (filters.search.trim()) params.set('search', filters.search.trim());
      if (filters.scope !== 'all') params.set('scope', filters.scope);

      const json = await fetchJson<TagsResponse>(`/api/admin/tags?${params.toString()}`);
      if (json.success !== true) throw new Error(json.error || '无法加载标签库');

      setTags(json.tags);
      setTotal(json.total);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  const loadAliases = async (tagId: string) => {
    setAliasesLoading(true);
    setAliasesError(null);
    try {
      const json = await fetchJson<TagAliasesResponse>(`/api/admin/tag-aliases?tagId=${encodeURIComponent(tagId)}&limit=500`);
      if (json.success !== true) throw new Error(json.error || '无法加载别名');
      setAliases(json.aliases);
    } catch (err) {
      setAliasesError(err instanceof Error ? err.message : '未知错误');
      setAliases([]);
    } finally {
      setAliasesLoading(false);
    }
  };

  useEffect(() => {
    void loadTags(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.includeInactive, filters.scope]);

  useEffect(() => {
    const id = selectedTag?.id ?? '';
    if (!id) {
      setAliases([]);
      setAliasesError(null);
      setAliasesLoading(false);
      return;
    }
    void loadAliases(id);
  }, [selectedTag?.id]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const startCreate = () => {
    setEditing(true);
    setSelectedId(null);
    setForm({ id: '', name: '', description: '', category: '', scope: 'user', isActive: true });
    setAliases([]);
    setNewAlias('');
  };

  const startEdit = (tag: TagRow) => {
    setEditing(true);
    setSelectedId(tag.id);
    setForm({
      id: tag.id,
      name: tag.name,
      description: tag.description ?? '',
      category: tag.category ?? '',
      scope: tag.scope,
      isActive: tag.isActive,
    });
    setNewAlias('');
  };

  const saveTag = async () => {
    if (!form.id.trim() || !form.name.trim()) {
      alert('请填写 id 和 name');
      return;
    }

    try {
      if (selectedId) {
        await fetchJson(`/api/admin/tags/${encodeURIComponent(selectedId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            description: form.description || null,
            category: form.category || null,
            scope: form.scope,
            isActive: form.isActive,
          }),
        });
      } else {
        await fetchJson('/api/admin/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: form.id,
            name: form.name,
            description: form.description || null,
            category: form.category || null,
            scope: form.scope,
            isActive: form.isActive,
          }),
        });
      }

      setEditing(false);
      await loadTags(1);
      if (form.id.trim()) setSelectedId(form.id.trim());
    } catch (err) {
      alert(`保存失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const deactivateTag = async () => {
    if (!selectedTag) return;
    if (!window.confirm(`确认停用标签 ${selectedTag.id} 吗？（将仅设置 is_active=0，不会删除绑定关系）`)) return;
    try {
      await fetchJson(`/api/admin/tags/${encodeURIComponent(selectedTag.id)}`, { method: 'DELETE' });
      await loadTags(page);
      setEditing(false);
    } catch (err) {
      alert(`停用失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const upsertAlias = async () => {
    if (!selectedTag) return;
    const alias = newAlias.trim();
    if (!alias) return;
    try {
      await fetchJson('/api/admin/tag-aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias, tagId: selectedTag.id }),
      });
      setNewAlias('');
      await loadAliases(selectedTag.id);
    } catch (err) {
      alert(`添加别名失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const removeAlias = async (alias: string) => {
    if (!window.confirm(`确认删除别名 “${alias}” 吗？`)) return;
    try {
      await fetchJson(`/api/admin/tag-aliases?alias=${encodeURIComponent(alias)}`, { method: 'DELETE' });
      if (selectedTag) await loadAliases(selectedTag.id);
    } catch (err) {
      alert(`删除失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  return (
    <>
      <Head>
        <title>标签库管理 - Admin</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/admin" className="text-sm text-purple-600 hover:underline">
              ← 返回管理后台主页
            </Link>
            <div className="flex items-center gap-2">
              <button
                onClick={startCreate}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700"
              >
                <Plus className="h-4 w-4" />
                新建标签
              </button>
            </div>
          </div>

          <h1 className="mb-4 text-2xl font-bold text-gray-800">标签库 / 别名管理</h1>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <input
                  className="input-field"
                  placeholder="搜索 id / name / category..."
                  value={filters.search}
                  onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    void loadTags(1);
                  }}
                />
                <select
                  className="input-field"
                  value={filters.scope}
                  onChange={(e) => setFilters((prev) => ({ ...prev, scope: e.target.value as any }))}
                >
                  <option value="all">所有 scope</option>
                  <option value="user">user</option>
                  <option value="system">system</option>
                  <option value="admin">admin</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={filters.includeInactive}
                    onChange={(e) => setFilters((prev) => ({ ...prev, includeInactive: e.target.checked }))}
                  />
                  包含停用
                </label>
              </div>

              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-gray-600">共 {total} 条</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void loadTags(1)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    disabled={loading}
                  >
                    刷新
                  </button>
                </div>
              </div>

              {error ? <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                    <tr>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">名称</th>
                      <th className="px-4 py-3">scope</th>
                      <th className="px-4 py-3">分类</th>
                      <th className="px-4 py-3">别名</th>
                      <th className="px-4 py-3">状态</th>
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {tags.map((t) => (
                      <tr
                        key={t.id}
                        className={`cursor-pointer hover:bg-gray-50 ${selectedId === t.id ? 'bg-purple-50' : ''}`}
                        onClick={() => setSelectedId(t.id)}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{t.id}</td>
                        <td className="px-4 py-3 text-gray-800">{t.name}</td>
                        <td className="px-4 py-3">{t.scope}</td>
                        <td className="px-4 py-3">{t.category ?? '—'}</td>
                        <td className="px-4 py-3">{t.aliasCount}</td>
                        <td className="px-4 py-3">{t.isActive ? '启用' : '停用'}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(t);
                            }}
                            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            编辑
                          </button>
                        </td>
                      </tr>
                    ))}
                    {tags.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                          {loading ? '加载中...' : '暂无数据'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                <span>
                  第 {page} / {totalPages} 页
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="admin-button-sm"
                    onClick={() => void loadTags(Math.max(1, page - 1))}
                    disabled={loading || page <= 1}
                  >
                    上一页
                  </button>
                  <button
                    className="admin-button-sm"
                    onClick={() => void loadTags(Math.min(totalPages, page + 1))}
                    disabled={loading || page >= totalPages}
                  >
                    下一页
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
              <h2 className="mb-3 text-lg font-semibold text-gray-800">编辑 / 别名</h2>

              {!editing && !selectedTag ? (
                <div className="text-sm text-gray-500">从左侧选择标签，或点击“新建标签”。</div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-600">ID</label>
                    <input
                      className="input-field mt-1"
                      value={form.id}
                      disabled={Boolean(selectedId)}
                      onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
                      placeholder="例如: style:daily"
                    />
                    <div className="mt-1 text-[11px] text-gray-500">仅允许字母数字，且可包含 : _ -</div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">名称</label>
                    <input
                      className="input-field mt-1"
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">分类</label>
                    <input
                      className="input-field mt-1"
                      value={form.category}
                      onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                      placeholder="例如: 题材/风格"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">scope</label>
                    <select
                      className="input-field mt-1"
                      value={form.scope}
                      onChange={(e) => setForm((prev) => ({ ...prev, scope: e.target.value as TagScope }))}
                    >
                      <option value="user">user</option>
                      <option value="system">system</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">描述</label>
                    <textarea
                      className="input-field mt-1 resize-y"
                      value={form.description}
                      rows={3}
                      onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                    />
                    启用（is_active）
                  </label>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={saveTag}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
                    >
                      <Save className="h-4 w-4" />
                      保存
                    </button>
                    {selectedTag ? (
                      <button
                        onClick={deactivateTag}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        停用
                      </button>
                    ) : null}
                  </div>

                  {selectedTag ? (
                    <div className="mt-6 border-t border-gray-100 pt-4">
                      <h3 className="text-sm font-semibold text-gray-800">别名</h3>
                      {aliasesError ? (
                        <div className="mt-2 text-xs text-red-600">{aliasesError}</div>
                      ) : aliasesLoading ? (
                        <div className="mt-2 text-xs text-gray-500">加载中...</div>
                      ) : null}

                      <div className="mt-3 flex items-center gap-2">
                        <input
                          className="input-field flex-1"
                          value={newAlias}
                          onChange={(e) => setNewAlias(e.target.value)}
                          placeholder="输入别名（如：元角色）"
                        />
                        <button
                          onClick={() => void upsertAlias()}
                          className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700"
                          disabled={!newAlias.trim()}
                        >
                          添加
                        </button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {aliases.map((a) => (
                          <div key={a.alias} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                            <div className="text-sm text-gray-800">{a.alias}</div>
                            <button
                              onClick={() => void removeAlias(a.alias)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              删除
                            </button>
                          </div>
                        ))}
                        {aliases.length === 0 && !aliasesLoading && (
                          <div className="text-xs text-gray-500">暂无别名</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
