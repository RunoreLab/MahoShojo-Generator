import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_VISUAL_NOVEL_PACKAGE_REF as ref,
  clearLocalWebPackageSessionStaging,
  createWebPackageOverlay,
  findWebPackageCandidateById,
  findWebPackageCandidatesById,
  listStagedLocalWebPackages,
  prepareWebPackageReplay,
  resolveWebPackage,
  stageLocalWebPackage,
  unstageLocalWebPackage,
  verifyWebPackage,
} from '../src';

const story = JSON.stringify({ title: '重放故事', scenes: [{ text: '第一幕' }] });

const buildLocalPackage = async (version: string) => {
  const builtin = await resolveWebPackage(ref);
  const manifest = {
    ...builtin.manifest,
    id: 'local.replay-package',
    version,
    name: `本地重放包 ${version}`,
  };
  return verifyWebPackage(manifest, manifest.files.map((file) => ({
    path: file.path,
    bytes: builtin.readFile(file.path)!,
  })));
};

const stageAndOverlay = async (version: string) => {
  const pkg = await buildLocalPackage(version);
  stageLocalWebPackage(pkg);
  const overlay = await createWebPackageOverlay(pkg.ref, story);
  return { pkg, overlay };
};

describe('historical Web package replay', () => {
  beforeEach(() => {
    clearLocalWebPackageSessionStaging();
  });
  afterEach(() => {
    clearLocalWebPackageSessionStaging();
  });

  it('exact-restores a retained revision without compatibility warnings', async () => {
    const { generatedContent, ...artifact } = await createWebPackageOverlay(ref, story);
    void generatedContent;
    const outcome = await prepareWebPackageReplay({ artifact, generatedContent: story });
    expect(outcome.status).toBe('exact');
    expect(outcome.message).toBeUndefined();
    expect(outcome.instance?.base.ref).toEqual(ref);
    expect(artifact.packageRef).toEqual(ref);
  });

  it('returns missing-package with safe fallback when no candidate exists', async () => {
    const { overlay } = await stageAndOverlay('1.0.0');
    const { generatedContent, ...artifact } = overlay;
    clearLocalWebPackageSessionStaging();

    const outcome = await prepareWebPackageReplay({ artifact, generatedContent });
    expect(outcome.status).toBe('missing-package');
    expect(outcome.candidateAvailable).toBe(false);
    expect(outcome.fallbackText).toContain('重放故事');
    expect(outcome.instance).toBeUndefined();
  });

  it('awaits explicit compatibility choice when only a same-id candidate is staged', async () => {
    const v1 = await buildLocalPackage('1.0.0');
    stageLocalWebPackage(v1);
    const { generatedContent, ...artifact } = await createWebPackageOverlay(v1.ref, story);
    clearLocalWebPackageSessionStaging();

    const v2 = await buildLocalPackage('1.1.0');
    expect(v2.ref.id).toBe(artifact.packageRef.id);
    expect(v2.ref.digest).not.toBe(artifact.packageRef.digest);
    stageLocalWebPackage(v2);

    expect((await findWebPackageCandidateById(artifact.packageRef.id))?.ref).toEqual(v2.ref);

    // Higher version wins deterministically when multiple same-id candidates are staged.
    const v0 = await buildLocalPackage('0.9.0');
    stageLocalWebPackage(v0);
    expect((await findWebPackageCandidateById(artifact.packageRef.id))?.ref).toEqual(v2.ref);
    expect((await findWebPackageCandidatesById(artifact.packageRef.id)).map((pkg) => pkg.ref.version))
      .toEqual(['1.1.0', '0.9.0']);
    unstageLocalWebPackage(v0.ref);

    const deferred = await prepareWebPackageReplay({ artifact, generatedContent });
    expect(deferred.status).toBe('mismatch-available');
    expect(deferred.message).toContain('1.1.0');
    expect(deferred.candidateAvailable).toBe(true);
    expect(deferred.instance).toBeUndefined();
    expect(artifact.packageRef).toEqual(v1.ref);

    const allowed = await prepareWebPackageReplay({
      artifact,
      generatedContent,
      allowCompatibility: true,
    });
    expect(allowed.status).toBe('compatibility');
    expect(allowed.message).toContain('不同版本');
    expect(allowed.instance?.base.ref).toEqual(v2.ref);
    expect(allowed.overlay?.packageRef).toEqual(v2.ref);
    expect(allowed.overlay?.generatedDigest).toBe(artifact.generatedDigest);
    expect(listStagedLocalWebPackages().map((pkg) => pkg.ref.digest)).toEqual([v2.ref.digest]);
    expect(artifact.packageRef).toEqual(v1.ref);
  });

  it('rejects compatibility when target contract or content digest breaks', async () => {
    const v1 = await buildLocalPackage('1.0.0');
    stageLocalWebPackage(v1);
    const { generatedContent, ...artifact } = await createWebPackageOverlay(v1.ref, story);
    clearLocalWebPackageSessionStaging();
    const v2 = await buildLocalPackage('1.1.0');
    stageLocalWebPackage(v2);

    const brokenDigest = await prepareWebPackageReplay({
      artifact: { ...artifact, generatedDigest: `sha256:${'0'.repeat(64)}` },
      generatedContent,
      allowCompatibility: true,
    });
    expect(brokenDigest.status).toBe('rejected');
    expect(brokenDigest.message).toContain('digest');

    const brokenPath = await prepareWebPackageReplay({
      artifact: { ...artifact, targetPath: 'runtime/app.js' },
      generatedContent,
      allowCompatibility: true,
    });
    expect(brokenPath.status).toBe('rejected');
    expect(brokenPath.message).toContain('契约');
    expect(artifact.packageRef).toEqual(v1.ref);
  });

  it('a higher incompatible candidate never shadows a lower compatible one', async () => {
    const v1 = await buildLocalPackage('1.0.0');
    stageLocalWebPackage(v1);
    const { generatedContent, ...artifact } = await createWebPackageOverlay(v1.ref, story);
    clearLocalWebPackageSessionStaging();

    const v2 = await buildLocalPackage('1.1.0');
    const incompatible = await verifyWebPackage(
      { ...v2.manifest, generation: { ...v2.manifest.generation, target: 'other/out.html' } },
      v2.manifest.files.map((file) => ({ path: file.path, bytes: v2.readFile(file.path)! })),
    );
    stageLocalWebPackage(incompatible);

    expect((await findWebPackageCandidatesById(artifact.packageRef.id)).map((pkg) => pkg.ref.version))
      .toEqual(['1.1.0']);
    const outcome = await prepareWebPackageReplay({
      artifact,
      generatedContent,
      allowCompatibility: true,
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.message).toContain('契约不兼容');
    expect(outcome.candidateAvailable).toBe(true);
    expect(outcome.instance).toBeUndefined();
    expect(artifact.packageRef).toEqual(v1.ref);

    unstageLocalWebPackage(incompatible.ref);
    stageLocalWebPackage(v1);
    const fallbackExact = await prepareWebPackageReplay({ artifact, generatedContent });
    expect(fallbackExact.status).toBe('exact');
    expect(fallbackExact.instance?.base.ref).toEqual(v1.ref);
  });

  it('keeps historical provenance while rendering with a compatibility candidate', async () => {
    const v1 = await buildLocalPackage('1.0.0');
    stageLocalWebPackage(v1);
    const overlay = await createWebPackageOverlay(v1.ref, story);
    const { generatedContent, ...artifact } = overlay;
    clearLocalWebPackageSessionStaging();
    const historical = structuredClone(artifact);

    const v2 = await buildLocalPackage('1.1.0');
    stageLocalWebPackage(v2);
    const outcome = await prepareWebPackageReplay({
      artifact,
      generatedContent,
      allowCompatibility: true,
    });
    expect(outcome.status).toBe('compatibility');
    expect(artifact).toEqual(historical);
    expect(outcome.overlay?.packageRef).toEqual(v2.ref);
    expect(outcome.overlay?.generatedDigest).toBe(historical.generatedDigest);
  });
});
