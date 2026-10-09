// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportTavernFile, saveDesktopTavernCard } from '../src/features/tavern/host';
import { convertTavernToGeneralCard, readTavernLocalDocument, type TavernCardCandidate } from '@mahoshojo/domain/tavern-card';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { webcrypto } from 'node:crypto';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Desktop Tavern host adapter', () => {
  it('dispatches local PNG through the existing download path and retains the URL for WebView2', () => {
    vi.useFakeTimers(); const create = vi.fn(() => 'blob:local-png'); const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { expect(this.download).toBe('tavern.png'); expect(this.href).toBe('blob:local-png'); });
    exportTavernFile({ name: 'tavern.png', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' });
    expect(click).toHaveBeenCalledTimes(1); expect(document.querySelector('a')).toBeNull(); expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000); expect(revoke).toHaveBeenCalledWith('blob:local-png'); expect(create.mock.calls[0][0].type).toBe('image/png');
  });
  it('saves imported unsigned data through CardRepository and preserves a readable original', async () => {
    vi.stubGlobal('crypto', webcrypto); let saved!: LocalCardRecordV1;
    const repository = { putIfAbsent: vi.fn(async (record) => { saved = record; return { written: true }; }) } as unknown as CardRepository;
    const candidate: TavernCardCandidate = { keyword: 'json', chunkType: 'tEXt', parseMethod: 'json', parsed: { name: '测试', description: 'description', signature: 'unverified', custom: { keep: true } } };
    const data = convertTavernToGeneralCard(candidate);
    expect(await saveDesktopTavernCard(repository, data)).toBe('saved'); expect(saved.provenance).toEqual({ kind: 'unsigned', execution: 'imported' });
    expect(readTavernLocalDocument(new TextEncoder().encode(JSON.stringify(saved.data)), 'json').candidates[0].parsed).toEqual(candidate.parsed);
  });
});
