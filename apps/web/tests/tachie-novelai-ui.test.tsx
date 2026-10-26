// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TachieGenerator from '@/components/TachieGenerator';
import AiProviderSelector from '@/components/AiProviderSelector';
import { AI_PROVIDER_CONFIG_CHANGED } from '@/lib/ai/use-inherited-provider-config';
import { BattleIllustrationPanel } from '@/components/arena/components/BattleIllustrationPanel';
import { NOVELAI_TEXT_PROVIDERS } from '@/lib/tachie/novelai-prompt';
import * as promptRewriter from '@/lib/tachie/novelai-prompt';

let root: Root;
let container: HTMLDivElement;
const button = (text: string) => Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.includes(text))!;
const setInput = async (label: string, value: string) => {
  const target = Array.from(container.querySelectorAll('label')).find((node) => node.textContent === label)!;
  const input = document.getElementById(target.htmlFor) as HTMLInputElement;
  await act(async () => {
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
beforeEach(async () => {
  localStorage.clear();
  // NovelAI uses a separate storage key from other image providers.
  localStorage.setItem('tachie_remember', 'true');
  localStorage.setItem('tachie_credentials', JSON.stringify({ source: 'modelscope', modelscopeToken: 'old-token' }));
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals(); localStorage.clear();
});

it('选择直连来源、生成、防重复点击、下载及回调，Token 单独保存到本地存储', async () => {
  let resolve!: (value: Response) => void;
  const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
  vi.stubGlobal('fetch', fetchMock);
  const onImageUrlChange = vi.fn(); const onResult = vi.fn();
  await act(async () => root.render(<TachieGenerator prompt="1girl" onImageUrlChange={onImageUrlChange} onResult={onResult} />));
  await act(async () => button('NovelAI').click());
  expect(button('使用 NovelAI').disabled).toBe(true);
  await setInput('NovelAI Persistent API Token', 'private-token');
  await setInput('提示词', '1girl');
  await act(async () => { button('使用 NovelAI').click(); button('使用 NovelAI').click(); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector('fieldset')!.disabled).toBe(true);
  expect(localStorage.getItem('tachie_credentials')).not.toContain('private-token');
  expect(localStorage.getItem('tachie_novelai_token')).toBe('private-token');
  await act(async () => resolve(new Response(JSON.stringify({ images: [{ image: 'iVBORw0KGgo=', seed: 0 }] }), { headers: { 'Content-Type': 'application/json' } })));
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ success: true, seed: 0 }));
  expect(onImageUrlChange).toHaveBeenLastCalledWith('data:image/png;base64,iVBORw0KGgo=');
  expect(container.querySelector('a[download]')?.getAttribute('download')).toBe('novelai-0.png');
  expect(container.textContent).toContain('种子值: 0');
});

it('取消等待传递 AbortSignal，恢复按钮且不重发请求', async () => {
  const fetchMock = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<TachieGenerator prompt="1girl" />));
  await act(async () => button('NovelAI').click());
  await setInput('NovelAI Persistent API Token', 'token');
  if (!container.querySelector<HTMLTextAreaElement>('textarea')!.value) await setInput('提示词', '1girl');
  await act(async () => button('使用 NovelAI').click());
  await act(async () => button('停止等待').click());
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('已停止等待');
  expect(container.textContent).toContain('计费');
  expect(button('使用 NovelAI').disabled).toBe(false);
});

it('同 owner 编辑提示词后恢复原任务，保留原请求与首次提交的结果回调', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: { generateUuid: 'original-task' } }))
    .mockRejectedValueOnce(new Error('查询暂时断开'))
    .mockResolvedValueOnce(Response.json({ taskStatus: 'SUCCEED', outputImages: ['https://example.test/original.png'] }));
  vi.stubGlobal('fetch', fetchMock);
  const originalResult = vi.fn(); const editedResult = vi.fn();
  const originalImage = vi.fn(); const editedImage = vi.fn();
  await act(async () => root.render(<TachieGenerator ownerKey="same-role" prompt="提交时的提示词"
    onResult={originalResult} onImageUrlChange={originalImage} />));
  await act(async () => button('使用 ModelScope').click());
  expect(originalResult).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'unresolved', generateUuid: 'original-task' }));
  await act(async () => root.render(<TachieGenerator ownerKey="same-role" prompt="下次生成的新提示词"
    onResult={editedResult} onImageUrlChange={editedImage} />));
  await act(async () => button('继续查询原任务').click());
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/tachie/generate', '/api/tachie/status', '/api/tachie/status']);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ prompt: '提交时的提示词' });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ generateUuid: 'original-task' });
  expect(originalResult).toHaveBeenLastCalledWith(expect.objectContaining({
    success: true, prompt: '提交时的提示词', imageUrl: 'https://example.test/original.png',
  }));
  expect(originalImage).toHaveBeenLastCalledWith('https://example.test/original.png');
  expect(editedResult).not.toHaveBeenCalled(); expect(editedImage).not.toHaveBeenCalled();
});

