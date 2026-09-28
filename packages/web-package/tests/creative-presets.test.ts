import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
const FORUM_SAMPLE = JSON.parse(readFileSync(new URL('../presets/starlight-forum/data/story.json', import.meta.url), 'utf8'));
const CHOICE_SAMPLE = JSON.parse(readFileSync(new URL('../presets/crossroads/data/story.json', import.meta.url), 'utf8'));
import { FORUM_PACKAGE_REF, CHOICE_PACKAGE_REF } from '../src/creative-presets-v1';
import { createWebPackageOverlay, resolveWebPackage, packWebPackageZip, unpackWebPackageZip, stageLocalWebPackage, unstageLocalWebPackage } from '../src';
import { canRenderBuiltinWebPackageSrcdoc, renderBuiltinWebPackageSrcdoc } from '../src/visual-novel-adapter';

class Element {
  children: Element[] = [];
  textContent = '';
  className = '';
  value = '';
  disabled = false;
  attributes = new Map<string, string>();
  events = new Map<string, () => void>();
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  addEventListener(name: string, action: () => void) { this.events.set(name, action); }
  focus() {}
  click() { if (!this.disabled) this.events.get('click')?.(); }
  all(): Element[] { return [this, ...this.children.flatMap((el) => el.all())]; }
  querySelector(selector: string) { return this.all().find((el) => selector.startsWith('.') ? el.className === selector.slice(1) : el.tag === selector); }
}
async function mount(ref: typeof FORUM_PACKAGE_REF, source: unknown) {
  const { html } = await renderBuiltinWebPackageSrcdoc(await createWebPackageOverlay(ref, JSON.stringify(source)));
  const content = html.match(/<script type="application\/json" id="web-package-story">([\s\S]*?)<\/script>/u)![1];
  const runtime = html.match(/<script>([\s\S]*?)<\/script>/u)![1];
  const root = new Element('main');
  runInNewContext(runtime, { document: { getElementById: (id: string) => id === 'app' ? root : { textContent: content }, createElement: (tag: string) => new Element(tag) } }, { timeout: 1000 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return root;
}
const button = (root: Element, label: string) => root.all().find((el) => el.tag === 'button' && el.textContent.includes(label))!;

describe('creative builtin experiences', () => {
  it.each([FORUM_PACKAGE_REF, CHOICE_PACKAGE_REF])('preserves pinned identity through ZIP import and exact renderer for $id', async (ref) => {
    const base = await resolveWebPackage(ref);
    expect(base.ref).toEqual(ref);
    const imported = await unpackWebPackageZip(await packWebPackageZip(base));
    expect(imported.ref).toEqual(ref);
    const sample = new TextDecoder().decode(base.readFile('data/story.json'));
    const original = await renderBuiltinWebPackageSrcdoc(await createWebPackageOverlay(ref, sample));
    stageLocalWebPackage(imported);
    try { expect(await renderBuiltinWebPackageSrcdoc(await createWebPackageOverlay(ref, sample))).toEqual(original); }
    finally { unstageLocalWebPackage(ref); }
    expect(original.html).not.toContain("fetch('data/story.json')");
    expect(canRenderBuiltinWebPackageSrcdoc({ ...ref, digest: `sha256:${'0'.repeat(64)}` })).toBe(false);
  });

  it('keeps hostile generated strings literal in data and rendered forum text', async () => {
    const source = { ...FORUM_SAMPLE, title: '</script><script>alert(1)</script>$&' };
    const { html } = await renderBuiltinWebPackageSrcdoc(await createWebPackageOverlay(FORUM_PACKAGE_REF, JSON.stringify(source)));
    expect(html).not.toContain(source.title);
    const root = await mount(FORUM_PACKAGE_REF, source);
    expect(root.querySelector('h1')?.textContent).toBe(source.title);
  });

  it('filters forum topics, reads replies and retains a local bookmark after returning', async () => {
    const root = await mount(FORUM_PACKAGE_REF, FORUM_SAMPLE);
    const search = root.querySelector('input')!;
    search.value = '月亮'; search.events.get('input')!();
    expect(root.all().filter((el) => el.className === 'post')).toHaveLength(1);
    root.querySelector('.post')!.click();
    expect(root.querySelector('h2')?.textContent).toBe(FORUM_SAMPLE.posts[1].title);
    expect(root.all().some((el) => el.textContent === FORUM_SAMPLE.posts[1].replies[0].text)).toBe(true);
    button(root, '收藏话题').click();
    expect(button(root, '已收藏').attributes.get('aria-pressed')).toBe('true');
    button(root, '返回话题广场').click();
    expect(root.querySelector('input')?.value).toBe('月亮');
    expect(root.all().filter((el) => el.className === 'post')).toHaveLength(1);
    root.querySelector('.post')!.click();
    expect(button(root, '已收藏').attributes.get('aria-pressed')).toBe('true');
  });

  it('locks each choice, produces distinct endings and resets the score on replay', async () => {
    const root = await mount(CHOICE_PACKAGE_REF, CHOICE_SAMPLE);
    for (let i = 0; i < CHOICE_SAMPLE.challenges.length; i++) {
      const choice = button(root, 'A /'); choice.click(); choice.click();
      expect(root.querySelector('.feedback')!.all().some((el) => el.textContent === CHOICE_SAMPLE.challenges[i].choices[0].feedback)).toBe(true);
      button(root, i === 2 ? '查看我的旅程' : '继续前行').click();
    }
    expect(root.all().some((el) => el.textContent === CHOICE_SAMPLE.endings.thoughtful)).toBe(true);
    expect(root.all().some((el) => el.textContent.includes('6 / 6 洞察点'))).toBe(true);
    button(root, '重新探索').click();
    for (let i = 0; i < 3; i++) { button(root, 'B /').click(); button(root, i === 2 ? '查看我的旅程' : '继续前行').click(); }
    expect(root.all().some((el) => el.textContent === CHOICE_SAMPLE.endings.exploratory)).toBe(true);
    expect(root.all().some((el) => el.textContent.includes('2 / 6 洞察点'))).toBe(true);
  });
});
