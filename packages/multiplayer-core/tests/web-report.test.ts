import { describe, expect, it } from 'vitest';

import { applyArenaProposal, buildArenaRoomSharedConfig, diffArenaSharedConfig } from '../src/index';
import { collaborativeChangeTarget, hasCollaborativeChangeEffect } from '../src/provenance';
import { baseConfig, proposal } from './state-machine-fixtures';

describe('Web report room semantics', () => {
  it('projects legacy configs as Markdown and publishes Web explicitly', () => {
    const legacy = { ...baseConfig(), reportFormat: undefined };
    expect(buildArenaRoomSharedConfig(legacy).reportFormat).toBe('markdown');
    expect(diffArenaSharedConfig(legacy, baseConfig())).toEqual([]);
    expect(buildArenaRoomSharedConfig({ ...legacy, reportFormat: 'web' }).reportFormat).toBe('web');
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
