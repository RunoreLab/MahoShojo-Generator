import { describe, expect, it } from 'vitest';
import type { TeaMessageDocument, TeaSessionDocument } from '@mahoshojo/contracts/desktop-magic-tea-party';
import { DesktopTeaSession } from '../src/features/magic-tea-party/session';
import { readTeaMessagePages } from '../src/features/magic-tea-party/direct';
import { createIpcTeaNativePort } from '../src/platform/magic-tea-party-native';
import { startMagicTeaPartyJourneyProbe } from './helpers/magic-tea-party-journey-probe';
import type { ResolvedDesktopAiTarget } from '../src/features/ai-config/desktop-ai-config';
const target: ResolvedDesktopAiTarget = { location: 'client', providerTarget: { kind: 'custom', profileId: 'tea-loopback' }, profile: null,
  mode: 'direct-local', modelId: 'synthetic', availableModelIds: ['synthetic'], generationOverrides: undefined, unavailableReason: null };

describe.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('real Native Tea reviewed merge journey', () => {
  it('merges the full ordinal tail, recovers a lost reply, reopens, and sends only active history through actual Direct HTTP', async () => {
    const probe = await startMagicTeaPartyJourneyProbe(); const port = createIpcTeaNativePort(probe.invoke); let sequence = 0;
    const owner = new DesktopTeaSession(port, () => `merge-journey-${++sequence}`);
    const readRecord = async (sessionId: string) => {
      const result = (await port.read({ version: 1, request: { action: 'session', sessionId, expectedCatalogRevision: null } })).result;
      if (result.action !== 'session' || !result.record) throw new Error('Missing test session'); return result.record;
    };
    const readMessages = async (sessionId: string) => {
      const all: TeaMessageDocument[] = []; for await (const page of readTeaMessagePages(port, await readRecord(sessionId), () => true)) all.push(...page.rows.map(row => row.message)); return all;
    };
    try {
      const session: TeaSessionDocument = { id: 'parent', title: '父会话', createdAt: 1, updatedAt: 1,
        roles: [{ id: 'r', name: '星光', source: 'local', card: { name: '星光' } }], settings: { providerId: 'synthetic', modelId: 'synthetic', outputFormat: 'markdown', autoSummaryEnabled: false },
        summary: '旧尾摘要不可使用', summaryMeta: { updatedAt: 1, toMessageId: 'm-105' }, draft: '', lastChoices: [{ id: 'c', text: '旧选项' }],
        autoSummaryState: { lastAttemptMessageId: 'm-105' }, protocolShadow: { future: true }, updateSnapshot: { future: true }, pinnedAt: 9, pinnedOrder: 8 };
      const messages: TeaMessageDocument[] = Array.from({ length: 108 }, (_, i) => ({ id: `m-${i}`, sessionId: 'parent', role: i % 2 ? 'assistant' : 'user',
        content: i === 0 ? '保留的父前缀' : i >= 2 ? '旧尾禁止进入模型' : '前缀答复', createdAt: 200 - i, status: 'done',
        ...(i === 5 ? { meta: { superseded: true, supersededBy: 'prior-edit', supersededBySessionId: 'prior-branch', supersededAt: 3 } } : {}) }));
      await port.mutate({ version: 1, request: { action: 'import', operationId: 'merge-import', entries: [{ session, messages }] } });
      const initial = await readRecord('parent');
      await port.mutate({ version: 1, request: { action: 'fork', operationId: 'merge-fork', sessionId: 'parent', instance: initial.instance,
        expectedRevision: initial.revision, anchorMessageId: 'm-2', editedContent: '合并后的新问题', targetSessionId: 'child' } });
      const sourceBefore = await readRecord('child'); const sourceMessages = await readMessages('child');
      await owner.select('child'); expect(await owner.prepareMerge()).toBe(true);
      const preview = owner.getSnapshot().mergePreview!;
      expect(preview).toMatchObject({ replacedMessageCount: 106, copiedMessageCount: 1, anchorMessageId: 'm-2' });
      owner.cancelMerge(); expect(await readRecord('parent')).toEqual(initial);
      expect(await owner.prepareMerge()).toBe(true);
      await probe.control('drop-next-write-reply'); // The next mutation is the reviewed merge.
      expect(await owner.confirmMerge(owner.getSnapshot().mergePreview!)).toBe(false); expect(owner.getSnapshot().pending).toBe('unknown');
      const writes = probe.trace.filter(row => row.command === 'mutate_magic_tea_party').length;
      await owner.retryPending(); expect(probe.trace.filter(row => row.command === 'mutate_magic_tea_party')).toHaveLength(writes);
      await owner.resolvePending(); expect(owner.getSnapshot().record?.session.id).toBe('parent');
      const merged = await readRecord('parent'); expect(merged.revision).toBe(initial.revision + 1);
      expect(merged.session).toMatchObject({ pinnedAt: 9, pinnedOrder: 8, protocolShadow: session.protocolShadow, updateSnapshot: session.updateSnapshot });
      expect(merged.session.summary).toBeUndefined(); expect(merged.session.lastChoices).toBeUndefined(); expect(merged.session.autoSummaryState).toBeUndefined();
      const full = await readMessages('parent'); expect(full).toHaveLength(109);
      expect(full.slice(2, 108).every(message => message.meta?.superseded)).toBe(true);
      expect(full[5]).toMatchObject({ meta: { supersededBy: 'prior-edit', supersededBySessionId: 'prior-branch', supersededAt: 3 } });
      expect(full.at(-1)).toMatchObject({ content: '合并后的新问题', revisionOf: 'm-2' });
      expect(await readRecord('child')).toEqual(sourceBefore); expect(await readMessages('child')).toEqual(sourceMessages);
      await probe.control('reopen'); await owner.select('parent');
      owner.setInput('继续合并后的剧情'); await owner.start(target, probe.aiOptions, () => true);
      expect(owner.getSnapshot().error).toBeNull();
      const observed = await probe.control('requestCount') as { count: number; requests: unknown[] };
      expect(observed.count).toBe(1); const request = JSON.stringify(observed.requests);
      expect(request).toContain('保留的父前缀'); expect(request).toContain('合并后的新问题');
      expect(request).not.toContain('旧尾禁止进入模型'); expect(request).not.toContain('旧尾摘要不可使用');
      const archive = await owner.export('archive'); expect(archive).toContain('旧尾禁止进入模型');
      await owner.importText(archive, 'json', () => true); expect(owner.getSnapshot().error).toBeNull();
      const imported = owner.getSnapshot().directory.find(row => !['parent', 'child'].includes(row.id) && row.messageCount === 3)!;
      expect(imported).toBeTruthy(); await owner.select(imported.id);
      expect(owner.getSnapshot().record?.session.forkedFrom?.sessionId).not.toBe('parent');
      expect(await owner.prepareMerge()).toBe(false); // The imported direct parent anchor remains superseded.
    } finally { owner.dispose(); await probe.close(); }
  }, 60000);
  it('explicitly reviews a remapped same-archive parent while rejecting an unresolved single-child import', async () => {
    const probe = await startMagicTeaPartyJourneyProbe(); const port = createIpcTeaNativePort(probe.invoke); let sequence = 0;
    const owner = new DesktopTeaSession(port, () => `merge-imported-${++sequence}`);
    try {
      await port.mutate({ version: 1, request: { action: 'import', operationId: 'pair-import', entries: [{
        session: { id: 'original', title: '父会话', createdAt: 1, updatedAt: 1, roles: [], settings: { providerId: 'p', modelId: 'm' } },
        messages: ['a', 'b', 'c'].map(id => ({ id, sessionId: 'original', role: 'user' as const, content: id, createdAt: 1 })),
      }] } });
      await owner.select('original'); const initial = owner.getSnapshot().record!;
      await port.mutate({ version: 1, request: { action: 'fork', operationId: 'pair-fork', sessionId: 'original', instance: initial.instance,
        expectedRevision: initial.revision, anchorMessageId: 'b', editedContent: '改写', targetSessionId: 'branch' } });
      await owner.select('branch'); const single = await owner.export('json'); const archive = await owner.export('archive');
      await owner.importText(archive, 'json', () => true);
      const paired = owner.getSnapshot().directory.find(row => !['original', 'branch'].includes(row.id) && row.messageCount === 2)!;
      expect(paired).toBeTruthy(); await owner.select(paired.id);
      expect(await owner.prepareMerge()).toBe(true); const preview = owner.getSnapshot().mergePreview!;
      expect(preview.parent.sessionId).not.toBe('original'); expect(preview.anchorMessageId).not.toBe('b');
      expect(await owner.confirmMerge(preview)).toBe(true); expect(owner.getSnapshot().record?.session.id).toBe(preview.parent.sessionId);
      const known = new Set(owner.getSnapshot().directory.map(row => row.id));
      await owner.importText(single, 'json', () => true);
      const orphan = owner.getSnapshot().directory.find(row => !known.has(row.id))!; expect(orphan).toBeTruthy(); await owner.select(orphan.id);
      expect(owner.getSnapshot().record?.session.forkedFrom).toBeUndefined();
      const before = await probe.control('snapshot'); expect(await owner.prepareMerge()).toBe(false);
      expect(await probe.control('snapshot')).toEqual(before);
      expect(await probe.control('requestCount')).toMatchObject({ count: 0 });
    } finally { owner.dispose(); await probe.close(); }
  }, 30000);
});
