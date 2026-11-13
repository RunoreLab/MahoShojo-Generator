/**
 * 设计 token 结构契约：`SPEC-visual-baseline-v1` 的 VIS-TOK-001/002 与 VIS-GATE-001 的执行形式。
 *
 * ## 这条测试守的是什么
 *
 * 三件事，都只在样式表文本层面发生，不需要浏览器：
 *
 * 1. **`var()` 必须可解析**。引用一个从未声明的自定义属性不会报任何构建错误——属性静默变成
 *    `unset`，样式无声消失。这类失败只有扫描全部样式表、对照声明清单才抓得住。
 * 2. **`--app-*`/`--creator-*` 的 `:root` 级定义只在 `styles.css`**。DESK-PROD-009 要求主题单点
 *    维护；宿主或组件在别处重定义同名 token，就是第二套需要人工同步的主题，且同样不报错。
 * 3. **硬编码颜色字面量、`var(--app-x, 兜底)` 写法与离网格间距只降不增**。存量逐项登记在
 *    baseline 表里，测试断言逐文件计数不超过登记值——不追求存量清零，但增量必须为零，
 *    且谁让数字下降谁受益。「离网格间距」指 margin/padding/gap/inset 等盒间距属性里
 *    非 4px 整数倍的 px 字面量，收敛方向是消费 `--app-space-*` 刻度（VIS-TOK-003）。
 *
 * ## 为什么放在仓库根而不是 `packages/ui-web/tests`
 *
 * 扫描范围覆盖 `packages/ui-web` 与两个 app 的样式表，验的是仓库级性质；放进包里会让 ui-web
 * 的测试反向依赖 app 目录，同时撞上 `MONO-005-SHARED-UI-RUNTIME` 的 Node builtin 禁令。
 * 跨 app 集成测试在本仓库的固定位置就是根 `tests/`。
 *
 * ## baseline 表怎么维护
 *
 * `FILE_BASELINE` 登记当前每个文件里两类存量计数。消除存量后把数字调低；新增文件默认要求
 * 双零（不在表内即按 0 要求）。需要重新收割全仓数字时运行：
 *
 *   BASELINE=print pnpm exec vitest run tests/design-tokens.test.ts
 *
 * 会打印当前实测表供人工核对后粘贴——打印内容必须经人审查，不自动写回。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const WEB_ROOT = path.join(REPO_ROOT, 'apps', 'web');

const requireFromApp = createRequire(path.join(WEB_ROOT, 'package.json'));
const postcss = createRequire(requireFromApp.resolve('@tailwindcss/postcss'))('postcss') as typeof import('postcss');

/** 结构契约的扫描范围：共享 UI 包与两个产品端的样式表。admin 按 ADR-visual-governance-v1 §2.5 不在范围。 */
const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'packages', 'ui-web', 'src'),
  path.join(WEB_ROOT, 'styles'),
  path.join(WEB_ROOT, 'app'),
  path.join(WEB_ROOT, 'components'),
  path.join(REPO_ROOT, 'apps', 'desktop', 'src'),
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'build', 'coverage']);

/** `--app-*`/`--creator-*` token 的唯一 `:root` 级定义处。 */
const TOKEN_OWNER_FILE = 'packages/ui-web/src/styles.css';

/**
 * VIS-TOK-001 登记的作用域改写例外：token 只允许在具名主题作用域内被改写，
 * 不允许在 `:root`/全局选择器上被第二个文件重定义。
 */
const SCOPED_TOKEN_OVERRIDES: ReadonlyArray<{ file: string; scope: string; reason: string }> = [
  {
    file: 'packages/ui-web/src/product-shell.css',
    scope: '.blue-theme',
    reason: '/details 蓝色问卷主题对 --app-result-card-bg 的容器内改写（DESK-PARITY-004）',
  },
];

/**
 * `var()` 第一参数允许不落在样式表声明里的命名空间：
 * 这些前缀的变量由「可选主题覆盖」机制在运行时决定是否定义——消费方必须自带兜底
 * （`var(--x, fallback)`），因此无兜底引用同样被检查拒绝。
 */
const OPTIONAL_VAR_PREFIXES: ReadonlyArray<{ prefix: string; reason: string }> = [
  {
    prefix: '--gc-rarity-',
    reason: '卡牌工坊稀有度主题变量，由 GameCardFace.tsx 按卡面稀有度 inline 注入，样式侧必须自带兜底',
  },
];

