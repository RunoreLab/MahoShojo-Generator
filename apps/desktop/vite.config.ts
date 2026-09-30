import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

/**
 * Desktop 前端构建配置。
 *
 * 两个刻意的偏离官方 Vite 模板之处，都由 Desktop 的本地安全边界决定：
 *
 * - `envPrefix` 只保留 `TAURI_ENV_*`。官方模板会额外暴露 `VITE_`，而 Desktop 客户端
 *   永远不需要构建期秘密，多暴露一个前缀就多一条把秘密打进 bundle 的路径。
 * - `server.port` 使用 1420 而不是 5173，避免与仓库中其他开发服务器抢占同一固定端口，
 *   因为 `strictPort` 会让端口冲突直接失败而不是静默改端口。
 */
export default defineConfig({
  plugins: [tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['TAURI_ENV_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
