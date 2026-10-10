import { describe, expect, it, vi } from 'vitest';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { digestWebPackageBytes, verifyWebPackage, type ResolvedWebPackage } from '@mahoshojo/web-package';
import { executeArenaDirect, type ArenaDirectHostContext, type ArenaDirectIntent } from '../src/features/arena/direct';
import { createInitialArenaDraft } from '../src/features/arena/session';

const trailer = '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"网页战报","winner":"甲"},"impacts":[{"characterName":"甲","impact":"并肩作战"}]} -->';
const html = '<!doctype html><html><head><title>仅显示标题</title></head><body><script>globalThis.untrusted = true</script>故事</body></html>';
const input = (mode: 'classic' | 'kizuna' | 'daily' | 'scenario' = 'classic') => ({ ...createInitialArenaDraft(), reportFormat: 'web' as const, battleMode: mode,
  combatants: ['甲', '乙'].map((name) => ({ type: 'general-character' as const, data: { name, content: '完整角色' }, isValid: false, isPreset: false, filename: `${name}.json` })),
  scenario: { content: mode === 'scenario' ? { title: '车站', content: '等候' } : null, fileName: null } });
const intent = (generationMode: 'stream' | 'non-stream' = 'stream'): ArenaDirectIntent => ({ requestId: 'web-run', mode: 'direct-local', generationMode, modelId: 'local-model' });
const host = (base?: ResolvedWebPackage): ArenaDirectHostContext => ({ scopeKey: 'one', reporterInfo: { name: '记者', publication: '报刊' }, adjudicationResults: [], ...(base ? { resolveWebPackage: async () => base } : {}) });
const native = (content: string, finishReason: 'stop' | 'length' = 'stop', chunkSize = 19) => {
  let request: AiExecutionRequest | undefined;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'cancel_direct_ai') return;
    if (command !== 'stream_direct_ai') throw new Error('unexpected IPC');
    request = args!.request as AiExecutionRequest;
    const emit = (args!.onEvent as { onmessage(event: AiStreamEvent): void }).onmessage;
    const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
    let sequence = 0;
    emit({ ...identity, type: 'started', sequence: sequence++ });
    emit({ ...identity, type: 'reasoning-delta', sequence: sequence++, delta: '独立推理' });
    for (let offset = 0; offset < content.length; offset += chunkSize) emit({ ...identity, type: 'text-delta', sequence: sequence++, delta: content.slice(offset, offset + chunkSize) });
    emit({ ...identity, type: 'result', sequence, result: { ...identity, status: 'completed', output: { text: content, reasoning: '独立推理' }, finishReason } });
  });
  return { invoke, options: { invoke, profileId: 'profile', createChannel: () => ({}) }, get request() { return request; } };
};
const jsonPackage = async () => {
  const files = [{ path: 'index.html', text: html, mediaType: 'text/html' }, { path: 'schema.json', text: '{"type":"object","required":["value"],"properties":{"value":{"type":"integer"}}}', mediaType: 'application/json' }];
  const payloads = files.map((file) => ({ path: file.path, bytes: new TextEncoder().encode(file.text) }));
  return verifyWebPackage({ format: 'mahoshojo-web-package', formatVersion: 1, id: 'local.json', version: '1.0.0', name: '测试网页', entry: 'index.html', capabilities: [],
    generation: { target: 'story.json', mode: 'replace', mediaType: 'application/json', schema: 'schema.json' },
    files: await Promise.all(files.map(async (file, index) => ({ path: file.path, mediaType: file.mediaType, size: payloads[index]!.bytes.byteLength, digest: await digestWebPackageBytes(payloads[index]!.bytes) }))) }, payloads);
};