it.each([
  ['928x1664', '928x1664'], [' 928x1664 ', '1328x1328'], [928, '1328x1328'],
])('ModelScope 恢复尺寸严格匹配，生成期间尺寸禁用：%j', async (modelscopeSize, expectedSize) => {
  localStorage.setItem('tachie_credentials', JSON.stringify({
    source: 'modelscope', modelscopeToken: 'old-token', modelscopeSize, modelscopeModel: ' custom/saved ',
  }));
  const fetchMock = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<TachieGenerator prompt="角色外观" />));
  const size = container.querySelector<HTMLSelectElement>('#modelscopeSize')!;
  expect(size.value).toBe(expectedSize);
  expect([...size.options].map(option => option.text)).toEqual([
    '16:9 竖屏（928×1664）', '16:9 横屏（1664×928）', '正方形（1328×1328）',
    '4:3 竖屏（1104×1472）', '4:3 横屏（1472×1104）',
  ]);
  expect(size.disabled).toBe(false);
  await act(async () => button('使用 ModelScope').click());
  expect(size.disabled).toBe(true);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    modelscopeModel: 'custom/saved', modelscopeSize: expectedSize,
  });
  await act(async () => button('停止等待').click());
  expect(size.disabled).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('默认简单模式；自定义参数仅在开启时生效，切回简单模式恢复默认请求', async () => {
  const defaultNegative = 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
    images: [{ image: 'iVBORw0KGgo=', seed: 0 }],
  }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<TachieGenerator prompt="1girl" negativePrompt="upstream negative" />));
  await act(async () => button('NovelAI').click());
  const customToggle = () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(customToggle().checked).toBe(false);
  expect(container.querySelector('input[list]')).toBeNull();
  expect(container.textContent).toContain('简单模式');
  await setInput('NovelAI Persistent API Token', 'token');
  await setInput('提示词', '1girl');
  await act(async () => customToggle().click());
  expect(container.querySelectorAll('textarea')[1].value).toBe(defaultNegative);
  await setInput('负面提示词（可选）', '');
  await setInput('步数（1–50）', '30');
  await setInput('种子（留空随机）', '42');
  await act(async () => button('使用 NovelAI').click());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).parameters).toMatchObject({ steps: 30, seed: 42, negative_prompt: '' });
  await act(async () => customToggle().click());
  expect(container.querySelector('input[list]')).toBeNull();
  await act(async () => button('使用 NovelAI').click());
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).parameters).toMatchObject({
    steps: 28, scale: 7, negative_prompt: defaultNegative,
    v4_negative_prompt: { caption: { base_caption: defaultNegative, char_captions: [] } },
  });
  await act(async () => customToggle().click());
  expect(container.querySelector<HTMLInputElement>('input[type=number]')?.value).toBe('30');
});

