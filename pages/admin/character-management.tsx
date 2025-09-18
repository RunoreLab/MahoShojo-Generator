// pages/admin/character-management.tsx

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { debounce } from 'lodash';

// 定义数据卡类型接口
interface DataCard {
  id: string;
  name: string;
  type: 'character' | 'scenario';
  is_public: -1 | 0 | 1;
  review_status: 'pending' | 'approved' | 'rejected';
  username: string;
  like_count: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

const CharacterManagementPage: React.FC = () => {
  const router = useRouter();
  const [dataCards, setDataCards] = useState<DataCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    search: '',
    reviewStatus: '',
    isPublic: '',
    type: '',
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false); // [新增] 导出状态

  // 从 URL 查询参数初始化筛选器状态
  useEffect(() => {
    if (router.isReady) {
      setFilters(prev => ({
        ...prev,
        page: parseInt(router.query.page as string || '1', 10),
        search: router.query.search as string || '',
        reviewStatus: router.query.reviewStatus as string || '',
        isPublic: router.query.isPublic as string || '',
        type: router.query.type as string || '',
      }));
    }
  }, [router.isReady, router.query]);

  // 获取数据
  const fetchData = useCallback(async (currentFilters: typeof filters) => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const params = new URLSearchParams({
        page: currentFilters.page.toString(),
        limit: currentFilters.limit.toString(),
        search: currentFilters.search,
        reviewStatus: currentFilters.reviewStatus,
        isPublic: currentFilters.isPublic,
        type: currentFilters.type,
      });
      const response = await fetch(`/api/admin/data-cards?${params.toString()}`);
      if (!response.ok) throw new Error('获取数据失败');
      const data = await response.json();
      setDataCards(data.cards);
      setTotal(data.total);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 当筛选器状态变化时，更新URL并获取数据
  useEffect(() => {
    if (router.isReady) {
      const query: { [key: string]: any } = {};
      if (filters.page > 1) query.page = filters.page;
      if (filters.search) query.search = filters.search;
      if (filters.reviewStatus) query.reviewStatus = filters.reviewStatus;
      if (filters.isPublic) query.isPublic = filters.isPublic;
      if (filters.type) query.type = filters.type;

      router.push({
        pathname: '/admin/character-management',
        query: query,
      }, undefined, { shallow: true });
      
      fetchData(filters);
    }
  }, [filters, router, fetchData]);
  
  const debouncedSetSearch = useCallback(
    debounce((value: string) => {
      setFilters(prev => ({ ...prev, search: value, page: 1 }));
    }, 500),
    []
  );

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'search') {
      const input = e.target as HTMLInputElement;
      debouncedSetSearch(input.value);
    } else {
      setFilters(prev => ({ ...prev, [name]: value, page: 1 }));
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= Math.ceil(total / filters.limit)) {
      setFilters(prev => ({ ...prev, page: newPage }));
    }
  };
  
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(dataCards.map(card => card.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(id)) {
      newSelectedIds.delete(id);
    } else {
      newSelectedIds.add(id);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleBatchAction = async (action: string, value?: any) => {
    if (selectedIds.size === 0) {
      alert('请至少选择一个项目');
      return;
    }
    const confirmMessage = `确定要对选中的 ${selectedIds.size} 个项目执行此操作吗？`;
    if (!window.confirm(confirmMessage)) return;

    try {
      const response = await fetch('/api/admin/data-cards/batch-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: Array.from(selectedIds), action, value }),
      });
      if (!response.ok) throw new Error('操作失败');
      alert('操作成功！');
      fetchData(filters);
    } catch (error) {
      alert('操作失败，请查看控制台');
      console.error('批量操作失败:', error);
    }
  };

  // [新增] 批量导出处理函数
  const handleExport = async () => {
    if (selectedIds.size === 0) {
      alert('请至少选择一个项目进行导出');
      return;
    }
    setIsExporting(true);
    try {
      const response = await fetch('/api/admin/export-data-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: Array.from(selectedIds) }),
      });
      if (!response.ok) throw new Error('导出失败');

      const result = await response.json();
      if (!result.success) throw new Error(result.error || '导出失败');

      // 创建并下载JSON文件
      const jsonData = JSON.stringify(result.data, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exported_data_cards_${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      alert('导出失败，请查看控制台');
      console.error('导出失败:', error);
    } finally {
      setIsExporting(false);
    }
  };


  const totalPages = Math.ceil(total / filters.limit);
  
  const getReviewStatusBadge = (status: DataCard['review_status']) => {
      const map = {
          pending: { text: '待审查', color: 'bg-yellow-100 text-yellow-800' },
          approved: { text: '已通过', color: 'bg-green-100 text-green-800' },
          rejected: { text: '未通过', color: 'bg-red-100 text-red-800' },
      };
      return <span className={`px-2 py-1 text-xs font-medium rounded-full ${map[status].color}`}>{map[status].text}</span>;
  };
  
  const getPublicStatusBadge = (status: DataCard['is_public']) => {
      const map = {
          '1': { text: '公开', color: 'bg-blue-100 text-blue-800' },
          '0': { text: '私有', color: 'bg-gray-100 text-gray-800' },
          '-1': { text: '封禁', color: 'bg-zinc-200 text-zinc-800 font-bold' },
      };
      const key = String(status);
      return <span className={`px-2 py-1 text-xs font-medium rounded-full ${map[key as keyof typeof map].color}`}>{map[key as keyof typeof map].text}</span>;
  };

  return (
    <>
      <Head>
        <title>内容档案管理 - Admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4">
            <Link href="/admin">
              <span className="text-sm text-purple-600 hover:underline cursor-pointer">&larr; 返回管理后台主页</span>
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-4">内容档案管理</h1>

          {/* 筛选器区域 */}
          <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <input
                type="text"
                name="search"
                defaultValue={router.query.search || ''} // 使用 router.query 初始化以避免UI跳动
                onChange={handleFilterChange}
                placeholder="搜索名称、描述、作者..."
                className="input-field"
              />
              <select name="reviewStatus" value={filters.reviewStatus} onChange={handleFilterChange} className="input-field">
                <option value="">所有审查状态</option>
                <option value="pending">待审查</option>
                <option value="approved">已通过</option>
                <option value="rejected">未通过</option>
              </select>
              <select name="isPublic" value={filters.isPublic} onChange={handleFilterChange} className="input-field">
                <option value="">所有公开状态</option>
                <option value="1">公开</option>
                <option value="0">私有</option>
                <option value="-1">封禁</option>
              </select>
              <select name="type" value={filters.type} onChange={handleFilterChange} className="input-field">
                <option value="">所有类型</option>
                <option value="character">角色</option>
                <option value="scenario">情景</option>
              </select>
            </div>
          </div>

          {/* 操作栏 */}
          <div className="bg-white p-4 rounded-lg shadow-sm mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600 mr-4">选中 {selectedIds.size} / {dataCards.length} 项 (共 {total} 项)</span>
            <div className="flex-grow flex flex-wrap gap-2">
                <button onClick={() => handleBatchAction('approve')} className="admin-button-sm bg-green-500 hover:bg-green-600">通过审查</button>
                <button onClick={() => handleBatchAction('reject')} className="admin-button-sm bg-red-500 hover:bg-red-600">拒绝审查</button>
                <button onClick={() => handleBatchAction('set_public_status', 1)} className="admin-button-sm bg-blue-500 hover:bg-blue-600">设为公开</button>
                <button onClick={() => handleBatchAction('set_public_status', 0)} className="admin-button-sm bg-gray-500 hover:bg-gray-600">设为私有</button>
                <button onClick={() => handleBatchAction('set_public_status', -1)} className="admin-button-sm bg-zinc-500 hover:bg-zinc-600">设为封禁</button>
                {/* [修改] 激活导出按钮 */}
                <button onClick={handleExport} className="admin-button-sm bg-teal-500 hover:bg-teal-600 disabled:opacity-50" disabled={isExporting || selectedIds.size === 0}>
                  {isExporting ? '导出中...' : '导出选中项'}
                </button>
            </div>
          </div>

          {/* 数据表格 */}
          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-500">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                  <th scope="col" className="p-4"><input type="checkbox" onChange={handleSelectAll} checked={selectedIds.size === dataCards.length && dataCards.length > 0} /></th>
                  <th scope="col" className="px-6 py-3">名称 / 作者</th>
                  <th scope="col" className="px-6 py-3">类型</th>
                  <th scope="col" className="px-6 py-3">公开状态</th>
                  <th scope="col" className="px-6 py-3">审查状态</th>
                  <th scope="col" className="px-6 py-3">点赞/使用</th>
                  <th scope="col" className="px-6 py-3">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center p-8">加载中...</td></tr>
                ) : dataCards.length === 0 ? (
                  <tr><td colSpan={7} className="text-center p-8">未找到符合条件的数据</td></tr>
                ) : (
                  dataCards.map(card => (
                    <tr key={card.id} className="bg-white border-b hover:bg-gray-50">
                      <td className="p-4"><input type="checkbox" onChange={() => handleSelectOne(card.id)} checked={selectedIds.has(card.id)} /></td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{card.name}</div>
                        <div className="text-xs text-gray-500">by {card.username}</div>
                      </td>
                      <td className="px-6 py-4">{card.type === 'character' ? '角色' : '情景'}</td>
                      <td className="px-6 py-4">{getPublicStatusBadge(card.is_public)}</td>
                      <td className="px-6 py-4">{getReviewStatusBadge(card.review_status)}</td>
                      <td className="px-6 py-4">{card.like_count} / {card.usage_count}</td>
                      <td className="px-6 py-4">{new Date(card.updated_at).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
              <div className="flex justify-between items-center mt-4 text-sm">
                  <button onClick={() => handlePageChange(filters.page - 1)} disabled={loading || filters.page <= 1} className="admin-button-sm">上一页</button>
                  <span>第 {filters.page} / {totalPages} 页 (共 {total} 项)</span>
                  <button onClick={() => handlePageChange(filters.page + 1)} disabled={loading || filters.page >= totalPages} className="admin-button-sm">下一页</button>
              </div>
          )}
        </div>
      </div>
    </>
  );
};

export default CharacterManagementPage;