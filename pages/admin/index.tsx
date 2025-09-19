// pages/admin/index.tsx

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { FileText, Users } from 'lucide-react';

const AdminHomePage: React.FC = () => {
  return (
    <>
      <Head>
        <title>管理后台 - MahoShojo Generator</title>
      </Head>
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="container mx-auto p-4 max-w-2xl">
          <div className="bg-white rounded-lg shadow-lg p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-800">MahoShojo Generator</h1>
              <p className="text-lg text-gray-600">管理后台</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 内容管理入口 */}
              <Link href="/admin//content-management" legacyBehavior>
                <a className="block p-6 bg-purple-50 rounded-lg border border-purple-200 hover:shadow-xl hover:border-purple-400 transition-all duration-300">
                  <div className="flex items-center text-purple-700 mb-2">
                    <FileText className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">内容档案管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    审查、管理和筛选用户创建的角色与情景数据卡。
                  </p>
                </a>
              </Link>

              {/* 用户管理入口 */}
              <Link href="/admin/user-dashboard" legacyBehavior>
                <a className="block p-6 bg-blue-50 rounded-lg border border-blue-200 hover:shadow-xl hover:border-blue-400 transition-all duration-300">
                  <div className="flex items-center text-blue-700 mb-2">
                    <Users className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">用户状态</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    查询、筛选和管理平台用户，设置用户状态与权限。
                  </p>
                </a>
              </Link>
            </div>
            
            <div className="text-center mt-8">
                <Link href="/" legacyBehavior>
                    <a className="text-sm text-gray-500 hover:text-purple-600 hover:underline">
                        返回应用首页
                    </a>
                </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AdminHomePage;