// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaReportFormatSelector, ArenaWebReport } from '@/components/arena/components/ArenaWebReport';
import { SoloArenaWebPackageSection } from '@/components/arena/editor/features/web-package/SoloArenaWebPackageSection';
import { downloadBlob } from '@/lib/client/blobUrl';
import { BattleResultPresentation } from '@/components/arena/components/BattleResultPresentation';
import { BaseModal } from '@/components/shared/BaseModal';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  clearLocalWebPackageSessionStaging,
  createWebPackageOverlay,
  resolveWebPackage,
  stageLocalWebPackage,
  verifyWebPackage,
} from '@mahoshojo/web-package';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: vi.fn() }));
vi.mock('@/components/shared/GeneratedByUserBadge', () => ({ GeneratedByUserBadge: () => null }));

const source = '<!doctype html><html><body><button onclick="this.textContent=123">互动</button></body></html>';
const sourceWithNotes = [
  '下面是本场特别战报。',
  '',
  source,
  '',
  '希望你喜欢这场战斗。',
  '<!-- MAHOSHOJO_ARENA_META {"version":1} -->',
].join('\n');
let container: HTMLDivElement;
let root: Root;
const click = async (text: string) => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
};
const viewer = (roomId: string, ready = true, content = source) => (
  <ArenaWebReport key={roomId} roomId={roomId} ready={ready} content={content}>
    {(web, actions) => <section>
      {web ?? <div data-testid="ordinary">{content}</div>}
      <div className="buttons-container">{actions}</div>
    </section>}
  </ArenaWebReport>
);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  clearLocalWebPackageSessionStaging();
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  useBattleStore.setState({ webPackageRef: null, isGenerating: false }, true);
});

const buildLocalPackage = async (version: string, id = 'local.ui-replay-package') => {
  const builtin = await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
  const manifest = {
    ...builtin.manifest,
    id,
    version,
    name: `UI 重放包 ${version}`,
  };
  return verifyWebPackage(manifest, manifest.files.map((file) => ({
    path: file.path,
    bytes: builtin.readFile(file.path)!,
  })));
};

