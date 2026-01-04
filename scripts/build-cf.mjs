import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const homeDir = path.join(projectRoot, ".home");
const cacheDir = path.join(projectRoot, ".cache");
const dataDir = path.join(projectRoot, ".xdg-data");
const npmCacheDir = path.join(cacheDir, "npm");
const npmUserConfigPath = path.join(homeDir, ".npmrc");

ensureDir(homeDir);
ensureDir(cacheDir);
ensureDir(dataDir);
ensureDir(npmCacheDir);

process.env.HOME = homeDir;
process.env.XDG_CACHE_HOME = cacheDir;
process.env.XDG_DATA_HOME = dataDir;

// Cloudflare Pages / CI 环境中，`next-on-pages` 内部会调用 `npx vercel build`，进而触发 `npm install`。
// 如果 npm cache 指向默认的用户目录（可能不可写、或存在 root-owned 文件），会导致构建失败。
// 强制把 npm 相关目录固定到项目内，保证可写且可复现。
process.env.npm_config_cache = npmCacheDir;
process.env.NPM_CONFIG_CACHE = npmCacheDir;
process.env.npm_config_userconfig = npmUserConfigPath;
process.env.NPM_CONFIG_USERCONFIG = npmUserConfigPath;

const child = spawn("next-on-pages", process.argv.slice(2), {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