it.each([
  ['nai-diffusion-4-5-curated', 'masterpiece,'],
  ['nai-diffusion-5-curated', 'very aesthetic, masterpiece,'],
])('%s 使用对应推荐质量词并通知上层重置，只有生图点击才发送网络请求', async (model, qualityTags) => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
    images: [{ image: 'iVBORw0KGgo=', seed: 0 }],
  }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const reset = vi.fn();
  await act(async () => root.render(<TachieGenerator prompt="原始描述" recommendedPrompt="角色外观与剧情推荐" onUseRecommendedPrompt={reset} />));
  await act(async () => button('NovelAI').click());
  await setInput('模型版本', model);
  const promptInput = () => container.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(promptInput().value).toBe('');
  await act(async () => button('使用推荐提示词').click());
  expect(promptInput().value).toBe(`0.9::Ixy::,\n${qualityTags}\n角色外观与剧情推荐`);
  expect(reset).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<TachieGenerator prompt="原始描述" recommendedPrompt="新剧情推荐" onUseRecommendedPrompt={reset} />));
  expect(promptInput().value).toBe(`0.9::Ixy::,\n${qualityTags}\n角色外观与剧情推荐`);
  await act(async () => button('使用推荐提示词').click());
  expect(promptInput().value).toBe(`0.9::Ixy::,\n${qualityTags}\n新剧情推荐`);
  expect(fetchMock).not.toHaveBeenCalled();
  await setInput('NovelAI Persistent API Token', 'token');
  if (!container.querySelector<HTMLTextAreaElement>('textarea')!.value) await setInput('提示词', '1girl');
  await act(async () => button('使用 NovelAI').click());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toBe(`0.9::Ixy::,\n${qualityTags}\n新剧情推荐`);
});

it('战报插图现有推荐提示词可直接用于 NovelAI，并同步恢复上层编辑区', async () => {
  localStorage.setItem('arena.section.battleIllustration.open', '1');
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<BattleIllustrationPanel headline="雨夜对峙" reportBody="双方在雨夜的街头停手。" combatants={[]} aiImpacts={null} />));
  const sectionButton = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.includes('战报插图'));
  if (!button('NovelAI')) await act(async () => sectionButton!.click());
  const upstream = container.querySelector<HTMLTextAreaElement>('textarea')!;
  const original = upstream.value;
  expect(original).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(upstream, '手动修改的描述');
    upstream.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('NovelAI').click());
  const novelaiPrompt = container.querySelectorAll('textarea')[1];
  expect(novelaiPrompt.value).toBe('');
  await act(async () => button('使用推荐提示词').click());
  expect(novelaiPrompt.value).toBe(`0.9::Ixy::,\nmasterpiece,\n${original}`);
  expect(upstream.value).toBe(original);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('LLM 优化明确区分预览、应用与生图，双击只请求一次且两套凭据隔离', async () => {
  const provider = NOVELAI_TEXT_PROVIDERS.find((item) => item.type === 'openai')!;
  localStorage.setItem('arena.customProvider.selected', provider.id);
  localStorage.setItem(`arena.customProvider.model.${provider.id}`, provider.models[0].value);
  localStorage.setItem(`arena.customProvider.apiKey.${provider.id}`, 'text-secret');
  let finishRewrite!: (response: Response) => void;
  const fetchMock = vi.fn().mockImplementation(async (url) => {
    if (String(url).startsWith('/api/')) return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    if (String(url).includes('image.novelai.net')) return new Response(JSON.stringify({ images: [{ image: 'iVBORw0KGgo=', seed: 0 }] }), { headers: { 'Content-Type': 'application/json' } });
    return new Promise<Response>((resolve) => { finishRewrite = resolve; });
  });
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<TachieGenerator prompt="蓝发少女" />));
  await act(async () => button('NovelAI').click());
  await setInput('NovelAI Persistent API Token', 'image-secret');
  await setInput('提示词', '蓝发少女');
  await act(async () => button('LLM 优化提示词').click());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('边缘函数用于转发');
  await act(async () => {
    window.dispatchEvent(new CustomEvent('mahoshojo:set-ai-provider-config', {
      detail: { providerId: provider.id, modelId: provider.models[0].value, apiKey: 'unrelated-battle-key' },
    }));
  });
  expect(localStorage.getItem(`arena.customProvider.apiKey.${provider.id}`)).toBe('text-secret');
  await act(async () => { button('调用文本模型优化').click(); button('调用文本模型优化').click(); });
  await act(async () => { await vi.waitFor(() => expect(finishRewrite).toBeTypeOf('function')); });
  expect(button('使用 NovelAI').disabled).toBe(true);
  const textCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith(provider.baseUrl));
  expect(textCalls).toHaveLength(1);
  expect(new Headers(textCalls[0][1].headers).get('authorization')).toBe('Bearer text-secret');
  expect(JSON.stringify(textCalls[0])).not.toContain('image-secret');
  await act(async () => finishRewrite(new Response(JSON.stringify({
    id: 'test', object: 'chat.completion', created: 1, model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content: '1girl, blue hair, masterpiece' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }), { headers: { 'Content-Type': 'application/json' } })));
  const promptInput = container.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(promptInput.value).toBe('蓝发少女');
  expect(container.textContent).toContain('优化结果（尚未应用）');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('image.novelai.net'))).toBe(false);
  await act(async () => button('应用到提示词').click());
  expect(promptInput.value).toBe('1girl, blue hair, masterpiece');
  await act(async () => button('使用 NovelAI').click());
  const imageCall = fetchMock.mock.calls.find(([url]) => String(url).includes('image.novelai.net'))!;
  expect(JSON.parse(imageCall[1].body).input).toBe('1girl, blue hair, masterpiece');
  expect(imageCall[1].headers.Authorization).toBe('Bearer image-secret');
  expect(JSON.stringify(imageCall)).not.toContain('text-secret');
});

