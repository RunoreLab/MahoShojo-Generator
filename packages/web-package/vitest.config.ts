import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    /**
     * `tests/web-package-import.test.ts` 会对一个 `MAX_ARCHIVE_EXPANDED_BYTES + 1024`
     * （256 MiB + 1 KiB）的**高度可压缩**载荷调用 `pack()`，用来证明伪造的 central directory
     * 不能靠膨胀耗尽内存。这是一次真实的内存受限操作，不是慢测试。
     *
     * 此前本包没有声明 `testTimeout`，因此吃 vitest 的 5000ms 默认值：单独跑该文件时它在预算内
     * （实测最慢一条 **3,470ms**），但作为 `pnpm workspace:test` 的第 16 个项目、在前面 15 个项目
     * 刚跑完之后就会越过 5s 而报 `Test timed out in 5000ms`。门禁偶发变红比门禁偏紧更糟——它会
     * 让人开始习惯忽略失败。
     *
     * 20s ≈ 空载实测最差的 5.8 倍。这个包的余量**故意**比 `apps/web`（20s 对 6.79s = 2.9 倍）
     * 更大，原因是本包最重的用例是内存受限的：它的耗时随机器可用内存变化，不像纯计算那样
     * 只随 CPU 变化，因此对慢机器/小机器要多留余量。
     *
     * 放宽的是**超时**不是断言：这个测试要证明的那条性质一点没动。
     */
    testTimeout: 20_000,
  },
});