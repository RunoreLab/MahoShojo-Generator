// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import { dataCardApi } from '@/lib/auth';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@/lib/auth', () => ({ dataCardApi: {
  getCardsDetailed: vi.fn(async () => ({ success: true, cards: [] })),
  getUserCapacity: vi.fn(async () => ({ capacity: 20, usedSlots: 2 })),
} }));
vi.mock('@/components/CharManager/SaveCardModal', () => ({ default: () => null }));
vi.mock('@/components/CharManager/DataCardsModal', () => ({ default: () => null }));

test('挂载不读卡片，保存只读容量，打开替换列表由摘要分页组件读取', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<SaveToCloudButton data={{ name: '测试角色' }} />); });
    expect(dataCardApi.getCardsDetailed).not.toHaveBeenCalled();
    expect(dataCardApi.getUserCapacity).not.toHaveBeenCalled();
    await act(async () => { container.querySelectorAll('button')[0].click(); });
    expect(dataCardApi.getUserCapacity).toHaveBeenCalledTimes(1);
    expect(dataCardApi.getCardsDetailed).not.toHaveBeenCalled();
    await act(async () => { container.querySelectorAll('button')[1].click(); });
    expect(dataCardApi.getCardsDetailed).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
