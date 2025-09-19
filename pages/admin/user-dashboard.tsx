// pages/admin/user-dashboard.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { debounce } from 'lodash';

// 定义用户数据类型接口
interface User {
  id: number;
  username: string;
  email: string;
  is_banned: string | null;
  is_review_exempt: 0 | 1;
  created_at: string;
  last_login_at: string | null;
  total_cards: number;
  public_cards: number;
  banned_cards: number;
  rejected_cards: number;
}

const UserManagementPage: React.FC = () => {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    search: '',
    status: '',
    regDateStart: '',
    regDateEnd: '',
    loginDateStart: '',
    loginDateEnd: '',
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 从 URL 查询参数初始化筛选器状态
  const initializeFilters = useCallback(() => {
    if (router.isReady) {
      setFilters(prev => ({
        ...prev,
        page: parseInt(router.query.page as string || '1', 10),
        search: router.query.search as string || '',
        status: router.query.status as string || '',
        regDateStart: router.query.regDateStart as string || '',
        regDateEnd: router.query.regDateEnd as string || '',
        loginDateStart: router.query.loginDateStart as string || '',
        loginDateEnd: router.query.loginDateEnd as string || '',
      }));
    }
  }, [router.isReady, router.query]);

  useEffect(() => {
    initializeFilters();
  }, [initializeFilters]);
  
  // 获取数据
  const fetchData = useCallback(async (currentFilters: typeof filters) => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
        const params = new URLSearchParams();
        Object.entries(currentFilters).forEach(([key, value]) => {
            if (value) params.append(key, String(value));
        });

      const response = await fetch(`/api/admin/users?${params.toString()}`);
      if (!response.ok) throw new Error('获取用户数据失败');
      const data = await response.json();
      setUsers(data.users);
      setTotal(data.total);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 当筛选器状态变化时（由 router.query 触发），获取数据
  useEffect(() => {
    if (router.isReady) {
      fetchData(filters);
    }
  }, [router.isReady, router.query, fetchData, filters]);

  // 更新 URL
  const updateUrl = (newFilters: typeof filters) => {
    const query: { [key: string]: any } = {};
    Object.entries(newFilters).forEach(([key, value]) => {
        if (value && key !== 'limit' && !(key === 'page' && value === 1)) {
            query[key] = value;
        }
    });
    router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
  
  const debouncedUpdateUrl = useMemo(() => debounce(updateUrl, 500), [updateUrl]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const newFilters = { ...filters, [name]: value, page: 1 };
    setFilters(newFilters);
    debouncedUpdateUrl(newFilters);
  };
  
  // 批量操作
  const handleBatchAction = async (action: string) => {
    if (selectedIds.size === 0) return alert('请至少选择一个用户');
    
    let value: any = null;
    if (action === 'ban') {
      value = prompt(`请输入封禁选定 ${selectedIds.size} 个用户的原因（可留空）:`);
      if (value === null) return; // 用户取消
    }

    if (!window.confirm(`确定要对选中的 ${selectedIds.size} 个用户执行此操作吗？`)) return;

    try {
      const response = await fetch('/api/admin/users/batch-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: Array.from(selectedIds), action, value }),
      });
      if (!response.ok) throw new Error((await response.json()).error || '操作失败');
      alert('操作成功！');
      fetchData(filters);
    } catch (error) {
      alert(`操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => setSelectedIds(e.target.checked ? new Set(users.map(u => u.id)) : new Set());
  const handleSelectOne = (id: number) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
    } else {
        newSelectedIds.add(id);
    }
    setSelectedIds(newSelectedIds);
  };

  const totalPages = Math.ceil(total / filters.limit);
  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= totalPages) {
      const newFilters = { ...filters, page: newPage };
      setFilters(newFilters);
      updateUrl(newFilters);
    }
  };

  return (
    <>
      <Head><title>用户管理 - Admin</title></Head>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4">
            <Link href="/admin"><span className="text-sm text-purple-600 hover:underline cursor-pointer">&larr; 返回管理后台主页</span></Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-4">用户管理</h1>

          <div className="bg-white p-4 rounded-lg shadow-sm mb-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input type="text" name="search" defaultValue={filters.search} onChange={handleFilterChange} placeholder="搜索用户名..." className="input-field"/>
              <select name="status" value={filters.status} onChange={handleFilterChange} className="input-field">
                <option value="">所有状态</option>
                <option value="normal">正常</option>
                <option value="banned">已封禁</option>
                <option value="exempt">审查豁免</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-medium">注册时间范围</label>
                    <div className="flex gap-2">
                        <input type="date" name="regDateStart" value={filters.regDateStart} onChange={handleFilterChange} className="input-field"/>
                        <input type="date" name="regDateEnd" value={filters.regDateEnd} onChange={handleFilterChange} className="input-field"/>
                    </div>
                </div>
                <div>
                    <label className="text-xs font-medium">最后登录时间范围</label>
                    <div className="flex gap-2">
                        <input type="date" name="loginDateStart" value={filters.loginDateStart} onChange={handleFilterChange} className="input-field"/>
                        <input type="date" name="loginDateEnd" value={filters.loginDateEnd} onChange={handleFilterChange} className="input-field"/>
                    </div>
                </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600 mr-4">选中 {selectedIds.size} 项</span>
            <button onClick={() => handleBatchAction('set_exempt')} className="admin-button-sm bg-green-500 hover:bg-green-600">设为豁免</button>
            <button onClick={() => handleBatchAction('remove_exempt')} className="admin-button-sm bg-yellow-500 hover:bg-yellow-600">取消豁免</button>
            <button onClick={() => handleBatchAction('ban')} className="admin-button-sm bg-red-500 hover:bg-red-600">封禁</button>
            <button onClick={() => handleBatchAction('unban')} className="admin-button-sm bg-gray-500 hover:bg-gray-600">解封</button>
          </div>

          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-500">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                  <th className="p-4"><input type="checkbox" onChange={handleSelectAll} checked={users.length > 0 && selectedIds.size === users.length}/></th>
                  <th className="px-6 py-3">用户</th>
                  <th className="px-6 py-3">状态</th>
                  <th className="px-6 py-3">数据卡 (总/公/封/拒)</th>
                  <th className="px-6 py-3">注册时间</th>
                  <th className="px-6 py-3">最后登录</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                    <tr><td colSpan={6} className="text-center p-8">加载中...</td></tr>
                ) : users.length === 0 ? (
                    <tr><td colSpan={6} className="text-center p-8">未找到符合条件的用户</td></tr>
                ) : (
                  users.map(user => (
                    <tr key={user.id} className="bg-white border-b hover:bg-gray-50">
                      <td className="p-4"><input type="checkbox" onChange={() => handleSelectOne(user.id)} checked={selectedIds.has(user.id)} /></td>
                      <td className="px-6 py-4"><div className="font-medium text-gray-900">{user.username}</div><div className="text-xs text-gray-500">{user.email}</div></td>
                      <td className="px-6 py-4 space-y-1">
                        {user.is_banned ? <span className="block text-xs font-medium px-2 py-0.5 bg-red-100 text-red-800 rounded-full">封禁</span> : <span className="block text-xs font-medium px-2 py-0.5 bg-green-100 text-green-800 rounded-full">正常</span>}
                        {user.is_review_exempt === 1 && <span className="block text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">豁免审查</span>}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs">{user.total_cards}/{user.public_cards}/{user.banned_cards}/{user.rejected_cards}</td>
                      <td className="px-6 py-4">{new Date(user.created_at).toLocaleDateString()}</td>
                      <td className="px-6 py-4">{user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : '从未'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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

export default UserManagementPage;