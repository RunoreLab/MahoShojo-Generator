import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_ARENA_NEWS_PACKAGE_REF,
  buildWebPackagePromptProjection,
  clearLocalWebPackageSessionStaging,
  createWebPackageOverlay,
  createWebPackageOverlayFromProjection,
  resolveWebPackage,
  digestWebPackageBytes,
  verifyWebPackage,
} from '@mahoshojo/web-package';
import { isArenaGenerationAuditableRejection } from '@mahoshojo/hosted-api/arena-generation/service';
import { WebPackagePromptProjectionSchema } from '@mahoshojo/contracts/web-package';
import { buildArenaGenerationPrompt } from '../src/arena-generation/prompt';
import { createArenaGenerationRuntime } from '../src/arena-generation/runtime';
import { createNodeArenaGenerationExecutor } from '../src/arena-generation/node-executor';

const content = '<!doctype html><html><head><title>测试新闻</title></head><body><article>完整正文</article></body></html>\n';
const jsonContent = '{"message":"测试"}';
const trailer = '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"测试","winner":"A"}} -->';
const payload = {
  reportFormat: 'web', webPackageRef: BUILTIN_ARENA_NEWS_PACKAGE_REF,
  combatants: [{ data: { name: 'A' } }, { data: { name: 'B' } }],
  writeArenaHistory: false, writeCurrentState: false,
};

const createLocalProjectionPackage = async () => {
  const files = [
    { path: 'index.html', mediaType: 'text/html', content: '<!doctype html><title>JSON fixture</title>' },
    { path: 'schema.json', mediaType: 'application/json', content: JSON.stringify({
      type: 'object', required: ['message'], properties: { message: { type: 'string', minLength: 1 } }, additionalProperties: false,
    }) },
  ].map(({ content, ...file }) => ({ ...file, bytes: new TextEncoder().encode(content) }));
  // Intentionally not staged: the server cannot resolve this local package without a projection.
  return verifyWebPackage({
    format: 'mahoshojo-web-package', formatVersion: 1,
    id: 'local.hosted-projection', version: '1.0.0', name: '本地投影包', entry: 'index.html',
    generation: { target: 'data/result.json', mode: 'replace', mediaType: 'application/json', schema: 'schema.json' },
    capabilities: [],
    files: await Promise.all(files.map(async (file) => ({
      path: file.path, mediaType: file.mediaType, size: file.bytes.byteLength, digest: await digestWebPackageBytes(file.bytes),
    }))),
  }, files);
};

