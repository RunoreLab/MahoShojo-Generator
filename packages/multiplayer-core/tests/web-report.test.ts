import { describe, expect, it } from 'vitest';

import { applyArenaProposal, buildArenaRoomSharedConfig, diffArenaSharedConfig } from '../src/index';
import { collaborativeChangeTarget, hasCollaborativeChangeEffect } from '../src/provenance';
import { baseConfig, proposal } from './state-machine-fixtures';

describe('Web report room semantics', () => {
  const ref = { id: 'runorelab.visual-novel-lite', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` };

  it('projects only Package identity and groups format changes with Package selection', () => {
    const base = baseConfig();
    const working = { ...base, reportFormat: 'web' as const, webPackageRef: ref };
    const projected = buildArenaRoomSharedConfig({ ...working, webPackageRef: { ...ref, secret: 'omit' } } as typeof working);
    expect(projected.webPackageRef).toEqual(ref);
    const changes = diffArenaSharedConfig(base, working);
    expect(changes.map((change) => change.type)).toEqual(['setReportFormat', 'setWebPackageRef']);
    expect(changes.map((change) => change.atomicGroupId)).toEqual(['web-package-format', 'web-package-format']);
    const applied = applyArenaProposal({ roomId: 'room-1', config: base, revision: 1 }, proposal(changes));
    expect(applied).toMatchObject({ status: 'accepted', revision: 2, config: working });
    expect(base).not.toHaveProperty('webPackageRef');
    expect(collaborativeChangeTarget(changes[1]!)).toBe('web-package');
    expect(hasCollaborativeChangeEffect(working, changes[1]!)).toBe(true);
    expect(hasCollaborativeChangeEffect(base, changes[1]!)).toBe(false);
    const restored = applyArenaProposal({ roomId: 'room-1', config: working, revision: 2 }, proposal(diffArenaSharedConfig(working, base)));
    expect(restored).toMatchObject({ status: 'accepted', revision: 3, config: base });
    expect(restored.config).not.toHaveProperty('webPackageRef');
  });

  it('treats digest changes as conflicts and retains immutable proposal values', () => {
    const base = { ...baseConfig(), reportFormat: 'web' as const, webPackageRef: ref };
    const next = { ...base, webPackageRef: { ...ref, digest: `sha256:${'b'.repeat(64)}` } };
    const changes = diffArenaSharedConfig(base, next);
    expect(changes).toMatchObject([{ type: 'setWebPackageRef', expectedBase: { value: ref } }]);
    const current = { ...base, webPackageRef: { ...ref, digest: `sha256:${'c'.repeat(64)}` } };
    const applied = applyArenaProposal({ roomId: 'room-1', config: current, revision: 3 }, proposal(changes));
    expect(applied.config).toEqual(current);
    expect(applied.conflicts).toHaveLength(1);
    next.webPackageRef.digest = `sha256:${'d'.repeat(64)}`;
    expect(changes[0]).toMatchObject({ value: { digest: `sha256:${'b'.repeat(64)}` } });
  });

  it('projects legacy configs as Markdown and publishes Web explicitly', () => {
    const legacy = { ...baseConfig(), reportFormat: undefined };
    expect(buildArenaRoomSharedConfig(legacy).reportFormat).toBe('markdown');
    expect(diffArenaSharedConfig(legacy, baseConfig())).toEqual([]);
    expect(buildArenaRoomSharedConfig({ ...legacy, reportFormat: 'web' }).reportFormat).toBe('web');
  });

  it('rejects non-server-shareable web package refs when the host injects the predicate', () => {
    const base = baseConfig();
    const localOnly = { id: 'local.demo', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` };
    const changes = diffArenaSharedConfig(base, {
      ...base, reportFormat: 'web' as const, webPackageRef: localOnly,
    });
    const applied = applyArenaProposal({ roomId: 'room-1', config: base, revision: 1 },
      proposal(changes), undefined, { isServerShareableWebPackageRef: () => false });
    expect(applied.status).toBe('rejected');
    expect(applied.issues.some((issue) => issue.message.includes('not server-shareable'))).toBe(true);
    expect(base).not.toHaveProperty('webPackageRef');
    const allowed = applyArenaProposal({ roomId: 'room-1', config: base, revision: 1 },
      proposal(changes), undefined, { isServerShareableWebPackageRef: () => true });
    expect(allowed.status).toBe('accepted');
    expect(allowed.config.webPackageRef).toEqual(localOnly);
  });

  it('applies format proposals with revision, no-op and provenance semantics', () => {
    const base = baseConfig();
    const web = { ...base, reportFormat: 'web' as const };
    const changes = diffArenaSharedConfig(base, web);
    expect(changes).toEqual([{
      changeId: 'change-1', type: 'setReportFormat', value: 'web',
      expectedBase: { kind: 'value', value: 'markdown' },
    }]);
    const result = applyArenaProposal({ roomId: 'room-1', config: base, revision: 4 },
      proposal(changes), ['change-1']);
    expect(result).toMatchObject({ status: 'accepted', revision: 5, config: web });
    expect(base.reportFormat).toBe('markdown');
    const satisfied = applyArenaProposal({ roomId: 'room-1', config: web, revision: 5 },
      proposal(changes), ['change-1']);
    expect(satisfied).toMatchObject({ status: 'accepted', revision: 5, satisfiedChangeIds: ['change-1'] });
    expect(collaborativeChangeTarget(changes[0]!)).toBe('report-format');
    expect(hasCollaborativeChangeEffect(web, changes[0]!)).toBe(true);
    expect(hasCollaborativeChangeEffect(base, changes[0]!)).toBe(false);
  });
});
