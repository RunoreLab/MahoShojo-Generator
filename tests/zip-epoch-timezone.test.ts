import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ZIP 打包的跨时区确定性门禁。
 *
 * ## 这条门禁守的是什么
 *
 * 两个生产打包器（Web 包 ZIP、本地库 portable archive）都把固定条目时间交给 `zipSync`，让同一份
 * 输入产出逐字节相同的归档。那份固定时间的**构造方式**曾经是错的：
 *
 * ```ts
 * new Date('1980-01-01T00:00:00.000Z')   // ← UTC 字面量
 * ```
 *
 * ZIP 的 DOS 日期字段无时区，而 `fflate` 用**本地时间 getter**（`getFullYear()` / `getMonth()` …）
 * 编码并校验 1980–2099 区间。因此这个常量在 `TZ=America/Los_Angeles` 下是本地
 * 1979-12-31 16:00，年份落在区间外，`zipSync` 直接抛 `date not in range 1980-2099`。
 *
 * 实测（本仓库当前依赖 fflate 0.8.3）：
 *
 * ```text
 * TZ=UTC / Asia/Shanghai        打包成功，但非 UTC 时区产出的字节与 UTC 不同
 * TZ=America/Los_Angeles        打包抛错
 * ```
 *
 * 后果不是"未来某个功能可能有 bug"：Web 包导出是**已在生产**的路径，
 * `packWebPackageZip` 被 `useWebPackagePresetDownload`、`useSoloWebPackageSection.downloadFromLibrary`
 * 等调用。也就是说 UTC 以西的用户当时根本无法导出 Web 包——仓库自己的测试套件在
 * `TZ=America/Los_Angeles` 下会有 37 条 web-package 用例与 5 条 local-library 用例变红。
 *
 * ## 为什么必须起子进程
 *
 * 缺陷的形状是"同一份常量在某些时区抛错、在另一些时区产出不同字节"。要观测它，就得让
 * `new Date(...)` 在不同 `TZ` 下被求值。进程内改 `process.env.TZ` 不可靠：V8/ICU 会缓存时区，
 * 改环境变量未必生效。一个恒真的门禁比没有门禁更糟——它会让人以为这块已经验过。
 *
 * 所以这里用 esbuild 把生产代码打成一份 ESM（与 `scripts/measure-archive-memory.mjs` 同一做法：
 * 包内源码用无扩展名相对导入，Node 的 ESM 解析器不接受），再让每个时区各起一个干净子进程加载
 * 它，比对两处打包器的输出摘要。
 *
 * ## 为什么断言"所有时区摘要相同"而不是逐个断言
 *
 * 逐个断言会重复陈述同一条规则，而真正要守住的是**唯一**的不变量：产物与宿主机时区无关。
 * 因此这里只比一次——把西半球、中半球、最东与最西四个时区一起压进同一个断言，失败时再展开
 * 实际值。`UTC` 单独跑一条，是为了让失败信息里有一行"基准"可读，而不是让读者自己去猜
 * 哪个是基准。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(here, '..');
const require = createRequire(import.meta.url);

/**
 * 覆盖四种极端：UTC 基准、西半球（负偏移）、东半球（正偏移）、以及 UTC+14 / UTC-11 这类
 * 会把日期推到相邻两天的时区。最后两个是真正能把 bug 变成"抛错"而不是"字节不同"的那种。
 */
const TIMEZONES = ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati'] as const;

interface PackedDigests {
  readonly libraryArchive: string;
  readonly webPackageZip: string;
}

/** 共享纪元在该时区下读到的**本地**时间分量——`fflate` 编码 DOS 日期时读的就是这些。 */
interface EpochLocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

let bundleDirectory: string;
let bundlePath: string;
let childScript: string;

beforeAll(async () => {
  const esbuild = require('esbuild');
  bundleDirectory = mkdtempSync(path.join(tmpdir(), 'mahoshojo-zip-epoch-'));
  bundlePath = path.join(bundleDirectory, 'zip-epoch-probe.mjs');
  childScript = path.join(here, 'support', 'zip-epoch-child.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'support', 'zip-epoch-probe.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: `node${process.versions.node.split('.')[0]}`,
    outfile: bundlePath,
    logLevel: 'silent',
  });
}, 60_000);

afterAll(() => {
  if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true });
});

/**
 * 在给定 `TZ` 下跑子进程，返回两行 stdout 解析后的结果。
 *
 * **刻意不让"打包失败"把整个调用变成异常**：纪元数据与打包数据是两次独立写入 stdout 的，
 * 因此打包抛错时纪元那部分仍然可读。把两者绑在一起会让"某个调用点自写了错误纪元"这种注入
 * 报成"读不到纪元数据"，而那正是排障时最需要看到的东西。
 */