/**
 * 逐文件存量 baseline：硬编码颜色字面量数、`var(--app-x, 兜底)` 写法（含 --creator- 前缀）数、
 * 离网格间距数。只许下降，不许上升；不在表内的文件按三项全零要求。
 *
 * 收割方式见文件头注释（BASELINE=print）。
 */
const FILE_BASELINE: Record<string, { literals: number; appTokenFallbacks: number; offGridSpacing: number }> = {
  // 2026-10-19 首次收割。产品壳闭包（顶栏/blue-theme/
  // 危险操作色系）、卡牌工坊宝石装饰常量均为已登记存量；styles.css 的兜底写法是问卷/结果
  // 共享类从 Web globals 上移时逐字保留的历史防御，随接触清理。
  'apps/web/styles/globals.css': { literals: 8, appTokenFallbacks: 0, offGridSpacing: 1 },
  'packages/ui-web/src/arena/styles.css': { literals: 2, appTokenFallbacks: 0, offGridSpacing: 0 },
  'packages/ui-web/src/card-forge/styles.css': { literals: 85, appTokenFallbacks: 0, offGridSpacing: 22 },
  'packages/ui-web/src/product-shell.css': { literals: 130, appTokenFallbacks: 0, offGridSpacing: 11 },
  'packages/ui-web/src/styles.css': { literals: 89, appTokenFallbacks: 11, offGridSpacing: 6 },
};

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\s*\(/g;
const VAR_REF = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
const APP_TOKEN_FALLBACK = /var\(\s*--(?:app|creator)-[a-zA-Z0-9_-]+\s*,/g;
const OWNED_TOKEN = /^--(?:app|creator)-/;
const PX_LENGTH = /\b(\d+(?:\.\d+)?)px\b/g;

/** 盒间距属性：速记与方向/逻辑长柄都在内；border-width、outline 等不属于间距网格对象。 */
const SPACING_PROPS = new Set([
  'margin', 'padding', 'gap', 'row-gap', 'column-gap',
  'inset', 'inset-block', 'inset-inline',
  'top', 'right', 'bottom', 'left',
]);
const isSpacingProp = (prop: string): boolean =>
  SPACING_PROPS.has(prop) || /^(?:margin|padding|inset)-/.test(prop);

const collectCssFiles = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) collectCssFiles(full, out);
    } else if (entry.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
};

interface CssDecl {
  prop: string;
  value: string;
  selector: string;
  file: string;
}

interface ScannedFile {
  rel: string;
  decls: CssDecl[];
}

const scan = (): ScannedFile[] =>
  SCAN_ROOTS.flatMap((root) => collectCssFiles(root)).map((file) => {
    const rel = path.relative(REPO_ROOT, file).replaceAll('\\', '/');
    const rootNode = postcss.parse(readFileSync(file, 'utf8'), { from: file });
    const decls: CssDecl[] = [];
    rootNode.walkDecls((decl) => {
      const rule = decl.parent;
      decls.push({
        prop: decl.prop,
        value: decl.value,
        selector: rule?.type === 'rule' ? rule.selector : '',
        file: rel,
      });
    });
    return { rel, decls };
  });

const scanned = scan();

describe('READ-002 阅读刻度', () => {
  it('字号、行高和长文宽度刻度只由共享主题定义', () => {
    const declarations = scanned.find((file) => file.rel === TOKEN_OWNER_FILE)!.decls;
    const tokens = new Map(declarations.filter((decl) => decl.selector === ':root').map((decl) => [decl.prop, decl.value]));
    for (const percent of [110, 125, 150, 175, 200]) {
      expect(declarations.find((decl) => decl.selector === `:root[data-reading-size='${percent}']`
        && decl.prop === '--app-reading-scale')?.value).toBe(String(percent / 100));
    }
    expect(tokens.get('--app-reading-scale')).toBe('1');
    expect(tokens.get('--app-reading-text-xs')).toBe('0.75rem');
    expect(tokens.get('--app-reading-text-sm')).toBe('0.875rem');
    expect(tokens.get('--app-reading-text-base')).toBe('1rem');
    expect(tokens.get('--app-reading-leading-comfortable')).toBe('1.75');
    expect(tokens.get('--app-reading-leading-relaxed')).toBe('2');
    expect(tokens.get('--app-reading-width-narrow')).toBe('40em');
    expect(tokens.get('--app-font-serif')).toContain('"SimSun"');
  });
});
const declaredProps = new Set<string>();
for (const file of scanned) {
  for (const decl of file.decls) {
    if (decl.prop.startsWith('--')) declaredProps.add(decl.prop);
  }
}

