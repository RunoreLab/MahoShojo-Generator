// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { BattleModeSelector } from '@/components/shared/BattleModeSelector';
import { GenerationModeSwitcher } from '@/components/shared/GenerationModeSwitcher';

it('共享开关关联说明、暴露选中状态，点击不会提交所在表单', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const change = vi.fn();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  try {
    await act(async () => root.render(
      <form onSubmit={submit}>
        <BattleModeSelector value="classic" onChange={change} showHelper={false} />
        <GenerationModeSwitcher value="non-stream" onChange={change} helper={false} />
      </form>,
    ));
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(2);
    for (const button of buttons) {
      expect(button.title).not.toBe('');
      expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(button.title);
      expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    await act(async () => buttons[0].click());
    await act(async () => buttons[5].click());
    expect(change.mock.calls).toEqual([['daily'], ['stream']]);
    expect(submit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