describe('Arena Web Direct protocol', () => {
  it.each(['classic', 'kizuna', 'daily', 'scenario'] as const)('%s uses the same single-call source contract for stream and non-stream', async (mode) => {
    for (const generationMode of ['stream', 'non-stream'] as const) {
      const transport = native(`${html}\n${trailer}`), partials: string[] = [];
      const result = await executeArenaDirect(transport.options, input(mode), intent(generationMode), host(), new AbortController().signal, (partial) => partials.push(partial.markdown));
      expect(result.status).toBe('completed'); expect(result.markdown).toBe(`${html}\n`); expect(result.reasoning).toBe('独立推理');
      expect(result).toMatchObject({ renderSnapshot: { version: 1, reportFormat: 'web' }, report: { reportFormat: 'web', headline: '网页战报', officialReport: { winner: '甲' } } });
      expect(transport.invoke).toHaveBeenCalledOnce(); expect(transport.request!.messages.some((message) => message.content.includes('完整 HTML'))).toBe(true);
      expect(JSON.parse(transport.request!.arenaInputJson!).reportFormat).toBe('web');
      expect(partials.every((partial) => !partial.includes('MAHOSHOJO_ARENA_META'))).toBe(true);
    }
  });
  it.each(['stream', 'non-stream'] as const)('%s normalizes/validates one target and freezes the canonical prompt projection', async (generationMode) => {
    const base = await jsonPackage(), value = { ...input(), webPackageRef: base.ref };
    const raw = '```json\n{"value":1}\n```\n' + trailer, transport = native(raw);
    const result = await executeArenaDirect(transport.options, value, intent(generationMode), host(base), new AbortController().signal);
    expect(result.status).toBe('completed'); expect(result.rawText).toBe(raw); expect(result.markdown).toBe('{"value":1}');
    expect(result).toMatchObject({ renderSnapshot: { reportFormat: 'web', webPackage: { packageRef: base.ref, targetPath: 'story.json', targetMediaType: 'application/json', generatedDigest: await digestWebPackageBytes(new TextEncoder().encode('{"value":1}')) } } });
    const request = transport.request!; expect(request.messages[0]?.role).toBe('system'); expect(request.messages[1]?.role).toBe('user');
    const payload = JSON.parse(request.arenaInputJson!); expect(payload.webPackagePromptProjection.target.path).toBe('story.json');
    expect(request.messages.map((message) => message.content).join('\n')).not.toContain('<script>globalThis.untrusted');
    expect(transport.invoke).toHaveBeenCalledOnce();
  });
  it.each(['没有文档的原文', '<html><body>未闭合', `${html}\n<!-- MAHOSHOJO_ARENA_META malformed -->`])('keeps free-Web completion separate from renderability and absent machine metadata', async (text) => {
    const transport = native(text);
    const result = await executeArenaDirect(transport.options, input(), intent(), host(), new AbortController().signal);
    expect(result).toMatchObject({ status: 'completed', metaStatus: 'absent', impacts: [], report: { headline: '', officialReport: { winner: '' } } });
    expect(result.rawText).toBe(text); expect(transport.invoke).toHaveBeenCalledOnce();
  });
  it.each(['{"value":1}', '{"value":1}\n' + trailer + '\nextra', '{"value":1}\n' + trailer + '\n' + trailer, '{"value":"invalid"}\n' + trailer])('rejects package control/target failures without a second provider call', async (text) => {
    const base = await jsonPackage(), transport = native(text);
    const result = await executeArenaDirect(transport.options, { ...input(), webPackageRef: base.ref }, intent(), host(base), new AbortController().signal);
    expect(result.status).toBe('invalid-output'); expect(result).not.toHaveProperty('renderSnapshot'); expect(result).not.toHaveProperty('historyCandidate');
    expect(result.rawText).toBe(text); expect(transport.invoke).toHaveBeenCalledOnce();
  });
  it('does not dispatch after cancellation during local package preparation', async () => {
    const base = await jsonPackage(), transport = native('{"value":1}\n' + trailer), controller = new AbortController();
    let finish!: (base: ResolvedWebPackage) => void;
    const preparation = new Promise<ResolvedWebPackage>((resolve) => { finish = resolve; });
    const result = executeArenaDirect(transport.options, { ...input(), webPackageRef: base.ref }, intent(), { ...host(), resolveWebPackage: () => preparation }, controller.signal);
    controller.abort(); finish(base);
    expect((await result).status).toBe('cancelled'); expect(transport.invoke).not.toHaveBeenCalled();
  });
  it('rejects EOF/length completion and retains source without a successful Web artifact', async () => {
    const transport = native(html + trailer, 'length');
    const result = await executeArenaDirect(transport.options, input(), intent(), host(), new AbortController().signal);
    expect(result.status).toBe('invalid-output'); expect(result.rawText).toBe(html + trailer); expect(result).not.toHaveProperty('renderSnapshot');
  });
  it('freezes the selected package and input before the resolver awaits, and rejects mismatched identity', async () => {
    const base = await jsonPackage(), transport = native('{"value":1}\n' + trailer);
    let release!: (base: ResolvedWebPackage) => void;
    const wait = new Promise<ResolvedWebPackage>((resolve) => { release = resolve; });
    const value = { ...input(), webPackageRef: { ...base.ref } };
    const executing = executeArenaDirect(transport.options, value, intent(), { ...host(), resolveWebPackage: () => wait }, new AbortController().signal);
    value.webPackageRef.version = 'later'; value.combatants[0]!.data.name = '后来的角色'; release(base);
    const result = await executing; expect(result.status).toBe('completed');
    const payload = JSON.parse(transport.request!.arenaInputJson!); expect(payload.webPackageRef).toEqual(base.ref); expect(payload.combatants[0].data.name).toBe('甲');
    const invalidTransport = native('{"value":1}\n' + trailer);
    expect((await executeArenaDirect(invalidTransport.options, { ...input(), webPackageRef: { ...base.ref, version: 'wrong' } }, intent(), host(base), new AbortController().signal)).status).toBe('failed');
    expect(invalidTransport.invoke).not.toHaveBeenCalled();
  });

  it('keeps the full shared 4 MiB content-plus-reasoning boundary for Web output', async () => {
    const frame = '<!doctype html><html><body></body></html>\n' + trailer;
    const budget = 4 * 1024 * 1024;
    const body = 'x'.repeat(budget - new TextEncoder().encode(frame + '独立推理').byteLength);
    const raw = frame.replace('</body>', body + '</body>');
    const atLimit = native(raw, 'stop', 60_000);
    const accepted = await executeArenaDirect(atLimit.options, input(), intent(), host(), new AbortController().signal);
    expect(accepted.status).toBe('completed'); expect(accepted.rawText).toBe(raw);
    const overLimit = native(raw + 'x', 'stop', 60_000);
    const rejected = await executeArenaDirect(overLimit.options, input(), intent(), host(), new AbortController().signal);
    expect(rejected.status).not.toBe('completed'); expect(rejected).not.toHaveProperty('renderSnapshot');
    expect(atLimit.invoke).toHaveBeenCalledOnce(); expect(overLimit.invoke).toHaveBeenCalledOnce();
  });

});
