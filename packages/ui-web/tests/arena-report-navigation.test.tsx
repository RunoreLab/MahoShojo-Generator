// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { BattleReportCard, StreamingBattleReportCard, type BattleReportHostPorts, type NewsReport } from '../src/arena-report';

const content = '[外部](https://example.com/report)\n\n[相对](/arena)\n\n[邮件](mailto:test@example.com)\n\n[片段](#heading)\n\n[省略协议](//example.com/relative)\n\n[音频](https://media.example/a.mp3)\n\n[视频](https://media.example/a.mp4)\n\n![音频图片](https://media.example/b.mp3)\n\n![视频图片](https://media.example/b.mp4)';
const media: BattleReportHostPorts['mediaPolicy'] = { detectKind: (url) => url.endsWith('.mp3') ? 'audio' : url.endsWith('.mp4') ? 'video' : null, isAllowed: () => true, resolve: (url) => url };
const report: NewsReport = { headline: '报告', reporterInfo: { name: '记者', publication: '日报' }, article: { body: content, analysis: '' }, officialReport: { winner: '', conclusion: '' } };
const views: Array<[string, (ports: BattleReportHostPorts) => ReactElement]> = [
  ['structured', (ports) => <BattleReportCard report={report} ports={ports} />],
  ['streaming', (ports) => <StreamingBattleReportCard content={content} ports={ports} />],
];
describe('report navigation delegates to the existing host confirmation port', () => {
  it.each(views)('%s routes every link and alternate activation without native fallback', async (_name, render) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); const navigate = vi.fn();
    try {
      await act(async () => root.render(render({ mediaPolicy: media, onNavigateExternal: navigate })));
      const anchors = [...container.querySelectorAll<HTMLAnchorElement>('a')];
      expect(anchors).toHaveLength(9);
      for (const anchor of anchors) {
        expect(anchor.hasAttribute('href')).toBe(false); expect(anchor.getAttribute('role')).toBe('link'); expect(anchor.tabIndex).toBe(0);
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
        await act(async () => anchor.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true);
      }
      expect(navigate.mock.calls.map(([url]) => url)).toEqual(['https://example.com/report', '/arena', 'mailto:test@example.com', '#heading', 'https://example.com/relative', 'https://media.example/a.mp3', 'https://media.example/a.mp4', 'https://media.example/b.mp3', 'https://media.example/b.mp4']);
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      await act(async () => anchors[0].dispatchEvent(enter)); expect(enter.defaultPrevented).toBe(true);
      const middle = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
      await act(async () => anchors[0].dispatchEvent(middle)); expect(middle.defaultPrevented).toBe(true);
      expect(navigate).toHaveBeenCalledTimes(11);
      await act(async () => anchors[0].dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true })));
      expect(navigate).toHaveBeenCalledTimes(11);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
  it.each(views)('%s without a port preserves Web href, target, rel and default activation', async (_name, render) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    try {
      await act(async () => root.render(render({ mediaPolicy: media })));
      const external = container.querySelector<HTMLAnchorElement>('a[href="https://example.com/report"]')!;
      expect(external.target).toBe('_blank'); expect(external.rel).toBe('noopener noreferrer'); expect(external.hasAttribute('role')).toBe(false);
      expect(container.querySelector('a[href="/arena"]')).not.toBeNull();
      expect(container.querySelector('a[href="mailto:test@example.com"]')).not.toBeNull();
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      await act(async () => external.dispatchEvent(event)); expect(event.defaultPrevented).toBe(false);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
