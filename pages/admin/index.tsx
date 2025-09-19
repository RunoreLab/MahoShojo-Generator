// pages/admin/index.tsx

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { FileText, Users, FileCheck, UserCog } from 'lucide-react';

/**
 * @fileoverview 后台管理系统的统一入口页面。
 * @description
 * 该页面经过重新设计，以网格布局展示了四个核心的管理模块。
 * 其中两个模块（内容档案管理、用户状态仪表盘）是当前版本的高级管理工具，
 * 另外两个模块（角色卡管理、用户管理）来自86a5338版本，
 * 提供了更简洁、快速的单项编辑功能。
 * 这样的布局使得不同需求的管理操作都能快速找到入口。
 */
const AdminHomePage: React.FC = () => {
  return (
    <>
      <Head>
        <title>管理后台 - MahoShojo Generator</title>
      </Head>
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="container mx-auto max-w-4xl">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="text-center mb-10">
              <h1 className="text-4xl font-bold text-gray-800 tracking-tight">MahoShojo Generator</h1>
              <p className="text-lg text-gray-500 mt-2">管理后台</p>
            </div>

            {/* 使用2x2网格布局来展示四个管理页面入口 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* 入口 1: 内容档案管理 */}
              <Link href="/admin/content-management" legacyBehavior>
                <a className="admin-card bg-purple-50 border-purple-200 hover:border-purple-400">
                  <div className="flex items-center text-purple-700 mb-3">
                    <FileCheck className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">内容管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    使用高级筛选、批量操作和AI辅助工具，对所有用户创建的角色与情景数据卡进行审查和管理。
                  </p>
                </a>
              </Link>

              {/* 入口 2: 用户状态管理 */}
              <Link href="/admin/user-dashboard" legacyBehavior>
                <a className="admin-card bg-blue-50 border-blue-200 hover:border-blue-400">
                  <div className="flex items-center text-blue-700 mb-3">
                    <UserCog className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">用户状态</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    使用高级筛选和批量操作工具，管理所有平台用户的状态与权限。
                  </p>
                </a>
              </Link>

              {/* 入口 3: 角色卡管理 */}
              <Link href="/admin/character-management" legacyBehavior>
                <a className="admin-card bg-pink-50 border-pink-200 hover:border-pink-400">
                  <div className="flex items-center text-pink-700 mb-3">
                    <FileText className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">角色管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    快速查看和编辑单个角色或情景数据卡的基础信息，例如名称、描述和公开状态。
                  </p>
                </a>
              </Link>

              {/* 入口 4: 用户管理 */}
              <Link href="/admin/user-management" legacyBehavior>
                <a className="admin-card bg-teal-50 border-teal-200 hover:border-teal-400">
                  <div className="flex items-center text-teal-700 mb-3">
                    <Users className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">用户管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    快速查看和编辑单个用户的基本信息，例如封禁状态、数据卡槽位和特殊头衔。
                  </p>
                </a>
              </Link>
            </div>
            
            <div className="text-center mt-10">
                <Link href="/" legacyBehavior>
                    <a className="text-sm text-gray-500 hover:text-purple-600 hover:underline">
                        返回应用首页
                    </a>
                </Link>
            </div>
          </div>
        </div>
      </div>
      {/* 增加一些内联样式以美化卡片效果 */}
      <style jsx>{`
        .admin-card {
          display: block;
          padding: 1.5rem;
          border-radius: 0.75rem;
          border-width: 1px;
          transition: all 0.3s ease-in-out;
          transform: translateY(0);
        }
        .admin-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }
      `}</style>
    </>
  );
};

export default AdminHomePage;