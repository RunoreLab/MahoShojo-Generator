// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ runtime: null as any }));
vi.mock('@/components/arena/multiplayer/useArenaRoom', () => ({ useArenaRoomContext: () => mock.runtime }));
vi.mock('@/components/arena/components/BattleResultPresentation', () => ({ BattleResultPresentation: () => <article>战报</article> }));
vi.mock('@/components/arena/multiplayer/ArenaRoomLatestHistoryResult', () => ({ ArenaRoomLatestHistoryResult: () => <article>历史</article> }));
import { ArenaMultiplayerContextResult } from '@/components/arena/multiplayer/ArenaMultiplayerPanel';
let root: Root; let container: HTMLDivElement;
const scroll = vi.fn();
const update = async (id: string | null, markdown = '', phase = 'running', format = 'stream-markdown', previewId = id, configuration = { revision: 1, configRevision: 1, reportFormat: format === 'stream-web' ? 'web' : 'markdown' }) => {
  const mirror = id ? { generationId: id, attempt: 1, state: phase, configRevision: configuration.configRevision } : null;
  mock.runtime = { controller: {}, state: {
    session: { roomId: 'room-1', roomEpoch: 'epoch-1', snapshot: { activeGeneration: mirror, revision: configuration.revision, sharedConfig: { reportFormat: configuration.reportFormat } } },
    generation: { mirror: previewId ? { generationId: previewId, attempt: 1 } : null, phase, markdown,
      result: phase === 'completed' ? { format } : null, finalAuthoritative: phase === 'completed', errorCode: null, gap: null },
  } };
  await act(async () => root.render(<ArenaMultiplayerContextResult />));
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); mock.runtime = null;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: innerHeight + 300 } as DOMRect);
  Element.prototype.scrollIntoView = scroll;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('多人实时战报导航', () => {
  it('初次进入或恢复已有结果不滚，新权威generation首段滚一次', async () => {
    await update('old', '历史正文', 'completed'); expect(scroll).not.toHaveBeenCalled();
    await update('new', '', 'starting'); expect(scroll).not.toHaveBeenCalled();
    await update('new', '首段'); expect(scroll).toHaveBeenCalledTimes(1); await update('new', '首段+后续'); await update('new', '最终', 'completed');
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('权威新generation与旧预览不匹配时不滚，取消残文不滚', async () => {
    await update('old', '旧正文', 'completed');
    await update('new', '旧正文', 'running', 'stream-markdown', 'old'); expect(scroll).not.toHaveBeenCalled();
    await update('new', '残文', 'cancelled'); expect(scroll).not.toHaveBeenCalled();
  });
  it('网页源码等待权威完成才定位', async () => {
    await update(null, '', 'idle'); await update('new', '<html>源码', 'running', 'stream-web');
    expect(scroll).not.toHaveBeenCalled();
    await update('new', '<html>源码</html>', 'completed', 'stream-web'); expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('配置revision不匹配时不猜格式，等待该结果的权威输出合同', async () => {
    await update(null, '', 'idle');
    await update('new', '<html>源码', 'running', 'stream-web', 'new', { revision: 2, configRevision: 1, reportFormat: 'markdown' });
    expect(scroll).not.toHaveBeenCalled();
    await update('new', '<html>完成</html>', 'completed', 'stream-web', 'new', { revision: 2, configRevision: 1, reportFormat: 'markdown' });
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('新请求开始时冻结格式，生成中编辑下一次配置不提前导航HTML', async () => {
    await update(null, '', 'idle');
    await update('new', '', 'starting', 'stream-web');
    await update('new', '<html>源码', 'running', 'stream-web', 'new', { revision: 2, configRevision: 1, reportFormat: 'markdown' });
    expect(scroll).not.toHaveBeenCalled();
    await update('new', '<html>完成</html>', 'completed', 'stream-web');
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('异步加入已有活跃战报不误认作新请求', async () => {
    await act(async () => root.render(<ArenaMultiplayerContextResult />));
    await update('existing', '已存在正文'); await update('existing', '恢复完整正文', 'completed');
    expect(scroll).not.toHaveBeenCalled();
  });
});
