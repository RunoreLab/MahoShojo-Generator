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

ensureDir(homeDir);
ensureDir(cacheDir);
ensureDir(dataDir);

process.env.HOME = homeDir;
process.env.XDG_CACHE_HOME = cacheDir;
process.env.XDG_DATA_HOME = dataDir;

const child = spawn("next-on-pages", process.argv.slice(2), {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
