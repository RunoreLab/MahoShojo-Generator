import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  buildWebPackagePromptProjection,
  clearLocalWebPackageSessionStaging,
  createWebPackageOverlay,
  createWebPackageOverlayFromProjection,
  resolveWebPackage,
  unpackWebPackageZip,
  packWebPackageZip,
} from '@mahoshojo/web-package';
import { isArenaGenerationAuditableRejection } from '@mahoshojo/hosted-api/arena-generation/service';
import { WebPackagePromptProjectionSchema } from '@mahoshojo/contracts/web-package';
import { buildArenaGenerationPrompt } from '../src/arena-generation/prompt';
import { createArenaGenerationRuntime } from '../src/arena-generation/runtime';
import { createNodeArenaGenerationExecutor } from '../src/arena-generation/node-executor';

const content = ' {"title":"测试","scenes":[{"text":"故事"}]}\n';
const trailer = '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"测试","winner":"A"}} -->';
const payload = {
  reportFormat: 'web', webPackageRef: BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
  combatants: [{ data: { name: 'A' } }, { data: { name: 'B' } }],
  writeArenaHistory: false, writeCurrentState: false,
};

const createLocalProjectionPackage = async () => {
  const archive = await packWebPackageZip(await resolveWebPackage(BUILTIN_VISUAL_NOVEL_PACKAGE_REF));
  const unpacked = await unpackWebPackageZip(archive);
  const manifest = { ...unpacked.manifest, id: 'local.hosted-projection', name: '本地投影包' };
  const { verifyWebPackage } = await import('@mahoshojo/web-package');
  // Intentionally not staged: the server cannot resolve this local package without a projection.
  return verifyWebPackage(manifest, manifest.files.map((file) => ({
    path: file.path, bytes: unpacked.readFile(file.path)!,
  })));
};

describe('Web Package hosted generation', () => {
  it('both delivery modes project one JSON target without copying runtime', async () => {
    const results = await Promise.all(['stream', 'non-stream'].map((deliveryMode) => buildArenaGenerationPrompt({
      actorKey: 'user:42', random: () => 0,
      payload: { ...payload, __arenaServerContextV1: { endpoint: 'api/arena/generate', deliveryMode } },
    })));
    expect(results[0].prompt).toBe(results[1].prompt);
    expect(results[0].prompt).toContain('data/story.json');
    expect(results[0].prompt).toContain('application/json');
    expect(results[0].prompt).toContain('MAHOSHOJO_ARENA_META');
    expect(results[0].prompt).not.toContain('完整 HTML5 document');
    expect(results[0].prompt).not.toContain('<script>');
    expect(results[0].metadata).toMatchObject({
      outputContract: 'web-package-target', reportFormat: 'web', expectsMeta: true,
      webPackageRef: BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
    });
  });

  it.each([
    [content + trailer + '\n', 'completed'],
    ['{broken}' + trailer, 'failed'],
    ['{"title":"测试","scenes":[]}' + trailer, 'failed'],
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
      .toMatchObject({ webPackageRef: BUILTIN_VISUAL_NOVEL_PACKAGE_REF });
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
      const overlay = await createWebPackageOverlay(BUILTIN_VISUAL_NOVEL_PACKAGE_REF, content);
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
    [{ ...payload, webPackageRef: { ...BUILTIN_VISUAL_NOVEL_PACKAGE_REF, digest: `sha256:${'0'.repeat(64)}` } }, 'ARENA_WEB_PACKAGE_UNAVAILABLE'],
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

    const overlay = await createWebPackageOverlayFromProjection(projection, content);
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
});
