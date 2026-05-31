import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { buildStaticBrowserSecurityHeaders } from "./lib/security/browser-headers";

const createNextConfig = (phase: string): NextConfig => {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    initOpenNextCloudflareForDev();
  }

  const staticSecurityHeaders = buildStaticBrowserSecurityHeaders({
    allowGoogleAnalytics: Boolean(process.env.NEXT_PUBLIC_GA_ID?.trim()),
    allowTurnstile: true,
    isProduction: process.env.NODE_ENV === 'production',
  });

  return {
    // 图片优化配置（Cloudflare Workers 不支持默认的图片优化）
    images: {
      unoptimized: true
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
};

export default createNextConfig;