describe('Web 战报的本地执行许可', () => {
  it('offers the first-party experience in a labelled native selector and disables it while generating', async () => {
    await act(async () => root.render(
      <ArenaReportFormatSelector value="web" onChange={() => {}}>
        <SoloArenaWebPackageSection reportFormat="web" />
      </ArenaReportFormatSelector>,
    ));
    const select = container.querySelector('[data-testid="arena-web-package-select"]')!;
    expect(select.getAttribute('aria-label')).toBe('选择 Web 包');
    expect(container.querySelector('[data-testid="arena-web-package-section"]')?.textContent).toContain('Web 包');
    await act(async () => {
      select.value = BUILTIN_VISUAL_NOVEL_PACKAGE_REF.digest;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useBattleStore.getState().webPackageRef).toEqual(BUILTIN_VISUAL_NOVEL_PACKAGE_REF);
    await click('下载 Web 包 ZIP');
    await vi.waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'mahoshojo.visual-novel-lite@1.0.0.zip');
    });
    await act(async () => root.render(
      <ArenaReportFormatSelector value="web" onChange={() => {}} disabled>
        <SoloArenaWebPackageSection reportFormat="web" disabled />
      </ArenaReportFormatSelector>,
    ));
    expect(container.querySelector('[data-testid="arena-web-package-select"]')!.disabled).toBe(true);
  });

  it('validates a package before consent, keeps JSON fallback inert, and exports a self-contained experience', async () => {
    const content = JSON.stringify({ title: '包故事', scenes: [{ text: '<script>unsafe()</script>' }] });
    const { generatedContent: _content, ...artifact } = await createWebPackageOverlay(BUILTIN_VISUAL_NOVEL_PACKAGE_REF, content);
    expect(_content).toBe(content);
    const render = (ready: boolean, override = artifact) => <ArenaWebReport key="package-consent" roomId="package-consent" ready={ready} content={content} webPackage={override}>
      {(web, actions) => <section>{web}<div>{actions}</div></section>}
    </ArenaWebReport>;
    await act(async () => root.render(render(false)));
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain('<script>unsafe()</script>');
    expect(container.querySelector('script')).toBeNull();
    await act(async () => root.render(render(true)));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.body.textContent).toContain('启用 Web 战报');
    });
    expect(container.querySelector('iframe')).toBeNull();
    await click('继续使用 Web');
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.srcdoc).toContain('包故事');
    expect(frame.srcdoc).not.toContain('<script>unsafe()</script>');
    await click('🌐 下载 HTML');
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.html$/));
    await act(async () => root.render(render(true, { ...artifact, generatedDigest: `sha256:${'0'.repeat(64)}` })));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain('digest 校验失败');
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain('unsafe()');
    expect(container.textContent).toContain('重新导入本地 Web 包');
    expect(container.textContent).not.toContain('仍尝试使用此 Web 包');
  });

  it('缺失历史 Web 包时展示安全回退与重导入入口，不提供兼容重放', async () => {
    const content = JSON.stringify({ title: '缺失包故事', scenes: [{ text: '第一幕' }] });
    clearLocalWebPackageSessionStaging();
    const local = await buildLocalPackage('1.0.0');
    stageLocalWebPackage(local);
    const { generatedContent: _generated, ...artifact } = await createWebPackageOverlay(local.ref, content);
    expect(_generated).toBe(content);
    clearLocalWebPackageSessionStaging();
    window.localStorage.setItem('arena.web-report-consent.v1.room.missing-package', 'accepted');

    await act(async () => root.render(
      <ArenaWebReport key="missing-package" roomId="missing-package" ready content={content} webPackage={artifact}>
        {(web, actions) => <section>{web}<div>{actions}</div></section>}
      </ArenaWebReport>,
    ));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain('重新导入本地 Web 包');
    });
    expect(container.textContent).not.toContain('仍尝试使用此 Web 包');
    expect(container.textContent).not.toContain('不同版本的 Web 包');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain('缺失包故事');
  });

  it('同 id 不同版本需显式选择兼容重放并展示不一致警告', async () => {
    const content = JSON.stringify({ title: '兼容重放故事', scenes: [{ text: '第一幕' }] });
    clearLocalWebPackageSessionStaging();
    // 历史 revision 是内置 id 的本地版本；清空 staging 后候选回落到 builtin，可走 srcdoc 而无需 Service Worker。
    const historical = await buildLocalPackage('0.9.0', BUILTIN_VISUAL_NOVEL_PACKAGE_REF.id);
    stageLocalWebPackage(historical);
    const { generatedContent: _generated, ...artifact } = await createWebPackageOverlay(historical.ref, content);
    expect(_generated).toBe(content);
    clearLocalWebPackageSessionStaging();
    window.localStorage.setItem('arena.web-report-consent.v1.room.mismatch-choice', 'accepted');

    await act(async () => root.render(
      <ArenaWebReport key="mismatch-choice" roomId="mismatch-choice" ready content={content} webPackage={artifact}>
        {(web, actions) => <section>{web}<div>{actions}</div></section>}
      </ArenaWebReport>,
    ));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain('仍尝试使用此 Web 包');
    });
    expect(container.textContent).toContain('重新导入本地 Web 包');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).not.toContain('不同版本的 Web 包');
    expect(artifact.packageRef).toEqual(historical.ref);

    await click('仍尝试使用此 Web 包');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain('当前使用的是不同版本的 Web 包，效果可能与生成时不一致。');
    });
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(container.querySelector('iframe')!.srcdoc).toContain('兼容重放故事');
    expect(container.textContent).not.toContain('仍尝试使用此 Web 包');
    expect(artifact.packageRef).toEqual(historical.ref);
  });

  it.each([
    { aiModel: 'deepseek-v4-flash-0731', aiUsage: { promptTokens: 12833, reasoningTokens: 7981, completionTokens: 14315 }, expected: '模型：deepseek-v4-flash-0731 · tokens：输入 12,833｜推理 7,981｜输出 14,315' },
    { aiModel: null, aiUsage: { promptTokens: 0, completionTokens: 1234567890 }, expected: 'tokens：输入 0｜推理 -｜输出 1,234,567,890' },
    { aiModel: '  very-long-model-name-'.repeat(8).trim(), aiUsage: null, expected: `模型：${'  very-long-model-name-'.repeat(8).trim()}` },
    { aiModel: '  ', aiUsage: { promptTokens: null, reasoningTokens: NaN, completionTokens: Infinity }, expected: '' },
    { aiModel: undefined, aiUsage: undefined, expected: '' },
    { aiModel: 'zero-model', aiUsage: { promptTokens: 0, reasoningTokens: 0, completionTokens: 0 }, expected: '模型：zero-model · tokens：输入 0｜推理 0｜输出 0' },
  ])('真实卡片把模型与用量只展示在 Web header：$expected', async ({ aiModel, aiUsage, expected }) => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.metadata', 'accepted');
    for (const format of ['stream-web', 'web-document'] as const) {
      await act(async () => root.render(<BattleResultPresentation report={{
        format, content: sourceWithNotes, webReady: true, webConsentScope: 'metadata', aiModel, aiUsage,
        scenarioName: '场景.json', mode: 'daily', reporterInfo: { name: '记者甲', publication: '日报' },
        narrativeHistoryReadCount: 0, userGuidance: '引导内容', cardWidthPx: 900,
      }} />));
      const header = container.querySelector('[data-testid="arena-web-header"]')!;
      const frame = container.querySelector('iframe')!;
      const card = container.querySelector<HTMLElement>('.result-card')!;
      expect(header.textContent).toBe(`${expected}沉浸体验`);
      expect(card.querySelectorAll('img[src="/arena-white.svg"]')).toHaveLength(1);
      expect(card.style.padding).toBe('0px');
      expect(card.style.maxWidth).toBe('900px');
      const details = card.querySelector('h3')!.parentElement!;
      expect(frame.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(details.textContent).toContain('叙事历史读取：0 条');
      expect(details.textContent).toContain('记者甲');
      expect(details.textContent).toContain('引导内容');
      expect(details.querySelector('img[alt="日常模式 ☕"]')).toBeTruthy();
      expect(details.textContent).not.toContain('模型：');
      expect(details.textContent).not.toContain('tokens：');
    }
  });

  it('空闲三秒收起；触摸展开后继续计时，鼠标悬停及键盘焦点暂停，iframe 始终不变', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('arena.web-report-consent.v1.room.auto-hide', 'accepted');
    await act(async () => root.render(viewer('auto-hide')));
    const header = container.querySelector<HTMLElement>('[data-testid="arena-web-header"]')!;
    const controls = header.firstElementChild!;
    const frame = container.querySelector('iframe')!;
    const expand = container.querySelector<HTMLButtonElement>('[aria-label="展开 Web 战报工具栏"]')!;
    const advance = async (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
    const pointer = async (type: string, pointerType: string) => act(async () => {
      const event = new MouseEvent(type, { bubbles: true, relatedTarget: document.body });
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      controls.dispatchEvent(event);
    });
    const touchExpand = async () => act(async () => {
      expand.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    await advance(2999);
    expect(header.getAttribute('aria-hidden')).toBe('false');
    await advance(1);
    expect(header.getAttribute('aria-hidden')).toBe('true');
    expect(header.hasAttribute('inert')).toBe(true);
    expect(expand.hidden).toBe(false);

    await touchExpand();
    await pointer('pointerover', 'touch');
    await advance(3000);
    expect(header.hasAttribute('inert')).toBe(true);

    await touchExpand();
    await pointer('pointerover', 'mouse');
    await advance(5000);
    expect(header.hasAttribute('inert')).toBe(false);
    await pointer('pointerout', 'mouse');
    await advance(2999);
    expect(header.hasAttribute('inert')).toBe(false);
    await advance(1);
    expect(header.hasAttribute('inert')).toBe(true);

    await act(async () => expand.click()); // 键盘/辅助技术触发的 click detail 为 0。
    expect(document.activeElement).toBe(header.querySelector('button'));
    await advance(5000);
    expect(header.hasAttribute('inert')).toBe(false);
    await act(async () => frame.focus());
    await advance(3000);
    expect(header.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('iframe')).toBe(frame);
  });

  it('切换作品和进出沉浸会重新展开并计时；退出 Web 或卸载清理计时器', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('arena.web-report-consent.v1.room.timer-lifecycle', 'accepted');
    await act(async () => root.render(viewer('timer-lifecycle')));
    const header = container.querySelector('[data-testid="arena-web-header"]')!;
    const frame = container.querySelector('iframe')!;
    const advance = async () => act(async () => { vi.advanceTimersByTime(3000); });
    await advance();
    expect(header.hasAttribute('inert')).toBe(true);
    await act(async () => root.render(viewer('timer-lifecycle', true, source.replace('互动', '另一作品'))));
    expect(header.hasAttribute('inert')).toBe(false);
    await advance();
    expect(header.hasAttribute('inert')).toBe(true);
    for (const label of ['沉浸体验', '退出沉浸']) {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开 Web 战报工具栏"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
      await click(label);
      expect(header.hasAttribute('inert')).toBe(false);
      await advance();
      expect(header.hasAttribute('inert')).toBe(true);
      expect(container.querySelector('iframe')).toBe(frame);
    }
    await click('普通显示');
    expect(vi.getTimerCount()).toBe(0);
    await click('Web 显示');
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Web 与普通显示的操作均位于真实战报卡片的同一个底部操作栏', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.card-actions', 'accepted');
    await act(async () => root.render(<BattleResultPresentation
      report={{ format: 'stream-web', content: source, webReady: true, webConsentScope: 'card-actions' }}
      onSaveImage={vi.fn()}
    />));
    const frame = container.querySelector('iframe')!;
    const toolbar = container.querySelector('.buttons-container')!;
    expect(toolbar.closest('.result-card')?.contains(frame)).toBe(true);
    expect(toolbar.textContent).toContain('重新加载');
    expect(toolbar.textContent).toContain('下载 HTML');
    expect(toolbar.textContent).not.toContain('保存为图片');
    expect(toolbar.textContent).not.toContain('下载记录');
    expect(toolbar.textContent).not.toContain('沉浸');
    await click('普通显示');
    expect(container.querySelectorAll('.buttons-container')).toHaveLength(1);
    expect(toolbar.isConnected).toBe(true);
    expect(toolbar.textContent).toContain('保存为图片');
    expect(toolbar.textContent).toContain('下载记录');
    expect(toolbar.textContent).toContain('下载 HTML');
    expect(toolbar.textContent).not.toContain('重新加载');
  });

  it('仅完整战报可下载 HTML；取消执行后仍可下载，保留脚本并移除机器 meta', async () => {
    const content = `${source}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"winner":"甲"}} -->`;
    await act(async () => root.render(viewer('download', false, content)));
    await click('🌐 下载 HTML');
    expect(downloadBlob).not.toHaveBeenCalled();
    await act(async () => root.render(viewer('download', true, content)));
    await click('取消');
    expect(container.querySelector('legend')?.textContent).toBe('显示方式');
    expect(container.querySelector('[data-testid="ordinary"]')?.nextElementSibling?.classList.contains('buttons-container')).toBe(true);
    expect(container.textContent).toContain('不再受本站沙箱保护');
    await click('🌐 下载 HTML');
    expect(document.querySelector('iframe')).toBeNull();
    expect(downloadBlob).toHaveBeenCalledOnce();
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(filename).toMatch(/^魔法少女速报_Web战报_\d{4}-\d{2}-\d{2}_\d{4}\.html$/);
    const downloaded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(downloaded).toBe(source);
    await click('Web 显示');
    await click('继续使用 Web');
    await click('🌐 下载 HTML');
    expect(downloadBlob).toHaveBeenCalledTimes(2);
    expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    await act(async () => root.render(viewer('download', false, content)));
    await click('🌐 下载 HTML');
    expect(downloadBlob).toHaveBeenCalledTimes(2);
  });

  it('下载 HTML 使用上游 displayTitle，并保留 Unicode 标题', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.download-title', 'accepted');
    await act(async () => root.render(
      <ArenaWebReport key="download-title" roomId="download-title" ready content={source} displayTitle="月下决战：白百合与黑曜">
        {(web, actions) => <section>
          {web ?? <div data-testid="ordinary">{source}</div>}
          <div className="buttons-container">{actions}</div>
        </section>}
      </ArenaWebReport>
    ));
    await click('🌐 下载 HTML');
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('魔法少女速报_月下决战：白百合与黑曜.html');
  });

  it('缺省 displayTitle 时按静态 <title> 命名下载文件', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.title-fallback', 'accepted');
    const titled = '<!doctype html><html><head><title>月下决战：白百合与黑曜</title></head><body>x</body></html>';
    await act(async () => root.render(viewer('title-fallback', true, titled)));
    await click('🌐 下载 HTML');
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('魔法少女速报_月下决战：白百合与黑曜.html');
  });

  it('BattleResultPresentation 用 headline 解析出的显示标题命名下载文件', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.presentation-title', 'accepted');
    await act(async () => root.render(
      <BattleResultPresentation report={{
        format: 'stream-web',
        content: source,
        webReady: true,
        webConsentScope: 'presentation-title',
        headline: '月下决战',
        scenarioName: '雨夜车站',
      }} />
    ));
    await click('🌐 下载 HTML');
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('魔法少女速报_月下决战.html');
  });

  it('预览附加滚动条样式而下载保留 canonical HTML，前后附言默认折叠但可展开', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.notes', 'accepted');
    await act(async () => root.render(viewer('notes', true, sourceWithNotes)));

    const frame = document.querySelector('iframe')!;
    expect(frame.srcdoc.startsWith(source)).toBe(true);
    const previewDocument = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
    expect(previewDocument.querySelectorAll('style[data-arena-web-scrollbars]')).toHaveLength(1);
    expect(previewDocument.querySelector('button')?.getAttribute('onclick')).toBe('this.textContent=123');
    expect(frame.srcdoc).not.toContain('下面是本场特别战报');
    expect(frame.srcdoc).not.toContain('MAHOSHOJO_ARENA_META');

    const notes = container.querySelector('[data-testid="arena-web-notes"]')!;
    expect(notes.textContent).toContain('AI 附言（2 段）');
    expect(notes.textContent).not.toContain('下面是本场特别战报');
    await act(async () => (notes.querySelector('button') as HTMLButtonElement).click());
    expect(notes.textContent).toContain('下面是本场特别战报');
    expect(notes.textContent).toContain('希望你喜欢这场战斗');

    await click('🌐 下载 HTML');
    const [blob] = vi.mocked(downloadBlob).mock.calls[0];
    const downloaded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(downloaded).toBe(source);
  });

  it('沉浸显示保持同一个 iframe，并在原生全屏不可用时保留 CSS fallback', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.immersive', 'accepted');
    await act(async () => root.render(viewer('immersive', true, source)));

    const originalFrame = document.querySelector('iframe');
    expect(originalFrame).toBeTruthy();
    await click('沉浸体验');
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeTruthy();
    expect(document.querySelector('iframe')).toBe(originalFrame);
    expect(document.querySelector('iframe')?.getAttribute('allow')).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(container.querySelector('.buttons-container')?.textContent).toBe('');

    await click('退出沉浸');
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeNull();
    expect(document.querySelector('iframe')).toBe(originalFrame);
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
    expect(container.querySelector('[data-testid="arena-web-header"]')?.textContent).toContain('沉浸体验');
  });

  it('CSS 沉浸 fallback 可通过 Escape 退出', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.immersive-escape', 'accepted');
    await act(async () => root.render(viewer('immersive-escape', true, source)));
    await click('沉浸体验');
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('原生全屏只提升作品容器，保留 iframe 和 srcdoc；失败时仍锁定宿主页并可退出', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.native-immersive', 'accepted');
    await act(async () => root.render(viewer('native-immersive')));
    const frame = container.querySelector('iframe')!;
    const originalSrcDoc = frame.srcdoc;
    const webViewer = frame.parentElement!;
    const requestFullscreen = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Unavailable'));
    Object.defineProperty(webViewer, 'requestFullscreen', { configurable: true, value: requestFullscreen });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await click('沉浸体验');
      expect(requestFullscreen.mock.contexts[attempt]).toBe(webViewer);
      expect(container.querySelector('[data-testid="arena-web-immersive"]')).toBe(webViewer);
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(container.querySelector('iframe')).toBe(frame);
      expect(frame.srcdoc).toBe(originalSrcDoc);
      await click('退出沉浸');
      expect(document.documentElement.style.overflow).toBe('');
      expect(document.body.style.overflow).toBe('');
    }
  });

  it('历史弹窗中的 Escape 只退出沉浸，保留外层弹窗、iframe 和附言展开状态', async () => {
    const close = vi.fn();
    window.localStorage.setItem('arena.web-report-consent.v1.room.history-modal', 'accepted');
    await act(async () => root.render(<BaseModal isOpen title="历史战报" onClose={close}>
      {viewer('history-modal', true, sourceWithNotes)}
    </BaseModal>));
    const frame = document.querySelector('iframe');
    const notes = document.querySelector('[data-testid="arena-web-notes"]')!;
    await act(async () => notes.querySelector<HTMLButtonElement>('button')!.click());
    await click('沉浸体验');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeNull();
    expect(document.querySelector('iframe')).toBe(frame);
    expect(notes.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    expect(notes.textContent).toContain('希望你喜欢这场战斗');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('战报离开可执行状态时会自动退出沉浸并恢复页面滚动', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.lifecycle', 'accepted');
    await act(async () => root.render(viewer('lifecycle', true, source)));
    await click('沉浸体验');
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeTruthy();

    await act(async () => root.render(viewer('lifecycle', false, source)));
    expect(document.querySelector('[data-testid="arena-web-immersive"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('生成期间禁用格式切换，不打开确认也不更改格式', async () => {
    const change = vi.fn();
    await act(async () => root.render(<ArenaReportFormatSelector value="markdown" onChange={change} disabled roomId="disabled-selector" />));
    await click('Web（实验性）');
    await click('Markdown');
    expect(change).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('Markdown');
  });

  it('选择 Web 可取消；确认与不再提示仅保存浏览器本地', async () => {
    const change = vi.fn();
    await act(async () => root.render(<ArenaReportFormatSelector value="markdown" onChange={change} roomId="selector" />));
    await click('Web（实验性）');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('第三方');
    expect(change).not.toHaveBeenCalled();
    await click('取消');
    expect(change).not.toHaveBeenCalled();
    await click('Web（实验性）');
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await click('继续使用 Web');
    expect(change).toHaveBeenCalledWith('web');
    expect(window.localStorage.getItem('arena.web-report-consent.v1.room.selector')).toBe('accepted');
    expect(window.localStorage.getItem('arena.web-report-consent.v1')).toBeNull();
  });

  it('未完成时不确认、不挂载；完成并确认后只用 allow-scripts，移除机器 meta', async () => {
    const content = `${source}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"winner":"甲"}} -->`;
    await act(async () => root.render(viewer('final-only', false, content)));
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.render(viewer('final-only', true, content)));
    expect(document.querySelector('iframe')).toBeNull();
    await click('继续使用 Web');
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.srcdoc.startsWith(source)).toBe(true);
    expect(frame.srcdoc).not.toContain('MAHOSHOJO_ARENA_META');
    expect(window.localStorage.length).toBe(0);
    await click('普通显示');
    expect(document.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[data-testid="ordinary"]')).toBeTruthy();
    await click('Web 显示');
    expect(document.querySelector('iframe')).toBeTruthy();
    const oldFrame = document.querySelector('iframe');
    expect(container.querySelector('.buttons-container')?.textContent).toContain('↻ 重新加载');
    await click('↻ 重新加载');
    expect(document.querySelector('iframe')).not.toBe(oldFrame);
    await act(async () => root.render(viewer('final-only', false, content)));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('单人记忆不授权房间；拒绝可再次确认；房间之间隔离', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1', 'accepted');
    await act(async () => root.render(viewer('isolated-a')));
    expect(document.querySelector('iframe')).toBeNull();
    await click('取消');
    expect(container.querySelector('[data-testid="ordinary"]')).toBeTruthy();
    await click('Web 显示');
    await click('继续使用 Web');
    expect(document.querySelector('iframe')).toBeTruthy();
    await act(async () => root.render(viewer('isolated-b')));
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('已记忆的房间许可仍不能执行 incomplete 文档', async () => {
    window.localStorage.setItem('arena.web-report-consent.v1.room.remembered', 'accepted');
    await act(async () => root.render(viewer('remembered', false)));
    expect(document.querySelector('iframe')).toBeNull();
    await act(async () => root.render(viewer('remembered')));
    expect(document.querySelector('iframe')?.srcdoc.startsWith(source)).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('完整但不含 HTML 的输出不会请求 Web 执行许可', async () => {
    await act(async () => root.render(viewer('malformed-ready', true, '这是一段普通说明。')));

    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="ordinary"]')).toBeTruthy();
    expect(container.textContent).toContain('没有包含完整的 HTML 文档');

    await click('Web 显示');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('localStorage 不可用时仍能在当前页面确认', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await act(async () => root.render(viewer('storage-blocked')));
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await click('继续使用 Web');
    expect(document.querySelector('iframe')).toBeTruthy();
  });
});
