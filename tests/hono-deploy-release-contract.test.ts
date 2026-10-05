import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const deployScriptPath = resolve('apps/api/deploy/deploy-bundle.sh');
const installerPath = resolve('apps/api/deploy/install-bundle.sh');

describe('Hono release contract', () => {
  test('构建、Compose 与 runtime 预检使用同一固定 Node 镜像', () => {
    const dockerfile = readFileSync(resolve('apps/api/Dockerfile'), 'utf8');
    const compose = readFileSync(resolve('apps/api/deploy/compose.yml'), 'utf8');
    const script = readFileSync(deployScriptPath, 'utf8');
    const pattern = 'node:22-alpine@sha256:[0-9a-f]{64}';
    const images = [...dockerfile.matchAll(new RegExp(`^FROM (${pattern})(?: AS [a-z]+)?$`, 'gmu'))]
      .map((match) => match[1]);
    const composeImage = compose.match(new RegExp(`^\\s*image: (${pattern})$`, 'mu'))?.[1];

    expect(images).toHaveLength(2);
    expect(new Set(images)).toEqual(new Set([composeImage]));
    expect(script).toContain(`runtime_image='${composeImage}'`);
  });

  test('只保留普通五文件 release，不再携带独立 installer', () => {
    const workflows = [
      readFileSync(resolve('.github/workflows/hono-deploy.yml'), 'utf8'),
      readFileSync(resolve('.github/workflows/preview-deploy.yml'), 'utf8'),
    ].join('\n');

    expect(existsSync(installerPath)).toBe(false);
    expect(workflows).toMatch(/sha256sum index\.mjs compose\.yml deploy-bundle\.sh > release\.manifest/u);
    expect(workflows).toContain('release.sha256');
    expect(workflows).not.toContain('install-bundle.sh');
  });
});
