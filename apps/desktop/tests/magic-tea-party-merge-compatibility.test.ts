import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIpcTeaNativePort } from '../src/platform/magic-tea-party-native';
import { startMagicTeaPartyJourneyProbe } from './helpers/magic-tea-party-journey-probe';

// The legacy binary must be built from the real fork-capable 54c617a source, not a pre-fork validator.
describe.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY || !process.env.MAHO_TEA_LEGACY_JOURNEY_BINARY)('real pre-merge Tea reader and permanent receipt barrier', () => {
  it('allows fork before merge, rejects after merge and deletion, and validates old/new backup restore boundaries', async () => {
    let current = await startMagicTeaPartyJourneyProbe({ keepRoot: true }); const root = current.root;
    let old: Awaited<ReturnType<typeof startMagicTeaPartyJourneyProbe>> | undefined;
    let oldRoot: string | undefined;
    const record = async (sessionId: string) => {
      const r = (await createIpcTeaNativePort(current.invoke).read({ version: 1, request: { action: 'session', sessionId, expectedCatalogRevision: null } })).result;
      if (r.action !== 'session' || !r.record) throw new Error('Missing fixture'); return r.record;
    };
    const rejectOld = async () => {
      const bytes = readFileSync(join(root, 'library.sqlite')); let diagnostic = '';
      await expect(startMagicTeaPartyJourneyProbe({ root, keepRoot: true, binary: process.env.MAHO_TEA_LEGACY_JOURNEY_BINARY,
        onDiagnostic: text => { diagnostic += text; } })).rejects.toThrow();
      expect(diagnostic).toContain('UpgradeBackup(Corrupt)'); expect(readFileSync(join(root, 'library.sqlite'))).toEqual(bytes);
    };
    try {
      let port = createIpcTeaNativePort(current.invoke);
      await port.mutate({ version: 1, request: { action: 'import', operationId: 'merge-compat-import', entries: [{
        session: { id: 'parent', title: '父', createdAt: 1, updatedAt: 1, roles: [], settings: { providerId: 'p', modelId: 'm' } },
        messages: [{ id: 'anchor', sessionId: 'parent', role: 'user', content: '原文', createdAt: 1 }],
      }] } });
      const parent = await record('parent');
      await port.mutate({ version: 1, request: { action: 'fork', operationId: 'merge-compat-fork', sessionId: 'parent', instance: parent.instance,
        expectedRevision: parent.revision, anchorMessageId: 'anchor', editedContent: '分支', targetSessionId: 'child' } });
      const before = await current.control('snapshot');
      const preBackup = await current.control('checkpoint', { action: 'backup' }) as { backupId: string; absolutePath: string };
      await current.close();
      old = await startMagicTeaPartyJourneyProbe({ root, binary: process.env.MAHO_TEA_LEGACY_JOURNEY_BINARY, keepRoot: true });
      expect(await old.control('snapshot')).toEqual(before);
      const oldPort = createIpcTeaNativePort(old.invoke);
      const oldRead = (await oldPort.read({ version: 1, request: { action: 'session', sessionId: 'child', expectedCatalogRevision: null } })).result;
      if (oldRead.action !== 'session' || !oldRead.record) throw new Error('Fork-capable legacy reader required');
      await oldPort.mutate({ version: 1, request: { action: 'update', sessionId: 'child', instance: oldRead.record.instance,
        expectedRevision: oldRead.record.revision, session: { ...oldRead.record.session, title: '旧版可写' } } });
      await old.control('checkpoint', { action: 'prepare-restore', backupId: preBackup.backupId }); await old.control('reopen');
      expect(await old.control('snapshot')).toEqual(before); await old.close();
      current = await startMagicTeaPartyJourneyProbe({ root, keepRoot: true }); port = createIpcTeaNativePort(current.invoke);
      const child = await record('child');
      const p = (await port.read({ version: 1, request: { action: 'merge-preview', source: { sessionId: 'child', instance: child.instance, expectedRevision: child.revision } } })).result;
      if (p.action !== 'merge-preview') throw new Error('Missing preview');
      const merge = { version: 1 as const, request: { action: 'merge' as const, operationId: 'merge-permanent', source: p.source, parent: p.parent, anchorMessageId: p.anchorMessageId, editedMessageId: p.editedMessageId } };
      const saved = await port.mutate(merge);
      const after = await current.control('snapshot');
      const backup = await current.control('checkpoint', { action: 'backup' }) as { backupId: string; absolutePath: string };
      await current.close(); await rejectOld();
      old = await startMagicTeaPartyJourneyProbe({ binary: process.env.MAHO_TEA_LEGACY_JOURNEY_BINARY, keepRoot: true }); oldRoot = old.root;
      const destination = join(oldRoot, 'backups', backup.backupId); cpSync(backup.absolutePath, destination, { recursive: true, errorOnExist: true });
      const oldBefore = await old.control('snapshot'); const backupBytes = readFileSync(join(destination, 'library.sqlite'));
      await expect(old.control('checkpoint', { action: 'prepare-restore', backupId: backup.backupId })).rejects.toMatchObject({ code: 'tea-io' });
      expect(await old.control('snapshot')).toEqual(oldBefore); expect(readFileSync(join(destination, 'library.sqlite'))).toEqual(backupBytes);
      expect(existsSync(join(oldRoot, 'restore.intent'))).toBe(false); await old.close();
      current = await startMagicTeaPartyJourneyProbe({ root, keepRoot: true });
      expect(await current.control('snapshot')).toEqual(after);
      for (const sessionId of ['parent', 'child']) {
        port = createIpcTeaNativePort(current.invoke); const row = await record(sessionId);
        await port.mutate({ version: 1, request: { action: 'delete', sessionId, instance: row.instance, expectedRevision: row.revision } });
        const receipt = (await port.read({ version: 1, request: { action: 'receipt', write: merge } })).result;
        expect(receipt.action === 'receipt' && receipt.receipt?.result).toEqual(saved.result);
        await current.close(); await rejectOld();
        current = await startMagicTeaPartyJourneyProbe({ root, keepRoot: true });
        const missing = (await createIpcTeaNativePort(current.invoke).read({ version: 1, request: { action: 'session', sessionId, expectedCatalogRevision: null } })).result;
        expect(missing.action === 'session' && missing.record).toBeNull();
      }
      await current.control('checkpoint', { action: 'prepare-restore', backupId: backup.backupId }); await current.control('reopen');
      expect(await current.control('snapshot')).toEqual(after);
      expect(await createIpcTeaNativePort(current.invoke).mutate(merge)).toEqual(saved);
    } finally {
      await current.close().catch(() => {}); await old?.close().catch(() => {});
      rmSync(root, { recursive: true, force: true }); if (oldRoot) rmSync(oldRoot, { recursive: true, force: true });
    }
  }, 90000);
});
