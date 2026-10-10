// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { GenerationModeSwitcher } from '../src/details-controls/GenerationModeSwitcher';
import { ArenaDataSettingsPanel, type ArenaDataSettingsValue } from '../src/arena/ArenaDataSettingsPanel';

const value: ArenaDataSettingsValue = {
  readArenaHistory: true, readArenaHistoryLimit: 10, isArenaHistoryUnlimited: false,
  writeArenaHistory: true, readCurrentState: true, writeCurrentState: true,
};

describe('Arena character write capability', () => {
  it('disables only the two writes with an accessible explanation and preserves the original Web default', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const onChange = vi.fn();
    const writes = () => [...container.querySelectorAll('label')].filter((label) => label.textContent?.includes('战报后写入')).map((label) => label.querySelector('input')!);
    const reads = () => [...container.querySelectorAll('label')].filter((label) => label.textContent?.trim() === '生成时读取').map((label) => label.querySelector('input')!);
    try {
      await act(async () => root.render(<ArenaDataSettingsPanel value={value} onChange={onChange} writeDisabledReason="服务器角色更新尚未接通" />));
      expect(writes()).toHaveLength(2); expect(reads()).toHaveLength(2);
      for (const input of writes()) {
        expect(input.disabled).toBe(true); expect(input.checked).toBe(true);
        expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('服务器角色更新尚未接通');
        await act(async () => input.click());
      }
      expect(onChange).not.toHaveBeenCalled(); expect(reads().every((input) => !input.disabled)).toBe(true);
      await act(async () => reads()[0]!.click()); expect(onChange).toHaveBeenLastCalledWith({ readArenaHistory: false });
      await act(async () => root.render(<ArenaDataSettingsPanel value={value} onChange={onChange} />));
      expect(writes().every((input) => !input.disabled && input.checked)).toBe(true);
      expect(container.textContent).not.toContain('服务器角色更新尚未接通');
      await act(async () => writes()[0]!.click()); expect(onChange).toHaveBeenLastCalledWith({ writeArenaHistory: false });
      await act(async () => root.render(<ArenaDataSettingsPanel value={value} onChange={onChange} disabled />));
      expect(writes().every((input) => input.disabled)).toBe(true); expect(reads().every((input) => input.disabled)).toBe(true);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});

it('allows the Desktop capability description without changing the Web default', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<GenerationModeSwitcher value="stream" onChange={() => undefined} optionDescriptions={{ stream: '仅显示安全源码，不执行网页' }} />));
    expect(container.textContent).toContain('仅显示安全源码，不执行网页'); expect(container.textContent).not.toContain('展示互动页面');
    await act(async () => root.render(<GenerationModeSwitcher value="stream" onChange={() => undefined} />));
    expect(container.textContent).toContain('展示互动页面');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
