import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 默认 `node`：绝大多数测试是纯函数（桥的编码、错误映射、流事件归一）。
    // 需要 DOM 的少数测试用文件头的 `// @vitest-environment jsdom` 单独声明，例如路由历史验证
    // （jsdom 提供 `location.hash` 与 history API）。
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    /**
     * 路由历史验证每次 traversal 都要等一次宏任务（jsdom 的 `popstate` 有 100ms 量级延迟），
     * 单条用例因此天然比纯函数测试慢，默认的 5000ms 在 CI 负载下离边界太近。
     *
     * 但上一轮直接跳到 30s 是凭感觉定的，本轮按实测收回：全量 14 文件 / 151 项里**最慢的一条
     * 是 926ms**（前五名 926 / 524 / 521 / 518 / 505ms）。30s 对上是 **32 倍**余量，等于说这个
     * 预算已经不表示任何东西——真挂起的用例要等 30s 才判红，而门禁偏松比门禁偶发变红更贵。
     *
     * 10s ≈ 实测最差的 10.8 倍。本包没有内存受限或子进程派生型的重用例（与 `apps/api` 那个
     * 每次派生 `node --import tsx` 的文件不同），这个余量足够覆盖慢机器，同时把挂起反馈从
     * 30s 压到 10s。
     */
    testTimeout: 10_000,
  },
});