it('源提示词变化时取消改写，迟到结果不能覆盖新内容或继续供用户应用', async () => {
  const provider = NOVELAI_TEXT_PROVIDERS.find((item) => item.type === 'openai')!;
  localStorage.setItem('arena.customProvider.selected', provider.id);
  localStorage.setItem(`arena.customProvider.apiKey.${provider.id}`, 'text-secret');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
  let finish!: (text: string) => void;
  const rewrite = vi.spyOn(promptRewriter, 'rewriteNovelAIPrompt').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<TachieGenerator prompt="旧剧情" />));
  await act(async () => button('NovelAI').click());
  await setInput('提示词', '旧剧情');
  await act(async () => button('LLM 优化提示词').click());
  await act(async () => button('调用文本模型优化').click());
  const signal = rewrite.mock.calls[0][3];
  await setInput('提示词', '新剧情');
  expect(signal.aborted).toBe(true);
  await act(async () => finish('obsolete output'));
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('新剧情');
  expect(container.textContent).not.toContain('obsolete output');
  expect(button('应用到提示词')).toBeUndefined();
});


it('Token 刷新恢复且清空删除；简单模式支持 V5 和 Base URL，提示词不自动继承', async () => {
  localStorage.setItem('tachie_novelai_token', 'saved-token');
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ images: [{ image: 'iVBORw0KGgo=', seed: 0 }] }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<TachieGenerator prompt="默认提示词" />));
  await act(async () => button('NovelAI').click());
  expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('saved-token');
  expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
  expect(button('使用 NovelAI').disabled).toBe(true);
  const modelSelect = container.querySelector<HTMLSelectElement>('select')!;
  expect(Array.from(modelSelect.options).map((option) => option.value)).toEqual(['nai-diffusion-4-5-curated', 'nai-diffusion-5-curated']);
  await setInput('模型版本', 'nai-diffusion-5-curated');
  await setInput('NovelAI Base URL（可选）', 'https://proxy.example/nai/');
  await setInput('提示词', 'my own prompt');
  await act(async () => root.render(<TachieGenerator prompt="新的默认提示词" />));
  expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('my own prompt');
  await act(async () => button('使用 NovelAI').click());
  expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example/nai/ai/generate-image');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('nai-diffusion-5-curated');
  await setInput('NovelAI Persistent API Token', '');
  expect(localStorage.getItem('tachie_novelai_token')).toBeNull();
});


