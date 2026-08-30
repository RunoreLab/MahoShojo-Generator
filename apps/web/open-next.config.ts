import { defineCloudflareConfig, type OpenNextConfig } from '@opennextjs/cloudflare';

export default {
  ...defineCloudflareConfig({}),
  // Keep the Cloudflare adapter on the same fail-closed type-checking path as Next.
  buildCommand: 'pnpm run build:next',
} satisfies OpenNextConfig;
