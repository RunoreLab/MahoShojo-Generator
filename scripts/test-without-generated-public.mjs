/**
 * 生成物屏蔽验证（MONO-006 的动态兜底）：把 `apps/<a>/public/` 下内容生成器持有的
 * 路径临时改名隐藏，然后运行给定命令——等价于干净检出 / CI 上的环境。
 *
 * 用法：
 *   pnpm run test:without-generated-public              # 默认跑根测试套件
 *   pnpm run test:without-generated-public -- <命令>     # 屏蔽后跑自定义命令
 *
 * 说明：
 * - 静态侧已由 MONO-006-GENERATED-PUBLIC-IMPORT/READ 拦截；本脚本兜住分段拼装的动态路径。
 * - 屏蔽用 rename 实现，命令结束后在 finally 里恢复；上次中断遗留的 *.generated-masked
 *   会在启动时先恢复再屏蔽。
 * - 请先停止 dev server：public 下文件被占用时 rename 会失败。
 * - apps/desktop/dist 等构建产物不在屏蔽范围（dist 有独立的 REQUIRE_DESKTOP_DIST 约定）。
 */
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_PUBLIC_DIRECTORIES,
  GENERATED_PUBLIC_ROOT_FILES,
  generatedPublicPaths,
} from './check-workspace-boundaries.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASK_SUFFIX = '.generated-masked';
const GENERATED_APPS = ['web', 'desktop'];

/** @returns {string[]} 仓库根相对路径（目录优先、文件其后；已去重并剔除被目录包含的项） */
function collectGeneratedPublicTargets(rootDirectory) {
  const targets = [];
  const scattered = generatedPublicPaths(rootDirectory);
  for (const app of GENERATED_APPS) {
    const publicRoot = path.join('apps', app, 'public');
    const directories = GENERATED_PUBLIC_DIRECTORIES.map((dir) => path.join(publicRoot, dir));
    const files = [...GENERATED_PUBLIC_ROOT_FILES, ...(scattered.get(app) ?? [])]
      .map((file) => path.join(publicRoot, file))
      // 已被整目录屏蔽的路径不用再单独改（如 questionnaires/presets 目录下的散文件）。
      .filter((file) => !directories.some((dir) => file.startsWith(`${dir}${path.sep}`)));
    targets.push(...directories, ...files);
  }
  return targets;
}

/** 恢复所有现存的 *.generated-masked（崩溃遗留自愈 + 正常运行后的回滚共用）。 */
function restoreMasked(rootDirectory) {
  const restored = [];
  for (const app of GENERATED_APPS) {
    const publicRoot = path.join(rootDirectory, 'apps', app, 'public');
    if (!existsSync(publicRoot)) continue;
    const queue = [publicRoot];
    while (queue.length > 0) {
      const directory = queue.shift();
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.name.endsWith(MASK_SUFFIX)) {
          renameSync(entryPath, entryPath.slice(0, -MASK_SUFFIX.length));
          restored.push(path.relative(rootDirectory, entryPath.slice(0, -MASK_SUFFIX.length)));
        } else if (entry.isDirectory()) {
          queue.push(entryPath);
        }
      }
    }
  }
  return restored;
}

const separatorIndex = process.argv.indexOf('--');
const command = separatorIndex >= 0
  ? process.argv.slice(separatorIndex + 1).join(' ')
  : 'pnpm run test:repo';
if (!command.trim()) {
  console.error('用法: pnpm run test:without-generated-public [-- <命令>]');
  process.exit(1);
}

const stale = restoreMasked(repositoryRoot);
if (stale.length > 0) {
  console.log(`已恢复上次中断遗留的 ${stale.length} 个屏蔽项`);
}

const targets = collectGeneratedPublicTargets(repositoryRoot)
  .map((relativePath) => {
    const absolute = path.join(repositoryRoot, relativePath);
    return existsSync(absolute) ? { absolute, masked: `${absolute}${MASK_SUFFIX}`, relativePath } : null;
  })
  .filter(Boolean);

if (targets.length === 0) {
  console.log('未发现本地生成物，直接以干净检出形态运行');
} else {
  for (const { absolute, masked, relativePath } of targets) {
    renameSync(absolute, masked);
    console.log(`masked  ${relativePath}`);
  }
}

let status = 1;
try {
  const result = spawnSync(command, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: true,
  });
  status = result.status ?? 1;
} finally {
  const failures = [];
  for (const { absolute, masked, relativePath } of targets) {
    try {
      renameSync(masked, absolute);
    } catch (error) {
      failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    console.error(`生成物恢复失败（需手动把 *.generated-masked 改回原名）:\n${failures.join('\n')}`);
    status = 1;
  } else if (targets.length > 0) {
    console.log(`已恢复 ${targets.length} 个生成物路径`);
  }
}

process.exit(status);