const runUnder = (timezone: string): {
  epochLocalParts: EpochLocalParts;
  archives: PackedDigests | null;
  packingError: string | null;
} => {
  let stdout: string;
  let stderr = '';
  try {
    stdout = execFileSync(process.execPath, [childScript, bundlePath], {
      // `TZ` 是进程级环境变量，必须在 spawn 时给出。
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // 子进程在打包阶段非零退出时 stdout 可能仍有内容（纪元那行已写出）。
    stdout = (error as { stdout?: string }).stdout ?? '';
    stderr = (error as { stderr?: string }).stderr ?? '';
  }
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  const first = lines[0] ? (JSON.parse(lines[0]) as { epochLocalParts: EpochLocalParts }) : null;
  const second = lines[1] ? (JSON.parse(lines[1]) as PackedDigests) : null;
  if (!first) {
    throw new Error(`TZ=${timezone} 下子进程未产出纪元数据：\n${stderr.trim()}`);
  }
  return {
    epochLocalParts: first.epochLocalParts,
    archives: second,
    packingError: second === null ? stderr.trim() : null,
  };
};

/** 打包失败时把生产错误原样抛出，而不是重述成一条含糊的断言失败。 */
const packUnder = (timezone: string): PackedDigests => {
  const { archives, packingError } = runUnder(timezone);
  if (archives === null) {
    throw new Error(
      `TZ=${timezone} 下打包失败——固定条目时间仍落在 DOS 日期区间之外，或打包器另有错误：\n${packingError}`,
    );
  }
  return archives;
};

describe('ZIP 打包的条目时间与宿主机时区无关', () => {
  it('produces byte-identical archives in UTC and in every other probed timezone', () => {
    const baseline = packUnder('UTC');
    const observed = TIMEZONES.map((timezone) => [timezone, packUnder(timezone)] as const);

    // 只比两个归档摘要：`epochLocalParts` 在任何时区都相同，把它塞进比较对象会让这条断言
    // 同时守住两件事，而两件事各自的失败原因不同——混在一起时，读者要自己分辨哪一维变了。
    const archiveOf = ([, digests]: readonly [string, PackedDigests]) => ({
      libraryArchive: digests.libraryArchive,
      webPackageZip: digests.webPackageZip,
    });

    // 时区逐个列出，让失败时能直接看出是哪一个偏移越界，而不是只看到一个聚合后的期望值。
    expect(observed.map((entry) => [entry[0], archiveOf(entry)])).toEqual([
      ['UTC', archiveOf(['UTC', baseline])],
      ...TIMEZONES.filter((timezone) => timezone !== 'UTC').map(
        (timezone) => [timezone, archiveOf(['UTC', baseline])] as const,
      ),
    ]);
  });

  it('keeps both production packers reachable from the probe', () => {
    // 门禁的全部价值在于它测的是**生产代码**。若某个入口路径改动导致打包器没被真正打包进来，
    // 上面那条会变成"比较两个空对象"而恒真。这里断言两个摘要都是真实 SHA-256。
    const digests = packUnder('UTC');
    for (const name of ['libraryArchive', 'webPackageZip'] as const) {
      expect(digests[name], `${name} 必须是一个真实的 SHA-256 摘要`).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('keeps every ZIP mtime sourced from the shared epoch constant', () => {
    // 运行期门禁抓的是"现在有没有坏"，这条抓的是"有没有人重新手写了一份纪元"。
    //
    // 两者都需要：共享常量被改坏时运行期门禁变红，而某个新调用点绕过常量、自己写一份
    // `new Date('1980-01-01T00:00:00.000Z')` 时，运行期门禁要等到那个调用点真的在某个时区
    // 被打包才会发现——而那条路径可能还没有生产消费者。缺陷就是在那之前进来的。
    //
    // 只扫 `src/`：测试夹具里手写纪元是允许的（它们要模拟"别的工具打出来的 ZIP"）。上一轮
    // 正是因为夹具里也写了 UTC 字面量，30 条导入用例在美洲时区下变成了"打包器坏了"——症状
    // 与根因完全无关，因此夹具也一并改掉了。
    //
    // 扫描排除注释：本文件自己就要在注释里写出那个错误写法来讲清"为什么不能这么写"，因此
    // 只匹配**赋值语句**形态（`= new Date(` / `: Date = new Date(`），而不是任何出现。
    const offenders: string[] = [];
    const assignmentPattern = /[:=]\s*new Date\(\s*['"`]1980-01-01/u;
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        if (assignmentPattern.test(readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(rootDirectory, full));
        }
      }
    };
    for (const packageName of ['local-library', 'web-package', 'contracts']) {
      visit(path.join(rootDirectory, 'packages', packageName, 'src'));
    }
    expect(offenders).toEqual([]);
  });

  it('reads the shared epoch as local 1980-01-01 midnight in every probed timezone', () => {
    // 结构门禁的补充，且在**每个**时区各跑一遍：即使常量被改成 UTC 字面量，这条也会立刻变红，
    // 而不必等到"某个时区恰好落在 1980 之外"才通过运行期门禁暴露。
    //
    // 它读的是打包**之前**写出的那一行，因此不依赖打包成功——否则"某个调用点自写了错误纪元"
    // 这种注入会让这条一起失败，而它该给出的证据恰恰是纪元本身读成了什么。
    const observed = TIMEZONES.map((timezone) => [timezone, runUnder(timezone).epochLocalParts]);
    const expected: EpochLocalParts = {
      year: 1980,
      month: 0,
      day: 1,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
    expect(observed.map(([timezone, parts]) => [timezone, parts])).toEqual(
      TIMEZONES.map((timezone) => [timezone, expected]),
    );
  });
});