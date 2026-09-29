import { describe, expect, it } from 'vitest';
import { digestWebPackageBytes, verifyWebPackage } from '../src';
import { scanWebPackageBase } from '../src/security';

const encoder = new TextEncoder();

/** Stands in for a reference implementation: never loaded, only read as context. */
const REFERENCE_ENGINE = [
  '<!doctype html><html><body><canvas id="stage"></canvas><script>',
  "fetch('https://cdn.example.com/font.woff');",
  "localStorage.setItem('seen','1');",
  "eval('1');",
  '</script></body></html>',
].join('\n');

type Spec = { path: string; mediaType: string; content: string };

const buildPackage = async (specs: readonly Spec[], generation: Record<string, unknown>) => {
  const files = await Promise.all(specs.map(async ({ path, mediaType, content }) => {
    const bytes = encoder.encode(content);
    return { path, mediaType, size: bytes.byteLength, digest: await digestWebPackageBytes(bytes), bytes };
  }));
  const descriptors = await Promise.all(files.map(async ({ path, mediaType, size, digest }) => ({ path, mediaType, size, digest })));
  return verifyWebPackage({
    format: 'mahoshojo-web-package', formatVersion: 1, id: 'probe.example', version: '1.0.0', name: '范例语义探针',
    entry: 'index.html', generation, files: descriptors,
  }, files);
};

const shell: Spec[] = [
  { path: 'index.html', mediaType: 'text/html', content: '<!doctype html><title>包入口</title>' },
  { path: 'ai/instructions.md', mediaType: 'text/markdown', content: '请生成弹幕游戏。'.repeat(80) },
];

const withReference: Spec[] = [...shell, { path: 'reference/engine.html', mediaType: 'text/html', content: REFERENCE_ENGINE }];

describe('generation.example 的两种用法', () => {
  it('参考实现是提示投影输入，不按运行时资源扫描', async () => {
    // 一份只会被读、从不加载的代码，不应该让包背上 network / site-storage /
    // dynamic-execution 的授权警告。
    const withExample = await scanWebPackageBase(await buildPackage(
      withReference,
      { target: 'index.html', mode: 'replace', mediaType: 'text/html', instructions: 'ai/instructions.md', example: 'reference/engine.html' },
    ));
    expect(withExample.categories).not.toContain('network');
    expect(withExample.categories).not.toContain('site-storage');
    expect(withExample.categories).not.toContain('dynamic-execution');
    expect(withExample.uncertainty.join('\n')).toContain('2 个提示词/说明文件未按运行时能力扫描');
  });

  it('同一个文件不声明为 example 时照常按运行时资源扫描', async () => {
    const withoutExample = await scanWebPackageBase(await buildPackage(
      withReference,
      { target: 'index.html', mode: 'replace', mediaType: 'text/html', instructions: 'ai/instructions.md' },
    ));
    expect(withoutExample.categories).toEqual(expect.arrayContaining(['network', 'site-storage', 'dynamic-execution']));
  });

  it('提示字段不得指向 entry：否则入口的代码不进授权判断', async () => {
    // 修复前：instructions 指向 index.html 时 categories 为空，恶意入口完全隐身。
    const execEntry = `<!doctype html><html><body><script>fetch('https://evil.example/x');localStorage.setItem('k','1');eval('1');</script></body></html>`;
    await expect(buildPackage(
      [{ path: 'index.html', mediaType: 'text/html', content: execEntry }],
      { target: 'index.html', mode: 'replace', mediaType: 'text/html', instructions: 'index.html' },
    )).rejects.toThrow(/prompt file must not be the entry/u);

    await expect(buildPackage(
      [{ path: 'index.html', mediaType: 'text/html', content: execEntry }],
      { target: 'index.html', mode: 'replace', mediaType: 'text/html', example: 'index.html' },
    )).rejects.toThrow(/prompt file must not be the entry/u);
  });

  it('生成目标可以同时是 example：overlay 永远被扫描', async () => {
    // 这是自然写法——用目标文件现有的内容当范例。base 侧跳过没问题，AI 产出的
    // overlay 侧由 isOverlay 短路保证被扫描。
    const base = await buildPackage(
      [...shell, { path: 'data/events.json', mediaType: 'application/json', content: '[{"id":"e1","text":"旧事件"}]' }],
      { target: 'data/events.json', mode: 'replace', mediaType: 'application/json', instructions: 'ai/instructions.md', example: 'data/events.json' },
    );
    expect(base.manifest.generation.example).toBe('data/events.json');
  });

  it('扫描器不盲信投影清单：entry 即使被列成 example 也照常扫描', async () => {
    // 纵深防御：manifest 校验会拒绝 example === entry，但扫描器不能依赖这一点。
    // 入口里的代码一定会执行，所以无论它是否被列进提示投影字段，都必须进档案。
    const execEntry = `<!doctype html><html><body><script>fetch('https://evil.example/x');eval('1');</script></body></html>`;
    const base = await buildPackage(
      [{ path: 'index.html', mediaType: 'text/html', content: execEntry }],
      { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
    );
    const forged = {
      ...base,
      manifest: { ...base.manifest, generation: { ...base.manifest.generation, example: 'index.html' } },
    };
    expect(scanWebPackageBase(forged).categories).toEqual(expect.arrayContaining(['network', 'dynamic-execution']));
  });
});
