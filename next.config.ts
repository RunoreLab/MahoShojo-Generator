import type { NextConfig } from "next";

import { buildStaticBrowserSecurityHeaders } from "./lib/security/browser-headers";

const staticSecurityHeaders = buildStaticBrowserSecurityHeaders({
  allowGoogleAnalytics: Boolean(process.env.NEXT_PUBLIC_GA_ID?.trim()),
  allowTurnstile: true,
  isProduction: process.env.NODE_ENV === 'production',
});

const nextConfig: NextConfig = {
  // 图片优化配置（Cloudflare Pages 不支持默认的图片优化）
  images: {
    unoptimized: true
  },

  experimental: {
    // 禁用 Lightning CSS 原生二进制，避免在容器环境缺少本地编译文件时报错
    optimizeCss: false,
  },

  // 重定向配置 - 将无效的路径重定向到正确的页面
  async redirects() {
    return [
      {
        source: '/battle-stream',
        destination: '/arena-stream',
        permanent: false,
      },
      {
        source: '/magic-tavern',
        destination: '/magic-tea-party',
        permanent: true,
      },
      {
        source: '/details/:path+', 
        destination: '/details',
        permanent: false, // 使用 307 临时重定向
      },
      {
        source: '/admin/user-dashboard',
        destination: '/admin/users',
        permanent: false,
      },
      {
        source: '/admin/user-management',
        destination: '/admin/users',
        permanent: false,
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: staticSecurityHeaders,
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex',
          },
        ],
      },
    ];
  },

  // 其他配置
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
