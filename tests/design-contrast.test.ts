/**
 * 设计对比度契约：`SPEC-visual-baseline-v1` 的 VIS-GATE-002 的执行形式。
 *
 * ## 这条测试守的是什么
 *
 * `styles.css` 里的 `--app-*` token 是「文本会放在什么底色上」的唯一权威，但「权威存在」不等于
 * 「配对可读」：语义前景/语义背景的实际组合是否真的满足 WCAG 阈值，没有任何东西在检查。本测试
 * 按登记的语义配对计算真实对比度——普通文本 ≥4.5、控件边界/焦点指示 ≥3——亮/暗两套主题上下文
 * 各自断言。
 *
 * ## 计算口径（与 VIS-GATE-002 一致）
 *
 * - 透明度先合成：`--app-surface` 是 `rgba(255,255,255,0.95)` 这类半透明色，先与登记背景
 *   （`--app-page-bg`）逐通道 alpha 合成，再对合成色算亮度；输入框则是 page → surface → input
 *   三层链。存量页底保留色档检查；错误面指定 sRGB 插值并用通道包络证明整个连续区间，
 *   不能把两个端点都达标当成任意渐变全程达标。
 * - WCAG 2.x 相对亮度公式，中间值不取整——4.4998 就是 4.4998，不是 4.5。
 *
 * ## 已知缺口怎么处理
 *
 * 落地本测试时已实测出若干存量不达标组合（如强调色文本、输入边界、暗色页底渐变端上的弱化
 * 文本）。它们登记为 `known-violation`：门禁仍通过、缺口可见、单独修复。**一旦实测转为达标，
 * 测试会报「请提升为 required」**——登记不是豁免，是待办。
 *
 * ## 反向哨兵
 *
 * `describe('哨兵')` 断言：构造的必败配对必须被判定失败、必胜配对必须被判定通过。没有它，
 * 矩阵可能因为解析静默失败而「全部通过」，形同虚设。
 * 依据：https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const WEB_ROOT = path.join(REPO_ROOT, 'apps', 'web');
const STYLES_CSS = path.join(REPO_ROOT, 'packages', 'ui-web', 'src', 'styles.css');
const PRODUCT_SHELL_CSS = path.join(REPO_ROOT, 'packages', 'ui-web', 'src', 'product-shell.css');

const requireFromApp = createRequire(path.join(WEB_ROOT, 'package.json'));
const postcss = createRequire(requireFromApp.resolve('@tailwindcss/postcss'))('postcss') as typeof import('postcss');

/* ------------------------------------------------------------------ */
/* 主题上下文解析：`styles.css` 的三段结构（默认 :root / 系统暗 / 显式暗）。 */
/* ------------------------------------------------------------------ */

const collectTokenDecls = () => {
  const base: Record<string, string> = {};
  const mediaDark: Record<string, string> = {};
  const explicitLight: Record<string, string> = {};
  const explicitDark: Record<string, string> = {};

  const rootNode = postcss.parse(readFileSync(STYLES_CSS, 'utf8'), { from: STYLES_CSS });
  rootNode.walkDecls((decl) => {
    if (!decl.prop.startsWith('--')) return;
    const rule = decl.parent;
    const selector = rule?.type === 'rule' ? rule.selector : '';
    let inDarkMedia = false;
    let node = decl.parent?.parent;
    while (node) {
      if (node.type === 'atrule' && /prefers-color-scheme\s*:\s*dark/.test((node as { params?: string }).params ?? '')) {
        inDarkMedia = true;
      }
      node = node.parent;
    }
    if (selector.includes("[data-color-mode='dark']")) {
      explicitDark[decl.prop] = decl.value;
    } else if (selector.includes("[data-color-mode='light']")) {
      explicitLight[decl.prop] = decl.value;
    } else if (inDarkMedia) {
      mediaDark[decl.prop] = decl.value;
    } else if (selector === ':root' || selector === '') {
      base[decl.prop] = decl.value;
    }
    // 其他作用域（.blue-theme 等）不进入主题上下文
  });

  return {
    light: { ...base, ...explicitLight },
    dark: { ...base, ...mediaDark, ...explicitDark },
  };
};