describe('VIS-GATE-001 var() 可解析', () => {
  it('每个 var() 第一参数解析到声明或登记的可选命名空间；无兜底引用必须可解析', () => {
    const failures: string[] = [];
    for (const file of scanned) {
      for (const decl of file.decls) {
        for (const match of decl.value.matchAll(VAR_REF)) {
          const name = match[1];
          if (declaredProps.has(name)) continue;
          const registered = OPTIONAL_VAR_PREFIXES.some((entry) => name.startsWith(entry.prefix));
          const afterName = decl.value.slice(match.index! + match[0].length).trimStart();
          if (!registered) {
            failures.push(`${decl.file}: ${decl.prop} 引用未声明的 ${name}`);
          } else if (!afterName.startsWith(',')) {
            failures.push(`${decl.file}: ${decl.prop} 引用可选变量 ${name} 但未提供兜底`);
          }
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

describe('VIS-GATE-001 token 所有权', () => {
  it('--app-*/--creator-* 的 :root 级定义只在 styles.css；作用域改写只在登记表内', () => {
    const failures: string[] = [];
    for (const file of scanned) {
      for (const decl of file.decls) {
        if (!OWNED_TOKEN.test(decl.prop)) continue;
        if (decl.file === TOKEN_OWNER_FILE) continue;
        const registered = SCOPED_TOKEN_OVERRIDES.some(
          (entry) => entry.file === decl.file && decl.selector.includes(entry.scope),
        );
        if (!registered) {
          failures.push(`${decl.file}: ${decl.prop} 定义在 ${decl.selector || '(无选择器)'}，不在所有权/作用域登记内`);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

describe('VIS-GATE-001 字面量、兜底与间距基线（只降不增）', () => {
  const metrics = new Map<string, { literals: number; appTokenFallbacks: number; offGridSpacing: number }>();
  for (const file of scanned) {
    let literals = 0;
    let appTokenFallbacks = 0;
    let offGridSpacing = 0;
    for (const decl of file.decls) {
      if (decl.prop.startsWith('--')) continue; // token 定义本身可以含字面量——那正是定义
      literals += (decl.value.match(COLOR_LITERAL) ?? []).length;
      appTokenFallbacks += (decl.value.match(APP_TOKEN_FALLBACK) ?? []).length;
      if (isSpacingProp(decl.prop)) {
        for (const match of decl.value.matchAll(PX_LENGTH)) {
          if (Number.parseFloat(match[1]) % 4 !== 0) offGridSpacing += 1;
        }
      }
    }
    if (literals || appTokenFallbacks || offGridSpacing) metrics.set(file.rel, { literals, appTokenFallbacks, offGridSpacing });
  }

  if (process.env.BASELINE === 'print') {
    it('打印当前实测 baseline 供人工核对', () => {
      const table = Object.fromEntries([...metrics.entries()].sort());
      console.log(`当前实测 baseline（人工核对后粘贴到 FILE_BASELINE）：\n${JSON.stringify(table, null, 2)}`);
    });
    return;
  }

  it('逐文件计数不超过登记值；未登记文件要求双零', () => {
    const failures: string[] = [];
    for (const [file, actual] of metrics) {
      const baseline = FILE_BASELINE[file] ?? { literals: 0, appTokenFallbacks: 0, offGridSpacing: 0 };
      if (actual.literals > baseline.literals) {
        failures.push(`${file}: 颜色字面量 ${actual.literals} > baseline ${baseline.literals}`);
      }
      if (actual.appTokenFallbacks > baseline.appTokenFallbacks) {
        failures.push(`${file}: --app-* 兜底写法 ${actual.appTokenFallbacks} > baseline ${baseline.appTokenFallbacks}`);
      }
      if (actual.offGridSpacing > baseline.offGridSpacing) {
        failures.push(`${file}: 离网格间距 ${actual.offGridSpacing} > baseline ${baseline.offGridSpacing}（新增间距请消费 --app-space-* 或落 4px 网格）`);
      }
    }
    for (const file of Object.keys(FILE_BASELINE)) {
      if (!metrics.has(file)) {
        failures.push(`${file}: baseline 已登记但实测双零——请下调或移除登记（只降不增的另一半）`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
