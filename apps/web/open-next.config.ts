import { defineCloudflareConfig, type OpenNextConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

export default {
  // 只复用构建时预渲染内容；动态 API 和用户数据不进入公共缓存。
  ...defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache }),
  // Keep the Cloudflare adapter on the same fail-closed type-checking path as Next.
  buildCommand: 'pnpm run build:next',
} satisfies OpenNextConfig;