const CONTEXTS = collectTokenDecls();

/* ------------------------------------------------------------------ */
/* 颜色解析与 WCAG 计算                                                 */
/* ------------------------------------------------------------------ */

interface Srgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const KEYWORDS: Record<string, Srgba> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

const parseColor = (raw: string): Srgba | null => {
  const value = raw.trim().toLowerCase();
  if (KEYWORDS[value]) return KEYWORDS[value];
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
    if ([3, 4].includes(hex.length)) {
      return { r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]), a: hex.length === 4 ? expand(hex[3]) / 255 : 1 };
    }
    if ([6, 8].includes(hex.length)) {
      return {
        r: expand(hex.slice(0, 2)),
        g: expand(hex.slice(2, 4)),
        b: expand(hex.slice(4, 6)),
        a: hex.length === 8 ? expand(hex.slice(6, 8)) / 255 : 1,
      };
    }
    return null;
  }
  const rgbMatch = value.match(/^rgba?\((.+)\)$/);
  if (rgbMatch) {
    const body = rgbMatch[1].replace('/', ' ');
    const parts = body.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (s: string) => (s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s));
    return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: parts[3] !== undefined ? parseFloat(parts[3]) : 1 };
  }
  return null;
};

const COLOR_ATOM = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g;

/** 把一个声明值解析成色档列表：单色值给一档，`linear-gradient` 等给全部色档。 */
const parseStops = (value: string): Srgba[] => {
  const atoms = value.match(COLOR_ATOM) ?? [];
  const stops = atoms.map((atom) => parseColor(atom)).filter((c): c is Srgba => c !== null);
  return stops;
};

/** 解析 token 值，顺带解一层 var() 引用（token 定义间引用）。 */
const resolveToken = (ctx: Record<string, string>, name: string, depth = 0): string | null => {
  if (depth > 5) return null;
  const value = ctx[name];
  if (value === undefined) return null;
  const varMatch = value.match(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,([^)]*))?\)/);
  if (varMatch) {
    const inner = resolveToken(ctx, varMatch[1], depth + 1);
    const resolved = inner ?? varMatch[2]?.trim();
    if (!resolved) return null;
    return resolveToken(ctx, name, depth + 1) ?? resolved;
  }
  return value;
};

const compositeOver = (fg: Srgba, bg: Srgba): Srgba => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1,
});

const linearize = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const luminance = (c: Srgba) => 0.2126 * linearize(c.r) + 0.7152 * linearize(c.g) + 0.0722 * linearize(c.b);

