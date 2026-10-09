// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlaceholderPngBytes, MAX_TAVERN_FILE_BYTES, MAX_TAVERN_TEXT_BYTES, parseTavernCardFromPngBytes } from '@mahoshojo/domain/tavern-card';
import { TavernExportPanel } from '@/components/tavern/TavernExportPanel';

const mocks = vi.hoisted(() => ({
  download: vi.fn(), base: vi.fn(), startCooldown: vi.fn(), push: vi.fn(), tachieCallbacks: [] as Array<(url: string | null) => void>,
  user: { id: 7, username: '测试导出者' },
  cards: [
    { templateId: '通用角色', name: '角色 A', content: 'A 的设定', _cardId: 'a', _author: '作者 A' },
    { templateId: '通用角色', name: '角色 B', content: 'B 的设定', _cardId: 'b', _author: '作者 B' },
  ],
}));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => null }));
vi.mock('@/components/TachieGenerator', () => ({ default: ({ onImageUrlChange }: { onImageUrlChange: (url: string | null) => void }) => { mocks.tachieCallbacks.push(onImageUrlChange); return null; } }));
vi.mock('@/components/BattleDataModal', () => ({ default: ({ isOpen, selectedType, onSelectCard }: { isOpen: boolean; selectedType: string; onSelectCard?: (value: unknown) => void }) => isOpen && selectedType === 'character' ? <div>{mocks.cards.map((card) => <button key={card._cardId} onClick={() => onSelectCard?.(card)}>选择 {card.name}</button>)}</div> : null }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: mocks.user }) }));
vi.mock('@/lib/cooldown', () => ({ useCooldown: () => ({ isCooldown: false, remainingTime: 0, startCooldown: mocks.startCooldown }) }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getAuthHeader: async () => 'test-auth', getActivityHeaders: async () => ({}) } }));
vi.mock('@/lib/ai/custom-provider', () => ({ isUsingUserProvidedKey: () => false, buildCustomProviderRequestPayload: () => null }));
vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: mocks.download }));
vi.mock('@/lib/metrics/techIndex', () => ({ computeTechIndex: () => ({ techScore: 3, techLevel: '低' }) }));
vi.mock('@/lib/tavern-card', async () => {
  const shared = await import('@mahoshojo/domain/tavern-card');
  return { ...shared, getDefaultTavernBasePngBytes: mocks.base };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const jsonResponse = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as Response;
const metadata = (id: string) => ({ success: true, dataCardId: id, tags: [{ name: `云标签 ${id}` }], metrics: { techScore: 9, techLevel: '高', isNative: true }, ratings: { strict: null, free: null } });
const source = (name: string, content = `${name} 的设定`) => ({ templateId: '通用角色', name, content });
const buffer = (text: string) => new TextEncoder().encode(text).buffer;
const jsonFile = (value: unknown, name = 'source.json') => {
  const text = JSON.stringify(value);
  return { name, size: new TextEncoder().encode(text).length, text: vi.fn(async () => text), arrayBuffer: vi.fn(async () => buffer(text)) } as unknown as File;
};
const pngFile = (name: string, bytes = getPlaceholderPngBytes()) => ({ name, size: bytes.length, arrayBuffer: vi.fn(async () => bytes.slice().buffer) }) as unknown as File;
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
let mounted: boolean;
const button = (text: string) => {
  const found = [...container.querySelectorAll('button')].find((element) => element.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
};
const field = (name: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${name}"]`)!;
const checkbox = (text: string) => [...container.querySelectorAll('label')].find((label) => label.textContent?.includes(text))!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
async function click(text: string) { await act(async () => button(text).click()); }
async function upload(file: File, selector = '#tavern-export-card') {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function edit(name: string, value: string) {
  const input = field(name);
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
async function downloadedCard() {
  const bytes = new Uint8Array(await readBlob(mocks.download.mock.calls.at(-1)![0]));
  const parsed = parseTavernCardFromPngBytes(bytes);
  if ('code' in parsed) throw new Error(parsed.message);
  return parsed.selected.parsed as { data: { description: string; scenario: string; extensions: Record<string, unknown>; character_book: { entries: { content: string }[] } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tachieCallbacks.length = 0;
  mocks.base.mockImplementation(async () => getPlaceholderPngBytes());
  fetchMock = vi.fn(async (url: string) => url.startsWith('/api/data-card-meta') ? jsonResponse(metadata(new URL(url, 'https://test.invalid').searchParams.get('dataCardId')!)) : jsonResponse({ isValid: false }));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
  act(() => root.render(<TavernExportPanel />));
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Web TavernExportPanel 的共享导出和异步保护', () => {
  it('实际云选卡组件在 A 的元数据晚于 B 返回时仍保留 B', async () => {
    const oldMeta = deferred<Response>();
    fetchMock.mockImplementation(async (url: string) => url.includes('dataCardId=a') ? oldMeta.promise : jsonResponse(metadata('b')));
    await click('浏览在线角色库'); await click('选择 角色 A');
    expect(field('name').value).toBe('角色 A');
    await click('浏览在线角色库'); await click('选择 角色 B');
    await act(async () => oldMeta.resolve(jsonResponse(metadata('a'))));
    expect(field('name').value).toBe('角色 B');
    expect(field('description').value).toBe('B 的设定');
    expect(field('tags').value).toContain('云标签 b');
    expect(field('tags').value).not.toContain('云标签 a');
  });

  it('延迟元数据仅补充未编辑字段，保留用户改动且保留已核验来源', async () => {
    const meta = deferred<Response>();
    fetchMock.mockReturnValue(meta.promise);
    await click('浏览在线角色库'); await click('选择 角色 A');
    await edit('name', '手改名字'); await edit('tags', '手改标签'); await edit('creator', '手改作者');
    await act(async () => meta.resolve(jsonResponse(metadata('a'))));
    expect(field('name').value).toBe('手改名字');
    expect(field('tags').value).toBe('手改标签');
    expect(field('creator').value).toBe('手改作者');
    await click('生成并下载酒馆卡 PNG');
    const card = await downloadedCard();
    expect(card.data.extensions.ms_export).toMatchObject({ source: { dataCardId: 'a', metrics: { isNative: true, techScore: 9 } } });
  });

  it('较早的文件读取不能覆盖较新的文件选择', async () => {
    const bytes = deferred<ArrayBuffer>(); const text = deferred<string>();
    await upload({ name: 'old.json', size: 100, text: () => text.promise, arrayBuffer: () => bytes.promise } as File);
    await upload(jsonFile(source('新文件')));
    await act(async () => { text.resolve(JSON.stringify(source('旧文件'))); bytes.resolve(buffer(JSON.stringify(source('旧文件')))); });
    expect(field('name').value).toBe('新文件');
  });

  it('文件读取等待期间的字段编辑不会被晚到源覆盖', async () => {
    await upload(jsonFile(source('当前源')));
    const bytes = deferred<ArrayBuffer>(); const text = deferred<string>();
    await upload({ name: 'pending.json', size: 100, text: () => text.promise, arrayBuffer: () => bytes.promise } as File);
    await edit('description', '读取时仍在编辑');
    await act(async () => { text.resolve(JSON.stringify(source('晚到源'))); bytes.resolve(buffer(JSON.stringify(source('晚到源')))); });
    expect(field('name').value).toBe('当前源');
    expect(field('description').value).toBe('读取时仍在编辑');
  });

  it('随机角色请求启动时即占有选择顺序，不会在返回后重置到旧角色', async () => {
    const random = deferred<Response>();
    fetchMock.mockImplementation(async (url: string) => url.includes('random-public-card') ? random.promise : jsonResponse({ isValid: false }));
    await click('随机匹配角色');
    await upload(jsonFile(source('手选新源')));
    await act(async () => random.resolve(jsonResponse({ success: true, card: { id: 'a', name: '旧随机', type: 'character', data: JSON.stringify(source('旧随机')) } })));
    expect(field('name').value).toBe('手选新源');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('dataCardId=a'))).toBe(false);
  });

  it('AI pending 后的手动编辑取消请求；即使服务忽略 abort 也不覆盖字段', async () => {
    await upload(jsonFile(source('AI 测试')));
    const ai = deferred<Response>();
    fetchMock.mockReturnValue(ai.promise);
    await act(async () => checkbox('覆盖已填写的字段').click());
    await click('AI 生成');
    const signal = fetchMock.mock.calls.at(-1)![1].signal as AbortSignal;
    await edit('scenario', '用户新写场景');
    expect(signal.aborted).toBe(true);
    await act(async () => ai.resolve(jsonResponse({ scenario: '旧 AI 场景', first_mes: '旧开场白', mes_example: '旧示例' })));
    expect(field('scenario').value).toBe('用户新写场景');
    expect(field('first_mes').value).toBe('');
    expect(field('mes_example').value).toBe('');
    expect(mocks.startCooldown).not.toHaveBeenCalled();
  });

  it('AI 返回不能覆盖新源，且旧 finally 不能结束另一轮 AI', async () => {
    await upload(jsonFile(source('旧源')));
    const old = deferred<Response>(); const next = deferred<Response>();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/tavern/ai-fill' ? (String(init?.body).includes('旧源') ? old.promise : next.promise) : jsonResponse({ isValid: false }));
    await click('AI 生成'); await upload(jsonFile(source('新源'))); await click('AI 生成');
    await act(async () => old.resolve(jsonResponse({ scenario: '旧结果', first_mes: '旧结果' })));
    expect(field('scenario').value).toBe('');
    expect(button('AI 生成中…').disabled).toBe(true);
    await act(async () => next.resolve(jsonResponse({ scenario: '新结果', first_mes: '新开场', mes_example: '新示例' })));
    expect(field('scenario').value).toBe('新结果');
    expect(field('first_mes').value).toBe('新开场');
  });

  it.each(['AI 生成', '生成并下载酒馆卡 PNG'])('读取新源等待时对当前源执行 %s 会取消晚到替换', async (action) => {
    await upload(jsonFile(source('仍显示 B')));
    const pendingBytes = deferred<ArrayBuffer>();
    const pendingText = deferred<string>();
    await upload({ name: 'A.json', size: 100, text: () => pendingText.promise, arrayBuffer: () => pendingBytes.promise } as File);
    const ai = deferred<Response>();
    fetchMock.mockImplementation(async (url: string) => url === '/api/tavern/ai-fill' ? ai.promise : jsonResponse({ isValid: false }));
    await click(action);
    await act(async () => { pendingBytes.resolve(buffer(JSON.stringify(source('晚到 A')))); pendingText.resolve(JSON.stringify(source('晚到 A'))); });
    expect(field('name').value).toBe('仍显示 B');
    if (action === 'AI 生成') {
      await act(async () => ai.resolve(jsonResponse({ scenario: 'B 的 AI 场景' })));
      expect(field('scenario').value).toBe('B 的 AI 场景');
    } else {
      expect((await downloadedCard()).data.description).toBe('仍显示 B 的设定');
    }
  });

  it('卸载后忽略元数据和 AI 并中止 pending AI', async () => {
    const meta = deferred<Response>(); const ai = deferred<Response>();
    fetchMock.mockImplementation(async (url: string) => url === '/api/tavern/ai-fill' ? ai.promise : meta.promise);
    await click('浏览在线角色库'); await click('选择 角色 A'); await click('AI 生成');
    const signal = fetchMock.mock.calls.at(-1)![1].signal as AbortSignal;
    act(() => root.unmount()); mounted = false;
    expect(signal.aborted).toBe(true);
    await act(async () => { meta.resolve(jsonResponse(metadata('a'))); ai.resolve(jsonResponse({ scenario: '晚到 AI' })); });
    expect(mocks.startCooldown).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('JSON 的 4 MiB 与 PNG 的 32 MiB 预检发生在文件读取前', async () => {
    const largeJson = { name: 'huge.json', size: MAX_TAVERN_TEXT_BYTES + 1, text: vi.fn(), arrayBuffer: vi.fn() } as unknown as File;
    await upload(largeJson);
    expect(largeJson.text).not.toHaveBeenCalled(); expect(largeJson.arrayBuffer).not.toHaveBeenCalled();
    expect(container.textContent).toContain('4 MiB');
    await upload(jsonFile(source('可用源')));
    const largePng = { name: 'huge.png', size: MAX_TAVERN_FILE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as File;
    await upload(largePng, '#tavern-export-base');
    expect(largePng.arrayBuffer).not.toHaveBeenCalled(); expect(container.textContent).toContain('32 MiB');
    expect(field('name').value).toBe('可用源');
  });

  it('拒绝危险 JSON 键，仍保留当前可编辑源', async () => {
    await upload(jsonFile(source('已有源')));
    await upload(jsonFile(JSON.parse('{"name":"bad","__proto__":{"polluted":true}}')));
    expect(field('name').value).toBe('已有源');
    expect(container.textContent).toMatch(/安全|危险/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('新默认底图选择使旧文件读取失效，新上传也使旧默认加载失效', async () => {
    await upload(jsonFile(source('底图测试')));
    const uploadBytes = deferred<ArrayBuffer>();
    await upload({ name: '旧底图.png', size: 100, arrayBuffer: () => uploadBytes.promise } as File, '#tavern-export-base');
    await click('使用默认底图（Logo）');
    await act(async () => uploadBytes.resolve(getPlaceholderPngBytes().slice().buffer));
    expect(container.textContent).toContain('当前底图：mahoshojo-logo.png');
    const defaultBytes = deferred<Uint8Array>(); mocks.base.mockReturnValue(defaultBytes.promise);
    await click('使用默认底图（Logo）'); await upload(pngFile('新底图.png'), '#tavern-export-base');
    await act(async () => defaultBytes.resolve(getPlaceholderPngBytes()));
    expect(container.textContent).toContain('当前底图：新底图.png');
  });

  it('导出当前底图后忽略较早仍未读完的新底图', async () => {
    await upload(jsonFile(source('底图快照')));
    await upload(pngFile('当前底图.png'), '#tavern-export-base');
    const pending = deferred<ArrayBuffer>();
    await upload({ name: '晚到.png', size: 100, arrayBuffer: () => pending.promise } as File, '#tavern-export-base');
    await click('生成并下载酒馆卡 PNG');
    await act(async () => pending.resolve(getPlaceholderPngBytes().slice().buffer));
    expect(container.textContent).toContain('当前底图：当前底图.png');
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it('新来源不会接受旧立绘组件晚到的图片地址', async () => {
    await upload(jsonFile(source('旧立绘源')));
    const oldImageResult = mocks.tachieCallbacks.at(-1)!;
    await upload(jsonFile(source('新立绘源')));
    await act(async () => oldImageResult('https://images.invalid/old.png'));
    expect(container.textContent).toContain('尚未生成立绘或未通过审核');
    expect(button('一键设为底图').disabled).toBe(true);
  });

  it('向宿主页报告 AI 忙碌，取消后恢复切换能力', async () => {
    const busy = vi.fn();
    act(() => root.render(<TavernExportPanel onBusyChange={busy} />));
    await upload(jsonFile(source('忙碌报告')));
    const ai = deferred<Response>(); fetchMock.mockReturnValue(ai.promise);
    await click('AI 生成'); expect(busy).toHaveBeenLastCalledWith(true);
    await edit('scenario', '用户接管'); expect(busy).toHaveBeenLastCalledWith(false);
    await act(async () => ai.resolve(jsonResponse({ scenario: '过时' })));
    expect(field('scenario').value).toBe('用户接管');
  });

  it('拒绝伪 PNG，不破坏已有底图，也不允许两个 chunk 全关', async () => {
    await upload(jsonFile(source('结构测试')));
    await upload(pngFile('valid.png'), '#tavern-export-base');
    await upload(pngFile('fake.png', new Uint8Array([1, 2, 3])), '#tavern-export-base');
    expect(container.textContent).toContain('当前底图：valid.png');
    await act(async () => checkbox('写入 ccv3').click());
    await act(async () => checkbox('写入 chara').click());
    expect(checkbox('写入 ccv3').checked || checkbox('写入 chara').checked).toBe(true);
  });

  it('来源快照截断明确提示，主正文及完整源 JSON 不丢未知字段', async () => {
    const original = { ...source('长正文', '长'.repeat(26_000)), custom: { untouched: ['未知', 42] } };
    await upload(jsonFile(original));
    expect(container.textContent).toContain('sourceDataJson 已截断到 24000');
    expect(field('description').value).toBe(original.content);
    await click('下载完整源 JSON（保留未映射字段）');
    const saved = JSON.parse(new TextDecoder().decode(await readBlob(mocks.download.mock.calls.at(-1)![0])));
    expect(saved).toEqual(original);
    expect(mocks.download.mock.calls.at(-1)![1]).toMatch(/\.json$/);
    await click('生成并下载酒馆卡 PNG');
    const card = await downloadedCard(); expect(card.data.description).toBe(original.content);
    await act(async () => checkbox('附带来源诊断快照').click());
    expect(container.textContent).not.toContain('sourceDataJson 已截断到');
    await click('生成并下载酒馆卡 PNG');
    expect((await downloadedCard()).data.extensions.ms_export).not.toHaveProperty('sourceDataJson');
  });

  it('附加情景的世界书截断到 6000 会提示，场景主正文保持完整', async () => {
    await upload(jsonFile(source('情景测试')));
    const content = '场'.repeat(7_000);
    await upload(jsonFile({ templateId: '通用情景', title: '长情景', content }), 'input[type="file"][multiple]');
    expect(container.textContent).toContain('世界书条目已截断到 6000');
    await click('生成并下载酒馆卡 PNG');
    const card = await downloadedCard(); expect(card.data.scenario).toContain(content);
    expect(card.data.character_book.entries.some((entry) => entry.content.includes('...[已截断]'))).toBe(true);
  });

  it('最终 JSON 超出 4 MiB 时显式阻止 PNG，不会自动砍掉正文', async () => {
    const content = '大'.repeat(720_000);
    await upload(jsonFile(source('超限输出', content)));
    expect(field('description').value).toBe(content);
    expect(container.textContent).toContain('4 MiB');
    expect(button('生成并下载酒馆卡 PNG').disabled).toBe(true);
    expect(mocks.download).not.toHaveBeenCalled();
    await edit('description', '缩短后可导出');
    expect(button('生成并下载酒馆卡 PNG').disabled).toBe(false);
  });

  it('默认底图加载失败后恢复可重试状态，不锁住生成按钮', async () => {
    await upload(jsonFile(source('可重试')));
    mocks.base.mockRejectedValueOnce(new Error('底图失败'));
    await click('生成并下载酒馆卡 PNG');
    expect(container.textContent).toContain('底图失败'); expect(button('生成并下载酒馆卡 PNG').disabled).toBe(false);
    await click('生成并下载酒馆卡 PNG'); expect(mocks.download).toHaveBeenCalledTimes(1);
  });
});