it('始终继承战报模型和 Key，上方更新后使用新配置，无独立配置入口', async () => {
  const provider = NOVELAI_TEXT_PROVIDERS.find((item) => item.type === 'openai')!;
  const current = { providerId: provider.id, modelId: provider.models[0].value, apiKey: 'battle-key' };
  localStorage.setItem('arena.customProvider.selected', current.providerId);
  localStorage.setItem(`arena.customProvider.model.${current.providerId}`, current.modelId);
  localStorage.setItem(`arena.customProvider.apiKey.${current.providerId}`, current.apiKey);
  localStorage.setItem('novelai.promptOptimizer.selected', current.providerId);
  localStorage.setItem(`novelai.promptOptimizer.apiKey.${current.providerId}`, 'separate-key');
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"entries":[]}', { headers: { 'Content-Type': 'application/json' } })));
  const rewrite = vi.spyOn(promptRewriter, 'rewriteNovelAIPrompt').mockResolvedValue('optimized');
  const upstreamChange = vi.fn();
  await act(async () => root.render(<><AiProviderSelector onConfigChange={upstreamChange} /><TachieGenerator prompt="" /></>));
  await act(async () => button('NovelAI').click());
  await setInput('提示词', '角色描述');
  await act(async () => button('LLM 优化提示词').click());
  expect(container.textContent).toContain(`提示词改写使用的文本模型：${provider.name} / ${current.modelId}`);
  await act(async () => button('调用文本模型优化').click());
  expect(rewrite.mock.calls[0][0]).toMatchObject(current);
  const updated = { ...current, modelId: 'gpt-5.4', apiKey: 'updated-battle-key' };
  await act(async () => window.dispatchEvent(new CustomEvent('mahoshojo:set-ai-provider-config', { detail: updated })));
  expect(upstreamChange).toHaveBeenLastCalledWith(expect.objectContaining(updated));
  await act(async () => button('调用文本模型优化').click());
  expect(rewrite.mock.calls[1][0]).toMatchObject(updated);
  expect(localStorage.getItem(`novelai.promptOptimizer.apiKey.${current.providerId}`)).toBe('separate-key');
  expect(Array.from(container.querySelectorAll('label')).some((label) => label.textContent?.includes('继承上方'))).toBe(false);
  expect(container.textContent).not.toContain('取消继承');
  expect(localStorage.getItem(`arena.customProvider.apiKey.${current.providerId}`)).toBe('updated-battle-key');
});

it('茶会继承自己的配置，忽略战报配置事件，切换为系统模型后禁用优化并取消在途请求', async () => {
  const provider = NOVELAI_TEXT_PROVIDERS.find((item) => item.type === 'openai')!;
  localStorage.setItem('magic-tea-party.customProvider.selected', provider.id);
  localStorage.setItem(`magic-tea-party.customProvider.apiKey.${provider.id}`, 'tea-key');
  const rewrite = vi.spyOn(promptRewriter, 'rewriteNovelAIPrompt').mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<TachieGenerator prompt="" textProviderStorageNamespace="magic-tea-party.customProvider" />));
  await act(async () => button('NovelAI').click());
  await setInput('提示词', '茶会场景');
  await act(async () => button('LLM 优化提示词').click());
  await act(async () => window.dispatchEvent(new CustomEvent(AI_PROVIDER_CONFIG_CHANGED, {
    detail: { storageNamespace: 'arena.customProvider', config: { providerId: provider.id, modelId: provider.models[0].value, apiKey: 'wrong-battle-key' } },
  })));
  await act(async () => button('调用文本模型优化').click());
  expect(rewrite.mock.calls[0][0].apiKey).toBe('tea-key');
  const signal = rewrite.mock.calls[0][3];
  await act(async () => window.dispatchEvent(new CustomEvent(AI_PROVIDER_CONFIG_CHANGED, {
    detail: { storageNamespace: 'magic-tea-party.customProvider', config: { providerId: 'system', modelId: 'default', apiKey: '' } },
  })));
  expect(signal.aborted).toBe(true);
  expect(button('调用文本模型优化').disabled).toBe(true);
  expect(container.textContent).toContain('正在使用系统模型');
});

it('不兼容的上方渠道不会静默回退到其他模型', async () => {
  localStorage.setItem('arena.customProvider.selected', 'system');
  const rewrite = vi.spyOn(promptRewriter, 'rewriteNovelAIPrompt');
  await act(async () => root.render(<TachieGenerator prompt="" />));
  await act(async () => button('NovelAI').click());
  await setInput('提示词', '描述');
  await act(async () => button('LLM 优化提示词').click());
  await act(async () => window.dispatchEvent(new CustomEvent(AI_PROVIDER_CONFIG_CHANGED, {
    detail: { storageNamespace: 'arena.customProvider', config: { providerId: 'unknown-provider', modelId: 'unsupported', apiKey: 'key' } },
  })));
  expect(button('调用文本模型优化').disabled).toBe(true);
  expect(container.textContent).toContain('不支持此处的浏览器直连');
  expect(rewrite).not.toHaveBeenCalled();
});


