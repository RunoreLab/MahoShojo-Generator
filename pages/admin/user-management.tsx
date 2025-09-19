import React, { useState, useEffect } from 'react';
import { Search, Save, X, Users, UserCheck, UserX, AlertTriangle } from 'lucide-react';

interface User {
  id: number;
  username: string;
  email: string;
  auth_key: string;
  created_at: string;
  last_login_at: string | null;
  is_banned: string | null;
  slot_count: number | null;
  registration_ip: string | null;
  prefix: string | null;
}

interface UserFormData {
  username: string;
  email: string;
  is_banned: string;
  slot_count: string;
  prefix: string;
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<UserFormData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // 获取所有用户
  const fetchUsers = async (page = 1, search = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(search && { search })
      });

      const response = await fetch(`/api/admin/users?${params}`);
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
        setTotalPages(data.totalPages || 1);
        setCurrentPage(data.currentPage || 1);
      } else {
        setMessage({ type: 'error', text: '获取用户列表失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '获取用户列表失败: ' + error });
    } finally {
      setLoading(false);
    }
  };

  // 搜索用户
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetchUsers(1, searchTerm);
  };

  // 获取单个用户详情
  const fetchUserDetails = async (username: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users?username=${encodeURIComponent(username)}`);
      if (response.ok) {
        const user = await response.json();
        setSelectedUser(user);
        // 自动进入编辑状态
        setEditingUser({
          username: user.username,
          email: user.email,
          is_banned: user.is_banned || '',
          slot_count: user.slot_count?.toString() || '',
          prefix: user.prefix || ''
        });
      } else {
        setMessage({ type: 'error', text: '获取用户详情失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '获取用户详情失败: ' + error });
    } finally {
      setLoading(false);
    }
  };


  // 保存用户更新
  const saveUserUpdate = async () => {
    if (!editingUser || !selectedUser) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_banned: editingUser.is_banned || null,
          slot_count: editingUser.slot_count ? parseInt(editingUser.slot_count) : null,
          prefix: editingUser.prefix || null
        })
      });

      if (response.ok) {
        const updatedUser = await response.json();
        setSelectedUser(updatedUser);
        setUsers(users.map(u => u.id === updatedUser.id ? updatedUser : u));
        // 保持编辑状态，更新编辑表单数据
        setEditingUser({
          username: updatedUser.username,
          email: updatedUser.email,
          is_banned: updatedUser.is_banned || '',
          slot_count: updatedUser.slot_count?.toString() || '',
          prefix: updatedUser.prefix || ''
        });
        setMessage({ type: 'success', text: '用户信息更新成功' });
      } else {
        setMessage({ type: 'error', text: '更新用户信息失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '更新用户信息失败: ' + error });
    } finally {
      setLoading(false);
    }
  };

  // 重置编辑表单
  const resetEditing = () => {
    if (selectedUser) {
      setEditingUser({
        username: selectedUser.username,
        email: selectedUser.email,
        is_banned: selectedUser.is_banned || '',
        slot_count: selectedUser.slot_count?.toString() || '',
        prefix: selectedUser.prefix || ''
      });
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50">
      <div className="w-full px-8 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-2">
            <Users className="w-8 h-8 text-purple-600" />
            用户管理系统
          </h1>
          <p className="text-gray-600">管理和查看所有注册用户的信息</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
            {message.text}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* 用户列表面板 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 text-gray-800">用户列表</h2>

              {/* 搜索表单 */}
              <form onSubmit={handleSearch} className="mb-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="搜索用户名..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    搜索
                  </button>
                </div>
              </form>

              {/* 用户列表 */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {loading ? (
                  <div className="text-center py-4 text-gray-500">加载中...</div>
                ) : users.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">没有找到用户</div>
                ) : (
                  users.map((user) => (
                    <div
                      key={user.id}
                      onClick={() => fetchUserDetails(user.username)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50 ${selectedUser?.id === user.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200'
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        {user.is_banned ? (
                          <UserX className="w-4 h-4 text-red-500" />
                        ) : (
                          <UserCheck className="w-4 h-4 text-green-500" />
                        )}
                        <span className="font-medium">{user.username}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {user.email}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  <button
                    onClick={() => fetchUsers(currentPage - 1, searchTerm)}
                    disabled={currentPage === 1 || loading}
                    className="px-3 py-1 bg-gray-200 text-gray-700 rounded disabled:opacity-50"
                  >
                    上一页
                  </button>
                  <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => fetchUsers(currentPage + 1, searchTerm)}
                    disabled={currentPage === totalPages || loading}
                    className="px-3 py-1 bg-gray-200 text-gray-700 rounded disabled:opacity-50"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 用户详情面板 */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">用户详情</h2>
                {selectedUser && editingUser && (
                  <div className="flex gap-2">
                    <button
                      onClick={saveUserUpdate}
                      disabled={loading}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      保存
                    </button>
                    <button
                      onClick={resetEditing}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                      <X className="w-4 h-4" />
                      重置
                    </button>
                  </div>
                )}
              </div>

              {selectedUser ? (
                <div className="space-y-6">
                  {/* 基础信息 */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">用户ID</label>
                      <input
                        type="text"
                        value={selectedUser.id}
                        disabled
                        className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                      <input
                        type="text"
                        value={editingUser?.username || selectedUser.username}
                        disabled
                        className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
                      <input
                        type="text"
                        value={editingUser?.email || selectedUser.email}
                        disabled
                        className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">认证密钥</label>
                      <input
                        type="text"
                        value={selectedUser.auth_key}
                        disabled
                        className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-xs"
                      />
                    </div>
                  </div>

                  {/* 可编辑字段 */}
                  <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800">可编辑设置</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          封禁状态
                          {selectedUser.is_banned && <AlertTriangle className="inline w-4 h-4 ml-1 text-red-500" />}
                        </label>
                        <input
                          type="text"
                          value={editingUser ? editingUser.is_banned : (selectedUser.is_banned || '')}
                          onChange={(e) => editingUser && setEditingUser({ ...editingUser, is_banned: e.target.value })}
                          placeholder="输入封禁原因，留空表示正常"
                          className={`w-full p-3 border border-gray-300 rounded-lg bg-white ${selectedUser.is_banned ? 'border-red-300 bg-red-50' : ''}`}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">数据卡槽位数</label>
                        <input
                          type="number"
                          value={editingUser ? editingUser.slot_count : (selectedUser.slot_count || '')}
                          onChange={(e) => editingUser && setEditingUser({ ...editingUser, slot_count: e.target.value })}
                          placeholder="默认槽位数"
                          className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">用户前缀</label>
                      <input
                        type="text"
                        value={editingUser ? editingUser.prefix : (selectedUser.prefix || '')}
                        onChange={(e) => editingUser && setEditingUser({ ...editingUser, prefix: e.target.value })}
                        placeholder="用户名显示前缀"
                        className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                      />
                    </div>
                  </div>

                  {/* 时间信息 */}
                  <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800">时间信息</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">注册时间</label>
                        <input
                          type="text"
                          value={selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleString('zh-CN') : ''}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">最后登录</label>
                        <input
                          type="text"
                          value={selectedUser.last_login_at ? new Date(selectedUser.last_login_at).toLocaleString('zh-CN') : '从未登录'}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                    </div>
                    {selectedUser.registration_ip && (
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">注册IP</label>
                        <input
                          type="text"
                          value={selectedUser.registration_ip}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>请从左侧列表选择一个用户查看详情</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}