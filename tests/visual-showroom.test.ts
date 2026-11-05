/**
 * 共源视觉样板间契约：`SPEC-visual-baseline-v1` VIS-SHOW-001 的执行形式。
 *
 * 守三件事：
 *
 * 1. **必备分区覆盖**：`sections.ts` 的 SHOWROOM_SECTIONS 登记表包含 spec 要求的
 *    全部分区——登记表是唯一事实源，视图据此渲染，不存在"渲染了但没登记"的暗区。
 * 2. **视图由登记表驱动**：ShowroomView 遍历 SHOWROOM_SECTIONS 且按 id 分发内容，
 *    新增分区不登记就没有导航与出口。
 * 3. **两端共源消费、不进生产面**：Web dev 页与 Desktop 启动旁路都直接消费
 *    `@mahoshojo/ui-web/showroom` 的同一 ShowroomView；Desktop 侧不进
 *    `DELIVERED_ROUTES`/能力快照，生产构建不注册入口。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SHOWROOM_DIR = path.join(REPO_ROOT, 'packages', 'ui-web', 'src', 'showroom');

const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const SECTIONS_SRC = readSrc('packages/ui-web/src/showroom/sections.ts');
const VIEW_SRC = readSrc('packages/ui-web/src/showroom/ShowroomView.tsx');

/** spec VIS-SHOW-001 列举的必备分区（顺序无关）。 */
const REQUIRED_SECTION_IDS = [
  'semantic-colors', // 色板与语义 token
  'typography', // 字体阶梯
  'scales', // 主题无关刻度（间距/圆角/阴影/层级）
  'controls', // 控件
  'forms', // 表单
  'overlay', // 弹层
  'result-surfaces', // 卡片与结果面
  'footer', // 页脚
] as const;

describe('VIS-SHOW-001 分区登记表', () => {
  it('SHOWROOM_SECTIONS 覆盖 spec 必备分区', () => {
    const registered = [...SECTIONS_SRC.matchAll(/id:\s*'([a-z-]+)'/g)].map((match) => match[1]);
    for (const required of REQUIRED_SECTION_IDS) {
      expect(registered, `样板间缺必备分区 ${required}`).toContain(required);
    }
    // 重复 id 会让导航锚点互相覆盖——登记表不允许。
    expect(new Set(registered).size).toBe(registered.length);
  });
});

describe('VIS-SHOW-001 视图由登记表驱动', () => {
  it('ShowroomView 遍历 SHOWROOM_SECTIONS 并按 id 分发内容', () => {
    expect(VIEW_SRC).toContain('SHOWROOM_SECTIONS.map');
    expect(VIEW_SRC).toContain('sectionContent(section.id)');
    // 每个必备分区都有对应渲染出口（switch/分发中显式出现）。
    for (const required of REQUIRED_SECTION_IDS) {
      expect(VIEW_SRC, `ShowroomView 没有 ${required} 的渲染出口`).toContain(`'${required}'`);
    }
  });
});

describe('VIS-SHOW-001 两端共源消费且不进生产面', () => {
  it('Web dev 页直接消费共享 ShowroomView 且生产 404', () => {
    const page = readSrc('apps/web/app/dev/showroom/page.tsx');
    expect(page).toContain("from '@mahoshojo/ui-web/showroom'");
    expect(page).toContain('ShowroomView');
    expect(page).toContain("process.env.NODE_ENV === 'production'");
    expect(page).toContain('notFound()');
  });

  it('Desktop 以开发期旁路消费同一 ShowroomView，不进路由树/能力清单', () => {
    const main = readSrc('apps/desktop/src/main.tsx');
    expect(main).toContain("import('@mahoshojo/ui-web/showroom')");
    expect(main).toContain('import.meta.env.DEV');
    expect(main).toContain('#/showroom');
    expect(main).toContain('ShowroomView');

    // 路由树与能力清单是纯产品面：showroom 一律不得出现。
    const routes = readSrc('apps/desktop/src/app/routes.tsx');
    expect(routes).not.toContain('/showroom');
    const delivered = readSrc('apps/desktop/src/app/delivered-routes.ts');
    expect(delivered).not.toContain('showroom');
  });

  it('ui-web 公开导出 ./showroom', () => {
    const manifest = readSrc('packages/ui-web/package.json');
    expect(manifest).toContain('"./showroom"');
    expect(manifest).toContain('./src/showroom/index.ts');
  });
});

it('ModelScope 样板回用真实生产字段且覆盖工坊与禁用态', () => {
  expect(VIEW_SRC).toContain('<ModelScopeSettingsSample />');
  expect(VIEW_SRC).toContain('<ModelScopeSettingsFields size=');
  expect(VIEW_SRC).toContain('<ModelScopeSettingsFields compact size=');
  expect(VIEW_SRC).toContain('<ModelScopeSettingsFields compact disabled size=');
});
