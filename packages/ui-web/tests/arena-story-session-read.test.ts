import { describe, expect, it, vi } from 'vitest';

import { createBattleStorySessionReader } from '../src/arena-story-session-read';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const session = { id: 'A', extra: { unknown: ['preserved'] } };
  const chapters = [{ id: 'last', index: 2, body: { untouched: true } }, { id: 'first', index: 1 }];
  const checkpoints = [{ boundaryIndex: 2, extra: 'two' }, { boundaryIndex: 0, extra: 'zero' }];
  const ports = {
    listSessions: vi.fn(async () => [session]),
    getSession: vi.fn(async () => session),
    listChapters: vi.fn(async () => chapters),
    listCheckpoints: vi.fn(async () => checkpoints),
    readPreferredId: vi.fn(() => null as string | null),
    writePreferredId: vi.fn(),
  };
  const publish = { list: vi.fn(), selection: vi.fn() };
  return { session, chapters, checkpoints, ports, publish, reader: createBattleStorySessionReader(ports, publish) };
}

describe('feature-local battle story session reader', () => {
  it('only sorts arrays, preserving whole records and last-chapter fallback', async () => {
    const f = fixture(); await f.reader.select('A');
    const snapshot = f.publish.selection.mock.calls[0]![0];
    expect(snapshot.session).toBe(f.session);
    expect(snapshot.chapters).toEqual([f.chapters[1], f.chapters[0]]);
    expect(snapshot.chapters[1]).toBe(f.chapters[0]);
    expect(snapshot.checkpoints).toEqual([f.checkpoints[1], f.checkpoints[0]]);
    expect(snapshot.checkpoints[1]).toBe(f.checkpoints[0]);
    expect(snapshot.selectedChapterId).toBe('last');
    expect(f.chapters.map((item) => item.index)).toEqual([2, 1]);
  });

  it.each(['resolve', 'reject'] as const)('invalidate suppresses late %s for both read lanes without clearing', async (outcome) => {
    const f = fixture(); const list = deferred<typeof f.session[]>(); const detail = deferred<typeof f.session>();
    f.ports.listSessions.mockReturnValueOnce(list.promise); f.ports.getSession.mockReturnValueOnce(detail.promise);
    const pendingList = f.reader.refreshList(); const pendingDetail = f.reader.select('A');
    f.reader.invalidate();
    if (outcome === 'resolve') { list.resolve([f.session]); detail.resolve(f.session); }
    else { list.reject(new Error('old list')); detail.reject(new Error('old detail')); }
    expect(await pendingList).toBeNull(); await pendingDetail;
    expect(f.publish.list).not.toHaveBeenCalled(); expect(f.publish.selection).not.toHaveBeenCalled();
    expect(f.ports.writePreferredId).not.toHaveBeenCalled();
    await f.reader.select('A'); expect(f.publish.selection).toHaveBeenCalledTimes(1);
  });

  it('dispose is terminal, including future calls through stale host references', async () => {
    const f = fixture(); const late = deferred<typeof f.session[]>(); f.ports.listSessions.mockReturnValueOnce(late.promise);
    const callbacks = { onError: vi.fn(), onReady: vi.fn() };
    const pending = f.reader.restore(callbacks); f.reader.dispose(); late.resolve([f.session]); await pending;
    await f.reader.select('A'); await f.reader.restore(callbacks); expect(await f.reader.refreshList()).toBeNull();
    expect(f.ports.listSessions).toHaveBeenCalledTimes(1); expect(f.ports.getSession).not.toHaveBeenCalled();
    expect(f.publish.list).not.toHaveBeenCalled(); expect(f.publish.selection).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled(); expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(f.ports.writePreferredId).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('new list read supersedes old %s without invalidating detail intent', async (outcome) => {
    const f = fixture(); const list = deferred<typeof f.session[]>(); const detail = deferred<typeof f.session>();
    f.ports.listSessions.mockReturnValueOnce(list.promise); f.ports.getSession.mockReturnValueOnce(detail.promise);
    const older = f.reader.refreshList(); const selection = f.reader.select('A');
    expect(await f.reader.refreshList()).toEqual([f.session]);
    if (outcome === 'resolve') list.resolve([]); else list.reject(new Error('old list'));
    expect(await older).toEqual(outcome === 'resolve' ? [] : null); detail.resolve(f.session); await selection;
    expect(f.publish.list).toHaveBeenCalledExactlyOnceWith([f.session]);
    expect(f.publish.selection).toHaveBeenCalledTimes(1); expect(f.ports.writePreferredId).toHaveBeenCalledWith('A');
  });

  it.each(['getSession', 'listChapters', 'listCheckpoints'] as const)('current %s failure publishes no partial or empty snapshot', async (port) => {
    const f = fixture(); const cause = new Error('read failed'); f.ports[port].mockRejectedValueOnce(cause);
    const onError = vi.fn(); await f.reader.select('A', onError);
    expect(onError).toHaveBeenCalledExactlyOnceWith(cause);
    expect(f.publish.selection).not.toHaveBeenCalled(); expect(f.ports.writePreferredId).not.toHaveBeenCalled();
    f.ports[port].mockRejectedValueOnce(cause); await expect(f.reader.select('A')).rejects.toBe(cause);
  });
});
