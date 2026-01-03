import { useEffect, useMemo, useState } from 'react';

type Tag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: 'user' | 'system' | 'admin';
  isActive: boolean;
};

const fetchTags = async (): Promise<Tag[]> => {
  const res = await fetch('/api/tags');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { success: boolean; tags: Tag[] };
  return json.tags ?? [];
};

export function TagsLibraryPanel() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchTags()
      .then((data) => {
        if (cancelled) return;
        setTags(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tags
      .filter((tag) => (includeInactive ? true : tag.isActive))
      .filter((tag) => {
        if (!q) return true;
        return (
          tag.name.toLowerCase().includes(q) ||
          tag.id.toLowerCase().includes(q) ||
          (tag.category ?? '').toLowerCase().includes(q) ||
          (tag.description ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const category = (a.category ?? '').localeCompare(b.category ?? '', 'zh-CN');
        if (category !== 0) return category;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  }, [tags, includeInactive, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Tag[]>();
    for (const tag of filtered) {
      const key = tag.category ?? '未分类';
      const arr = map.get(key) ?? [];
      arr.push(tag);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
  }, [filtered]);

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-800">标签库（来自 /api/tags）</h3>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          <span>包含未启用</span>
        </label>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索标签名称 / 分类 / 描述 / id..."
        className="input-field mt-3 w-full"
      />

      {loading ? (
        <div className="mt-3 text-sm text-gray-500">正在加载标签库...</div>
      ) : error ? (
        <div className="mt-3 text-sm text-red-600">加载失败：{error}</div>
      ) : grouped.length === 0 ? (
        <div className="mt-3 text-sm text-gray-500">暂无匹配的标签</div>
      ) : (
        <div className="mt-4 space-y-4">
          {grouped.map(([category, categoryTags]) => (
            <div key={category}>
              <div className="text-xs font-medium text-gray-700">{category}</div>
              <div className="mt-2 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600 border-b">
                      <th className="py-2 pr-3 whitespace-nowrap">名称</th>
                      <th className="py-2 pr-3 whitespace-nowrap">scope</th>
                      <th className="py-2 pr-3 whitespace-nowrap">状态</th>
                      <th className="py-2 pr-3 min-w-[240px]">说明</th>
                      <th className="py-2 pr-3 whitespace-nowrap">id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryTags.map((tag) => (
                      <tr key={tag.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">{tag.name}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{tag.scope}</td>
                        <td className="py-2 pr-3 text-xs">{tag.isActive ? '启用' : '停用'}</td>
                        <td className="py-2 pr-3 text-gray-700">{tag.description ?? '—'}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-gray-500 whitespace-nowrap">{tag.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