const contrast = (a: Srgba, b: Srgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** 限定为错误面的两个不透明 sRGB 色档；新语法不可静默按旧插值算通过。 */
const parseOpaqueSrgbGradient = (value: string): Srgba[] | null => {
  const match = value.match(/^linear-gradient\(\s*[-+]?(?:\d+(?:\.\d+)?|\.\d+)deg\s+in\s+srgb\s*,\s*(#[0-9a-f]{3,8})\s*,\s*(#[0-9a-f]{3,8})\s*\)$/i);
  if (!match) return null;
  const stops = [parseColor(match[1]), parseColor(match[2])];
  return stops.every((stop): stop is Srgba => stop !== null && stop.a === 1) ? stops : null;
};

/**
 * sRGB 插值全程的每个通道都在色档最小/最大值之间，相对亮度逐通道单调递增。
 * 用前景亮度下界 / 背景上界（或反向）证明连续区间，不把两个端点当全程。
 * 透明前景先与通道界合成，覆盖既有 opacity-95 帮助链接；区间重叠即保守判 1。
 */
const gradientContrastLowerBound = (foreground: Srgba, stops: Srgba[]): number => {
  const bound = (pick: (...values: number[]) => number): Srgba => ({
    r: pick(...stops.map((stop) => stop.r)), g: pick(...stops.map((stop) => stop.g)),
    b: pick(...stops.map((stop) => stop.b)), a: 1,
  });
  const low = bound(Math.min), high = bound(Math.max);
  const bgLow = luminance(low), bgHigh = luminance(high);
  const fgLow = luminance(compositeOver(foreground, low)), fgHigh = luminance(compositeOver(foreground, high));
  if (fgLow >= bgHigh) return (fgLow + 0.05) / (bgHigh + 0.05);
  if (bgLow >= fgHigh) return (bgLow + 0.05) / (fgHigh + 0.05);
  return 1;
};

/* ------------------------------------------------------------------ */
/* 语义配对登记与断言                                                   */
/* ------------------------------------------------------------------ */

type PairStatus = 'required' | 'known-violation';

interface ContrastPair {
  /** 语义前景：token 名或字面量（哨兵用）。 */
  foreground: string;
  /** 背景合成链：从页面底到顶逐层 token 名（最后一个是最贴近前景的表面）。 */
  backdropChain: string[];
  min: number;
  light: PairStatus;
  dark: PairStatus;
  foregroundOpacity?: number;
  /** 该背景是有全程连续区间证明的两档不透明 sRGB 渐变，而非只检查色档。 */
  opaqueSrgbGradient?: boolean;
  note?: string;
}

const PAGE = '--app-page-bg';
const SURFACE = '--app-surface';
const INPUT = '--app-input-bg';
const ERROR_SURFACES = [
  { selector: '.error-message', gradient: '--app-error-bg-gradient', fallback: '--app-error-bg' },
  { selector: '.blue-theme .error-message', gradient: '--app-error-blue-bg-gradient', fallback: '--app-error-blue-bg' },
] as const;

const PAIRS: ReadonlyArray<ContrastPair> = [
  ...ERROR_SURFACES.flatMap(({ gradient, fallback }) => [1, 0.95].flatMap((foregroundOpacity): ContrastPair[] => [
    { foreground: '--app-error-text', foregroundOpacity, backdropChain: [gradient], opaqueSrgbGradient: true,
      min: 4.5, light: 'required', dark: 'required', note: '错误正文及继承白色的帮助链接；覆盖整个不透明 sRGB 渐变' },
    { foreground: '--app-error-text', foregroundOpacity, backdropChain: [fallback],
      min: 4.5, light: 'required', dark: 'required', note: '旧浏览器不支持指定插值时仍保留独立纯色底' },
  ])),
  { foreground: '--app-text', backdropChain: [PAGE], min: 4.5, light: 'required', dark: 'known-violation',
    note: '暗色 page-bg 渐变粉端（#d8578b 档）上的直接正文不达标；页脚等直接落在页底上的文本受影响' },
  { foreground: '--app-text', backdropChain: [PAGE, SURFACE], min: 4.5, light: 'required', dark: 'required' },
  { foreground: '--app-button-neutral-text', backdropChain: ['--app-button-neutral-bg'], min: 4.5, light: 'required', dark: 'required' },
  { foreground: '--app-button-neutral-text', backdropChain: ['--app-button-neutral-hover-bg'], min: 4.5, light: 'required', dark: 'required' },
  { foreground: '--app-text-subtle', backdropChain: [PAGE, SURFACE], min: 3, light: 'required', dark: 'required',
    note: '中性色按钮边界' },
  { foreground: '--app-text-muted', backdropChain: [PAGE, SURFACE], min: 4.5, light: 'required', dark: 'required' },
  { foreground: '--app-text-muted', backdropChain: [PAGE], min: 4.5, light: 'required', dark: 'known-violation',
    note: '同上：暗色渐变粉端上的页脚弱化文本不达标' },
  { foreground: '--app-text-subtle', backdropChain: [PAGE, SURFACE, INPUT], min: 4.5, light: 'required', dark: 'required' },
  { foreground: '--app-text', backdropChain: [PAGE, SURFACE, INPUT], min: 4.5, light: 'required', dark: 'required' },
  { foreground: '--app-accent', backdropChain: [PAGE, SURFACE], min: 4.5, light: 'known-violation', dark: 'required',
    note: '亮色强调色文本（链接等）on 卡片约 2.7:1，未达文本阈值' },
  { foreground: '--app-accent-strong', backdropChain: [PAGE, SURFACE], min: 4.5, light: 'known-violation', dark: 'known-violation',
    note: '亮色强调强色文本 on 卡片约 3.3:1；暗色 4.498:1 距 4.5 差 0.002，按不取整口径登记' },
  { foreground: '--app-input-border', backdropChain: [PAGE, SURFACE, INPUT], min: 3, light: 'known-violation', dark: 'known-violation',
    note: '输入框边界色两主题均未达非文本 3:1（亮约 1.2、暗约 2.0）' },
  { foreground: '--app-border-strong', backdropChain: [PAGE, SURFACE], min: 3, light: 'known-violation', dark: 'known-violation',
    note: '控件/卡片边界色两主题均未达 3:1' },
  { foreground: '--app-focus-ring', backdropChain: [PAGE, SURFACE], min: 3, light: 'known-violation', dark: 'known-violation',
    note: 'focus-ring 为低透明度晕影而非轮廓，两主题均 <2:1；焦点可见性实际由 --app-accent 轮廓承担' },
  { foreground: '--app-accent', backdropChain: [PAGE, SURFACE], min: 3, light: 'known-violation', dark: 'required',
    note: '焦点指示实际使用的 accent 轮廓：亮色约 2.7:1 未达非文本 3:1' },
];

const evaluatePair = (ctx: Record<string, string>, pair: ContrastPair): { ratio: number; error?: string } => {
  // 背景合成链：第一层给色档列表，后续每层 token 色（含自身透明度）逐档合成。
  const first = resolveToken(ctx, pair.backdropChain[0]);
  if (first === null) return { ratio: 0, error: `背景 token ${pair.backdropChain[0]} 未定义` };
  let backdrops = parseStops(first);
  if (backdrops.length === 0) return { ratio: 0, error: `背景 token ${pair.backdropChain[0]} 解析不到颜色` };

  for (const layer of pair.backdropChain.slice(1)) {
    const value = resolveToken(ctx, layer);
    if (value === null) return { ratio: 0, error: `背景 token ${layer} 未定义` };
    const layerColors = parseStops(value);
    if (layerColors.length === 0) return { ratio: 0, error: `背景 token ${layer} 解析不到颜色` };
    // 表面层取自身色（多层表面取第一档——表面 token 都是单色）
    const layerColor = layerColors[0];
    backdrops = backdrops.map((bg) => compositeOver(layerColor, bg));
  }

  const fgRaw = pair.foreground.startsWith('--') ? resolveToken(ctx, pair.foreground) : pair.foreground;
  if (fgRaw === null) return { ratio: 0, error: `前景 token ${pair.foreground} 未定义` };
  const fgColors = parseStops(fgRaw);
  if (fgColors.length === 0) return { ratio: 0, error: `前景 ${pair.foreground} 解析不到颜色` };
  const fg = { ...fgColors[0], a: fgColors[0].a * (pair.foregroundOpacity ?? 1) };

  if (pair.opaqueSrgbGradient) {
    const stops = parseOpaqueSrgbGradient(first);
    if (!stops || pair.backdropChain.length !== 1) return { ratio: 0, error: '错误面必须是单层、两档不透明且显式 sRGB 插值的渐变' };
    return { ratio: gradientContrastLowerBound(fg, stops) };
  }

  const ratios = backdrops.map((bg) => {
    const shownFg = fg.a < 1 ? compositeOver(fg, bg) : fg;
    return contrast(shownFg, bg);
  });
  return { ratio: Math.min(...ratios) };
};

const describeRatio = (ratio: number) => (ratio === Infinity ? '∞' : ratio.toFixed(3));

describe('VIS-GATE-002 对比度矩阵', () => {
  for (const theme of ['light', 'dark'] as const) {
    const ctx = CONTEXTS[theme];
    for (const pair of PAIRS) {
      const status = pair[theme];
      const label = `${pair.foreground}${pair.foregroundOpacity === 0.95 ? '（95% 帮助文字）' : ''} on ${pair.backdropChain.join('>')}`;
      const measurement = pair.opaqueSrgbGradient ? '全程保守下界' : '计算比率';
      it(`${theme}: ${label} ≥${pair.min}（${status}）`, () => {
        const { ratio, error } = evaluatePair(ctx, pair);
        expect(error, error).toBeUndefined();
        if (status === 'required') {
          expect(
            ratio,
            `${theme} ${label} ${measurement} ${describeRatio(ratio)}:1，低于 ${pair.min}:1` +
              (pair.note ? `（${pair.note}）` : ''),
          ).toBeGreaterThanOrEqual(pair.min);
        } else if (ratio >= pair.min) {
          expect.fail(
            `${theme} ${label} ${measurement} ${describeRatio(ratio)}:1 已达标——请将本条从 known-violation 提升为 required`,
          );
        }
      });
    }
  }
});

it('共享错误类消费已验配色，纯色底不被不支持的渐变或蓝色覆盖清除', () => {
  const stylesheet = postcss.parse(readFileSync(PRODUCT_SHELL_CSS, 'utf8'));
  for (const surface of ERROR_SURFACES) {
    const declarations: Record<string, string> = {};
    stylesheet.walkRules(surface.selector, (rule) => rule.walkDecls((decl) => { declarations[decl.prop] = decl.value; }));
    expect(declarations.background).toBeUndefined();
    expect(declarations['background-color']).toBe(`var(${surface.fallback})`);
    expect(declarations['background-image']).toBe(`var(${surface.gradient})`);
    if (surface.selector === '.error-message') expect(declarations.color).toBe('var(--app-error-text)');
    else expect(declarations.color).toBeUndefined(); // 蓝主题继承同一文字色
  }
});

describe('哨兵：矩阵必须能区分必胜与必败', () => {
  const probe: ContrastPair = { foreground: '#ffffff', backdropChain: [PAGE], min: 4.5, light: 'required', dark: 'required' };
  const good: ContrastPair = { foreground: '#000000', backdropChain: [PAGE], min: 4.5, light: 'required', dark: 'required' };

  it('白 on 页底（必败构造）实测低于阈值', () => {
    expect(evaluatePair(CONTEXTS.light, probe).ratio).toBeLessThan(probe.min);
  });
  it('黑 on 页底（必胜构造）实测高于阈值', () => {
    expect(evaluatePair(CONTEXTS.light, good).ratio).toBeGreaterThanOrEqual(good.min);
  });
  it('登记表至少保留一条 known-violation，证明缺口登记机制非空转', () => {
    expect(PAIRS.some((pair) => pair.light === 'known-violation' || pair.dark === 'known-violation')).toBe(true);
  });
  it('拒绝端点均达标但中间穿过前景色的渐变', () => {
    const foreground = parseColor('#767676')!;
    const stops = parseOpaqueSrgbGradient('linear-gradient(135deg in srgb, #000000, #ffffff)')!;
    expect(stops.every((stop) => contrast(foreground, stop) >= 4.5)).toBe(true);
    expect(gradientContrastLowerBound(foreground, stops)).toBe(1);
  });
  it('不把其他插值空间或透明背景当作已证明的错误渐变', () => {
    expect(parseOpaqueSrgbGradient('linear-gradient(135deg in oklab, #c2414b, #ad3048)')).toBeNull();
    expect(parseOpaqueSrgbGradient('linear-gradient(135deg in srgb, #c2414b80, #ad3048)')).toBeNull();
    expect(parseOpaqueSrgbGradient('linear-gradient(1..2deg in srgb, #c2414b, #ad3048)')).toBeNull();
    expect(parseOpaqueSrgbGradient('linear-gradient(.deg in srgb, #c2414b, #ad3048)')).toBeNull();
  });
});