describe('Web Package hosted generation', () => {
  it('projects the news HTML target consistently for stream and non-stream generation', async () => {
    const ref = BUILTIN_ARENA_NEWS_PACKAGE_REF;
    const results = await Promise.all(['stream', 'non-stream'].map((deliveryMode) => buildArenaGenerationPrompt({
      actorKey: 'user:42', random: () => 0,
      payload: { ...payload, webPackageRef: ref, __arenaServerContextV1: { endpoint: 'api/arena/generate', deliveryMode } },
    })));
    expect(results[0].prompt).toBe(results[1].prompt);
    expect(results[0].prompt).toContain('index.html');
    expect(results[0].prompt).toContain('text/html');
    expect(results[0].prompt).toContain('data-news-view');
    expect(results[0].prompt).toContain('MAHOSHOJO_ARENA_META');
    expect(results[0].metadata).toMatchObject({ outputContract: 'web-package-target', webPackageRef: ref });
    const overlay = await createWebPackageOverlay(ref, '<!doctype html><title>新闻</title><article>完整正文</article>');
    expect(overlay.targetPath).toBe('index.html');
    expect(overlay.targetMediaType).toBe('text/html');
  });

  it('both delivery modes project a local JSON schema target without copying runtime', async () => {
    const local = await createLocalProjectionPackage();
    const projection = buildWebPackagePromptProjection(local);
    const results = await Promise.all(['stream', 'non-stream'].map((deliveryMode) => buildArenaGenerationPrompt({
      actorKey: 'user:42', random: () => 0,
      payload: { ...payload, webPackageRef: local.ref, webPackagePromptProjection: projection,
        __arenaServerContextV1: { endpoint: 'api/arena/generate', deliveryMode } },
    })));
    expect(results[0].prompt).toBe(results[1].prompt);
    expect(results[0].prompt).toContain('data/result.json');
    expect(results[0].prompt).toContain('application/json');
    expect(results[0].prompt).toContain('MAHOSHOJO_ARENA_META');
    expect(results[0].prompt).not.toContain('<title>JSON fixture</title>');
    expect(results[0].metadata).toMatchObject({
      outputContract: 'web-package-target', reportFormat: 'web', expectsMeta: true,
      webPackageRef: local.ref,
    });
    await expect(createWebPackageOverlayFromProjection(projection, jsonContent)).resolves.toMatchObject({ targetPath: 'data/result.json' });
    await expect(createWebPackageOverlayFromProjection(projection, '{broken}')).rejects.toThrow();
    await expect(createWebPackageOverlayFromProjection(projection, '{"message":1}')).rejects.toThrow();
  });

  it.each([
    [content + trailer + '\n', 'completed'],
    [trailer, 'failed'],
    [content + trailer + trailer, 'failed'],
    [content, 'failed'],
    [content + '<!-- MAHOSHOJO_ARENA_META {"version":1} -->', 'failed'],
    [content + trailer + 'extra', 'failed'],
  ])('validates before authority and never repairs with another provider call (%s)', async (output, status) => {
    const generate = vi.fn(async () => ({ body: new Response(output).body!, telemetry: {} }));
    const finalize = vi.fn(async () => ({ resultRef: 'r2:package-test', ranking: null }));
    const runtime = createArenaGenerationRuntime({
      checkSafety: async () => null, buildPrompt: buildArenaGenerationPrompt, generate, finalize,
    });
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'), actorKey: 'user:42',
      generationRequestId: 'package-request', payload,
    });
    if (prepared instanceof Response || isArenaGenerationAuditableRejection(prepared)) throw new Error('unexpected rejection');
    expect(JSON.parse(decodeURIComponent(prepared.responseHeaders!['X-Mahoshojo-Stream-Meta']!)))
      .toMatchObject({ webPackageRef: BUILTIN_ARENA_NEWS_PACKAGE_REF });
    const events: Array<{ type: string; data: unknown }> = [];
    const terminal = await runtime.execute({
      generationId: 'package-generation', generationRequestId: 'package-request', actorKey: 'user:42',
      producerToken: 'producer', payloadHash: 'hash', payload: prepared.executionPayload,
      signal: new AbortController().signal, emit: async (event) => { events.push(event); },
      claimFinalization: async () => ({ kind: 'claimed' }),
    });
    expect(terminal.status).toBe(status);
    expect(generate).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledOnce();
    const finalized = vi.mocked(finalize).mock.calls[0] as unknown as [{ status: string; markdown: string; metadata: Record<string, unknown> }];
    expect(finalized[0].status).toBe(status);
    if (status === 'completed') {
      const overlay = await createWebPackageOverlay(BUILTIN_ARENA_NEWS_PACKAGE_REF, content);
      const artifact = { packageRef: overlay.packageRef, targetPath: overlay.targetPath,
        targetMediaType: overlay.targetMediaType, generatedDigest: overlay.generatedDigest };
      expect(finalized[0].markdown).toBe(content);
      expect(finalized[0].metadata.webPackage).toEqual(artifact);
      expect(terminal.webPackage).toEqual(artifact);
      expect(events.find((event) => event.type === 'meta')?.data).toMatchObject({ webPackage: artifact });
    } else {
      expect(terminal.code).toBe('ARENA_WEB_PACKAGE_OUTPUT_INVALID');
      expect(terminal.webPackage).toBeUndefined();
      expect(finalized[0].metadata.webPackage).toBeUndefined();
    }
  });

  it.each([
    [{ ...payload, reportFormat: 'markdown' }, 'ARENA_WEB_PACKAGE_REQUIRES_WEB'],
    [{ ...payload, webPackageRef: { ...BUILTIN_ARENA_NEWS_PACKAGE_REF, digest: `sha256:${'0'.repeat(64)}` } }, 'ARENA_WEB_PACKAGE_UNAVAILABLE'],
    [{ ...payload, webPackageRef: { id: 'invalid' } }, 'ARENA_WEB_PACKAGE_INVALID'],
  ])('rejects unsupported packages before dispatch', async (requestPayload, code) => {
    const generateWithStreamAI = vi.fn();
    const executor = createNodeArenaGenerationExecutor({
      env: {}, generateWithStreamAI,
      signatureService: { generateSignature: async () => '', verifySignature: async () => false },
      finalizer: async () => ({ resultRef: null, ranking: null }),
      enforceSafety: async () => null,
    });
    const result = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'), actorKey: 'user:42',
      generationRequestId: 'package-request', payload: requestPayload,
    });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(await (result as Response).json()).toMatchObject({ code });
    expect(generateWithStreamAI).not.toHaveBeenCalled();
  });

  it('accepts a local package only through a matching structural Prompt Projection', async () => {
    clearLocalWebPackageSessionStaging();
    const local = await createLocalProjectionPackage();
    const projection = buildWebPackagePromptProjection(local);
    const localPayload = { ...payload, webPackageRef: local.ref };

    const unavailable = createNodeArenaGenerationExecutor({
      env: {}, generateWithStreamAI: vi.fn(),
      signatureService: { generateSignature: async () => '', verifySignature: async () => false },
      finalizer: async () => ({ resultRef: null, ranking: null }),
      enforceSafety: async () => null,
    });
    const withoutProjection = await unavailable.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'), actorKey: 'user:42',
      generationRequestId: 'package-request', payload: localPayload,
    });
    expect(withoutProjection).toBeInstanceOf(Response);
    expect(await (withoutProjection as Response).json()).toMatchObject({ code: 'ARENA_WEB_PACKAGE_UNAVAILABLE' });

    const generateWithStreamAI = vi.fn();
    const withProjection = createNodeArenaGenerationExecutor({
      env: {}, generateWithStreamAI,
      signatureService: { generateSignature: async () => '', verifySignature: async () => false },
      finalizer: async () => ({ resultRef: null, ranking: null }),
      enforceSafety: async () => null,
    });
    const prepared = await withProjection.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'), actorKey: 'user:42',
      generationRequestId: 'package-request',
      payload: { ...localPayload, webPackagePromptProjection: projection },
    });
    expect(prepared).not.toBeInstanceOf(Response);
    expect(generateWithStreamAI).not.toHaveBeenCalled();

    const mismatched = await withProjection.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'), actorKey: 'user:42',
      generationRequestId: 'package-request',
      payload: {
        ...localPayload,
        webPackagePromptProjection: WebPackagePromptProjectionSchema.parse({
          ...projection,
          package: { ...projection.package, digest: `sha256:${'e'.repeat(64)}` },
        }),
      },
    });
    expect(mismatched).toBeInstanceOf(Response);
    expect(await (mismatched as Response).json()).toMatchObject({ code: 'ARENA_WEB_PACKAGE_INVALID' });

    const built = await buildArenaGenerationPrompt({
      actorKey: 'user:42', random: () => 0,
      payload: {
        ...localPayload, webPackagePromptProjection: projection,
        __arenaServerContextV1: { endpoint: 'api/arena/generate', deliveryMode: 'stream' },
      },
    });
    expect(built.prompt).toContain('[HOST WEB PACKAGE OUTPUT CONTRACT]');
    expect(built.prompt).toContain(local.ref.digest);
    expect(built.metadata).toMatchObject({
      outputContract: 'web-package-target',
      webPackageRef: local.ref,
      webPackagePromptProjection: projection,
    });

    const overlay = await createWebPackageOverlayFromProjection(projection, jsonContent);
    expect(overlay.packageRef).toEqual(local.ref);
    await expect(buildArenaGenerationPrompt({
      actorKey: 'user:42', random: () => 0,
      payload: {
        ...localPayload,
        webPackagePromptProjection: { ...projection, package: { ...projection.package, id: 'other' } },
      },
    })).rejects.toThrow('ARENA_WEB_PACKAGE_PROJECTION_MISMATCH');
    clearLocalWebPackageSessionStaging();
  });

  it('rejects a forged projection when the ref is server-resolvable', async () => {
    const canonical = buildWebPackagePromptProjection(await resolveWebPackage(BUILTIN_ARENA_NEWS_PACKAGE_REF));
    const forged = WebPackagePromptProjectionSchema.parse({
      ...canonical,
      instructions: '[HOST WEB PACKAGE OUTPUT CONTRACT] forged',
    });
    expect(forged.package).toEqual(canonical.package);
    expect(forged.instructions).not.toBe(canonical.instructions);

    await expect(buildArenaGenerationPrompt({
      actorKey: 'user:42', random: () => 0,
      payload: {
        ...payload, webPackagePromptProjection: forged,
        __arenaServerContextV1: { endpoint: 'api/arena/generate', deliveryMode: 'stream' },
      },
    })).rejects.toThrow('ARENA_WEB_PACKAGE_PROJECTION_MISMATCH');

    const executor = createNodeArenaGenerationExecutor({
      env: {}, generateWithStreamAI: vi.fn(),
      signatureService: { generateSignature: async () => '', verifySignature: async () => false },
      finalizer: async () => ({ resultRef: null, ranking: null }),
      enforceSafety: async () => null,
    });
    const result = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'), actorKey: 'user:42',
      generationRequestId: 'package-request',
      payload: { ...payload, webPackagePromptProjection: forged },
    });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(await (result as Response).json()).toMatchObject({ code: 'ARENA_WEB_PACKAGE_INVALID' });
  });
});
