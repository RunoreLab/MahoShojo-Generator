import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { fileURLToPath } from "node:url";

import { loadRepositoryRootEnvFallback } from "./config/load-root-env-fallback";
import { buildStaticBrowserSecurityHeaders } from "./lib/security/browser-headers";

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const createNextConfig = (phase: string): NextConfig => {
  // G25D compatibility: app-local/explicit env remains authoritative while a
  // legacy ignored root .env* can still supply missing local values.
  loadRepositoryRootEnvFallback(repositoryRoot, phase === PHASE_DEVELOPMENT_SERVER);

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    initOpenNextCloudflareForDev();
  }

  const staticSecurityHeaders = buildStaticBrowserSecurityHeaders({
    allowCloudflareInsights: process.env.NODE_ENV === 'production',
    allowGoogleAnalytics: Boolean(process.env.NEXT_PUBLIC_GA_ID?.trim()),
    allowTurnstile: true,
    isProduction: process.env.NODE_ENV === 'production',
  });

  return {
    outputFileTracingRoot: repositoryRoot,

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
      // package build scripts run the fail-closed production tsc gate first,
      // keeping the high-memory type checker and Next bundler in separate processes.
      ignoreBuildErrors: true,
      tsconfigPath: 'tsconfig.build.json',
    },
  };
};

export default createNextConfig;
