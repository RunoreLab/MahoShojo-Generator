import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
  MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
} from '../packages/local-library/src/archive-pack';

/**
 * 归档字节预算的跨语言门禁。
 *
 * ## 为什么两侧都有同一个数字
 *
* `DESK-070` 把"归档字节上限"拆成三个：打包输入预算、最终归档文件长度、单次 IPC 块。其中**打包输入
 * 预算**与**最终归档长度**分属两个 runtime，却**必须**相等：
 *
 * - 打包输入预算是 TypeScript 的 `zipSync` 峰值预算，由 `scripts/measure-archive-memory.mjs` 实测
 *   （`MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES`）；
 * - 最终归档长度是 native 写入方向的独立核对上限（Rust 的
 *   `MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES`）。TypeScript 侧也有一份同名同值常量，在 `zipSync`
 *   之后断言——因为 Web 侧导出**不经过 Rust**。
 *
 * 两侧各自单独都"够用"，而这正是问题：native 侧比 TS 侧更宽时，那条"独立核对"形同虚设——超限的
 * 归档会先被 native 收下（它按自己的上限判断，没超），再在打包器侧失败。反向更糟：native 更窄时，
 * 一个**合法**的归档会被 native 在最后一块拒绝，而它已经花了全部打包时间。
 *
 * 这里比较的是 **TS 输出上限 ↔ Rust 输出上限**（同一个概念的两侧实现），而 TS 输入上限与输出上限
 * 当前同值只是 V1 的取值，不是同一个东西。
 *
 * ## 为什么这条门禁读源码而不是靠注释
 *
 * 两个常量在一个 Rust 仓库和一个 npm workspace 里，没有共享的机器可读 source of truth。因此只能读
 * 源码文本并比较求值结果。Rust 那边刻意写成可解析的常量表达式（`256 * 1024 * 1024`）而不是字面量，
 * 这样两边都在"求值后比较"，任一边改成 `256 << 20` 也不会误报。
 *
 * 这类"读源码比对"的门禁有恒真的风险：解析失败时若直接跳过断言，门禁就变成装饰。因此这里在解析
 * 失败时**让测试失败**。
 */
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rustSourcePath = path.join(
  repositoryRoot,
  'apps/desktop/src-tauri/src/export.rs',
);

const readRustSource = (): string => readFileSync(rustSourcePath, 'utf8');

const RUST_CONSTANT = /pub const MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES:\s*u64\s*=\s*([^;]+);/u;

const evaluateRustByteExpression = (expression: string): number => {
  const normalized = expression.replaceAll('_', '').replace(/\s+/gu, '');
  // 只放行十进制字面量与乘 2 的幂——刻意不接受任意 Rust 表达式：本门禁不需要当解析器用，
  // 遇到不认识的形状就应当失败而不是猜。
  const match = /^(\d+)(?:\*(\d+))*$/u.exec(normalized);
  if (match === null) {
    throw new Error(`无法解析 Rust 常量表达式：${expression}`);
  }
  const [literal, ...factors] = normalized.split('*');
  void match;
  const base = Number(literal);
  if (!Number.isSafeInteger(base)) {
    throw new Error(`Rust 常量的字面量不是安全整数：${expression}`);
  }
  return factors.reduce((product, factor) => {
    const value = Number(factor);
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Rust 常量的因子不是安全整数：${expression}`);
    }
    return product * value;
  }, base);
};

const readRustOutputBudget = (): number => {
  const source = readRustSource();
  const matched = RUST_CONSTANT.exec(source);
  if (matched === null) {
    throw new Error(`apps/desktop/src-tauri/src/export.rs 里找不到 MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES`);
  }
  return evaluateRustByteExpression(matched[1]);
};

describe('归档字节预算跨语言一致', () => {
  it('native 的输出上限与共享打包器的输出上限相等', () => {
    expect(readRustOutputBudget()).toBe(MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES);
  });

  it('两侧都仍是 256 MiB 这个具体数字（防止有人同时改小成"更安全"的值）', () => {
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES).toBe(256 * 1024 * 1024);
    expect(readRustOutputBudget()).toBe(256 * 1024 * 1024);
  });

  it('Rust 常量不静默用占位值顶替', () => {
    // 这条不是重复上一条：上一条会在两侧相等时通过，而"两侧都是 0"也相等。
    // 上限为 0 时导出必然全失败，而症状是"导出报 archive-too-large"，与根因无关。
    expect(readRustOutputBudget()).toBeGreaterThan(0);
  });

  it('V1 下输入预算与输出上限仍然同值，但它们是两个常量', () => {
    // 同值是 V1 的取值，不是同一个概念：ZIP 的 local header / central directory / EOCD 开销
    // 使两者原则上不相等。合成一个常量会让"条目太多导致归档超长"这类偏差无处可归。
    expect(MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES).toBe(MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES);
  });
});