it('改写支持补充画面要求和可选质量词，结果可编辑再应用且不自动生图', async () => {
  const provider = NOVELAI_TEXT_PROVIDERS.find((item) => item.type === 'openai')!;
  localStorage.setItem('arena.customProvider.selected', provider.id);
  localStorage.setItem(`arena.customProvider.apiKey.${provider.id}`, 'text-key');
  const rewrite = vi.spyOn(promptRewriter, 'rewriteNovelAIPrompt').mockResolvedValue('1girl, no text\nText: Hello');
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<TachieGenerator prompt="" />));
  await act(async () => button('NovelAI').click());
  await setInput('提示词', '雨夜中的角色');
  await act(async () => button('LLM 优化提示词').click());
  await setInput('补充画面要求（可选）', '只保留交锋前一刻，背面全身');
  const qualityToggle = Array.from(container.querySelectorAll('label')).find((label) => label.textContent?.includes('补充所选模型的质量词'))!.querySelector<HTMLInputElement>('input')!;
  expect(qualityToggle.checked).toBe(false);
  await act(async () => qualityToggle.click());
  await act(async () => button('调用文本模型优化').click());
  expect(rewrite.mock.calls[0][4]).toEqual({ requirements: '只保留交锋前一刻，背面全身', addQualityTags: true });
  expect(container.textContent).not.toContain('画面文字与 no text 冲突');
  expect(button('应用到提示词').disabled).toBe(false);
  expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('雨夜中的角色');
  await setInput('优化结果（尚未应用）', '');
  expect(button('应用到提示词').disabled).toBe(true);
  await setInput('优化结果（尚未应用）', '1girl, rain\nShe faces away from the viewer.');
  expect(container.textContent).not.toContain('画面文字与 no text 冲突');
  await act(async () => button('应用到提示词').click());
  expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('1girl, rain\nShe faces away from the viewer.');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('补充要求改变时取消在途优化，过期结果不可应用', async () => {
  const provider = NOVELAI_TEXT_PROVIDERS.find((item) => item.type === 'openai')!;
  localStorage.setItem('arena.customProvider.selected', provider.id);
  localStorage.setItem(`arena.customProvider.apiKey.${provider.id}`, 'text-key');
  let finish!: (text: string) => void;
  const rewrite = vi.spyOn(promptRewriter, 'rewriteNovelAIPrompt').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<TachieGenerator prompt="" />));
  await act(async () => button('NovelAI').click());
  await setInput('提示词', '场景');
  await act(async () => button('LLM 优化提示词').click());
  await act(async () => button('调用文本模型优化').click());
  const signal = rewrite.mock.calls[0][3];
  await setInput('补充画面要求（可选）', '换为近景');
  expect(signal.aborted).toBe(true);
  await act(async () => finish('outdated scene'));
  expect(button('应用到提示词')).toBeUndefined();
  expect(button('调用文本模型优化').disabled).toBe(false);
});

it('优化中收起插槽会取消请求并释放 busy，迟到结果不复活且重开不自动重试', async () => {
  const provider = NOVELAI_TEXT_PROVIDERS.find((item) => item.type === 'openai')!;
  localStorage.setItem('arena.customProvider.selected', provider.id);
  localStorage.setItem(`arena.customProvider.apiKey.${provider.id}`, 'text-secret');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
  let finish!: (text: string) => void;
  const rewrite = vi.spyOn(promptRewriter, 'rewriteNovelAIPrompt').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<TachieGenerator prompt="原始描述" />));
  await act(async () => button('NovelAI').click());
  await setInput('NovelAI Persistent API Token', 'image-input');
  await setInput('提示词', '手工描述');
  await act(async () => button('LLM 优化提示词').click());
  await act(async () => button('调用文本模型优化').click());
  expect(button('使用 NovelAI').disabled).toBe(true);
  const signal = rewrite.mock.calls[0][3];
  await act(async () => button('收起 LLM 优化提示词').click());
  expect(signal.aborted).toBe(true);
  expect(button('使用 NovelAI').disabled).toBe(false);
  await act(async () => finish('obsolete output'));
  await act(async () => button('LLM 优化提示词').click());
  expect(button('应用到提示词')).toBeUndefined();
  expect(container.textContent).not.toContain('obsolete output');
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('手工描述');
  expect(button('使用 NovelAI').disabled).toBe(false);
  expect(rewrite).toHaveBeenCalledTimes(1);
});
