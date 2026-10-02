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
     * 此前本包没有声明 `testTimeout`，因此吃 vitest 的 5000ms 默认值：单独跑该文件时它在预算内，
     * 但作为 `pnpm workspace:test` 的第 16 个项目、在前面 15 个项目刚跑完之后就会越过 5s 而报
     * `Test timed out in 5000ms`。门禁偶发变红比门禁偏紧更糟——它会让人开始习惯忽略失败。
     *
     * 因此这里显式给一个宽松但有界的预算，与 `apps/web` 的 15s 口径一致。放宽的是**超时**，
     * 不是断言：这个测试要证明的那条性质一点没动。
     */
    testTimeout: 30_000,
  },
});