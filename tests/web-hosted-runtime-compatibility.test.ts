import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  QUESTIONNAIRE_PRESET_INDEX,
  loadQuestionnairePresetAsset,
} from '../packages/hosted-runtime/src/node-runtime/static-assets';

const ROOT_DIRECTORY = process.cwd();

const read = (relativePath: string): string =>
  readFileSync(path.join(ROOT_DIRECTORY, relativePath), 'utf8');

const packageCompatibilityWrappers = [
  'apps/web/lib/creator/build-rule-projection.ts',
  'apps/web/lib/creator/build-rule-request.ts',
  'apps/web/lib/creator/build-rule-runtime.ts',
  'apps/web/lib/creator/build-rules.ts',
  'apps/web/lib/creator/card-metadata.ts',
  'apps/web/lib/creator/prompt.ts',
  'apps/web/lib/creator/server.ts',
  'apps/web/lib/creator/templates.ts',
  'apps/web/lib/creator/types.ts',
  'apps/web/lib/canshou-lore.ts',
  'apps/web/lib/random-choose-hana-name.ts',
] as const;

const hostedServiceWrappers = [
  'apps/web/lib/hosted-api/generate-free.ts',
  'apps/web/lib/hosted-api/generate-free-stream.ts',
  'apps/web/lib/hosted-api/generate-scenario.ts',
  'apps/web/lib/hosted-api/generate-scenario-stream.ts',
  'apps/web/lib/hosted-api/generate-canshou.ts',
  'apps/web/lib/hosted-api/generate-canshou-stream.ts',
  'apps/web/lib/hosted-api/generate-magical-girl.ts',
  'apps/web/lib/hosted-api/generate-game-card.ts',
  'apps/web/lib/hosted-api/generate-creator.ts',
  'apps/web/lib/hosted-api/generate-creator-stream.ts',
  'apps/web/lib/hosted-api/generate-magical-girl-details.ts',
  'apps/web/lib/hosted-api/generate-magical-girl-details-stream.ts',
  'apps/web/lib/hosted-api/generate-sublimation.ts',
  'apps/web/lib/hosted-api/generate-sublimation-stream.ts',
] as const;

const protectivePortWrappers = [
  'apps/web/lib/hosted-api/observed-next-dr.ts',
  'apps/web/lib/ai/constants.ts',
  'apps/web/lib/ai/public-rate-limit.ts',
  'apps/web/lib/auth/activity-token.ts',
  'apps/web/lib/content-safety/server.ts',
  'apps/web/lib/sensitive-word-filter.ts',
  'apps/web/lib/shield-word-filter.ts',
  'apps/web/lib/card-forge/content-safety.ts',
  'apps/web/lib/signature.ts',
  'apps/web/lib/db/d1-http-client.ts',
] as const;

const g25h2RouteHandlers = [
  'apps/web/app/api/generate-magical-girl-details/handler.ts',
  'apps/web/app/api/generate-magical-girl-details-stream/handler.ts',
  'apps/web/app/api/generate-sublimation/handler.ts',
  'apps/web/app/api/generate-sublimation-stream/handler.ts',
] as const;

const assetMirrors = [
  ['apps/web/public/build-rules/presets/index.json', 'packages/hosted-runtime/src/assets/build-rules/presets/index.json'],
  ['apps/web/public/build-rules/presets/arena-trpg-lite.json', 'packages/hosted-runtime/src/assets/build-rules/presets/arena-trpg-lite.json'],
  ['apps/web/public/build-rules/presets/dnd-5e-lite.json', 'packages/hosted-runtime/src/assets/build-rules/presets/dnd-5e-lite.json'],
  ['apps/web/public/build-rules/presets/coc-7e-lite.json', 'packages/hosted-runtime/src/assets/build-rules/presets/coc-7e-lite.json'],
  ['apps/web/public/build-rules/presets/terrorinfinity-fx-v137.json', 'packages/hosted-runtime/src/assets/build-rules/presets/terrorinfinity-fx-v137.json'],
  ['apps/web/public/questionnaires/presets/index.json', 'packages/hosted-runtime/src/assets/questionnaires/presets/index.json'],
  ['apps/web/public/flowers.json', 'packages/hosted-runtime/src/assets/flowers.json'],
] as const;

describe('apps/web 与 hosted-runtime compatibility 边界', () => {
  test('Creator/lore/flower Web 入口仅保留 package compatibility wrapper', () => {
    for (const wrapper of packageCompatibilityWrappers) {
      const source = read(wrapper);
      expect(source).toContain('@mahoshojo/hosted-runtime/');
      expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(10);
    }
  });

  test('Hosted service Web 入口只配置 runtime 并转交 package 权威实现', () => {
    for (const wrapper of hostedServiceWrappers) {
      const source = read(wrapper);
      expect(source).toContain('@mahoshojo/hosted-runtime/node-runtime/default-services');
      expect(source).toContain('./configure-node-runtime');
      expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(18);
    }
  });

  test('G25H-2 Route Handler 只保留 Next DR service adapter', () => {
    for (const handler of g25h2RouteHandlers) {
      const source = read(handler);
      expect(source).toContain('@/lib/hosted-api/');
      expect(source).not.toMatch(/fetch\(|generateWithAI|generateWithStreamAI/u);
      expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(5);
    }
  });

  test('保护性 Web 兼容层不重新持有 Node authority 或 secret 装载', () => {
    for (const wrapper of protectivePortWrappers) {
      const source = read(wrapper);
      expect(source).toContain('@mahoshojo/hosted-runtime/');
      expect(source).not.toContain('process.env');
      expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(30);
    }
  });

  test('Web public 与服务器运行时使用逐字一致的受审静态资产镜像', () => {
    for (const [publicAsset, packageAsset] of assetMirrors) {
      expect(existsSync(path.join(ROOT_DIRECTORY, packageAsset))).toBe(true);
      expect(read(packageAsset)).toBe(read(publicAsset));
    }
    for (const preset of QUESTIONNAIRE_PRESET_INDEX.presets) {
      expect(loadQuestionnairePresetAsset(preset.path)).toEqual(
        JSON.parse(read(`apps/web/public${preset.path}`)),
      );
    }
  });
});
