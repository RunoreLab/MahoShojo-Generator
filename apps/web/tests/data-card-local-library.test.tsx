// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DataCard from '@/components/DataCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = async (props: Record<string, unknown>): Promise<void> => {
  await act(async () => root.render(
    <DataCard
      id="local-1"
      name="本机焰"
      description="本地角色"
      type="character"
      isPublic={false}
      storageLocation="local"
      {...props}
    />,
  ));
};

const buttonLabels = (): string[] =>
  [...container.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it('本地库卡片只提供删除/导出/详情，不出现点赞、收藏与分享', async () => {
  const onLike = vi.fn();
  const onShare = vi.fn();
  const onToggleFavorite = vi.fn(async () => true);
  await render({
    onLike,
    onShare,
    onToggleFavorite,
    canFavorite: true,
    isFavorited: true,
    likeCount: 9,
    favoriteCount: 8,
    onRemoveFromLibrary: vi.fn(),
    onDownload: vi.fn(),
    onViewDetails: vi.fn(),
  });

  const labels = buttonLabels();
  expect(labels).toContain('删除');
  expect(labels).toContain('导出');
  expect(labels).toContain('详情');
  expect(labels.join('')).not.toContain('不可分享');
  // 点赞/收藏/分享的入口是图标 + 计数，断言它们根本没有被渲染。
  expect(container.querySelector('.lucide-heart')).toBeNull();
  expect(container.querySelector('.lucide-share-2')).toBeNull();
  expect(container.textContent).not.toContain('9');
  expect(container.textContent).not.toContain('8');
  expect(onLike).not.toHaveBeenCalled();
  expect(onShare).not.toHaveBeenCalled();
});

it('本地库卡片标注来源，并说明不会上传', async () => {
  await render({});
  expect(container.textContent).toContain('本地库');
  expect(container.textContent).toContain('仅保存在本机，不会上传');
  // 线上可见性徽章（私有/公开/封禁）在本地语境下没有意义。
  expect(container.textContent).not.toContain('公开');
});

it('删除按钮触发本地删除回调，删除进行中时禁用', async () => {
  const onRemoveFromLibrary = vi.fn();
  await render({ onRemoveFromLibrary });
  const remove = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === '删除')!;
  expect(remove.getAttribute('aria-label')).toBe('从本地库删除');

  await act(async () => remove.click());
  expect(onRemoveFromLibrary).toHaveBeenCalledTimes(1);

  await render({ onRemoveFromLibrary, removePending: true });
  const busy = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === '删除')!;
  expect((busy as HTMLButtonElement).disabled).toBe(true);
});

it('删除按钮的点击不会冒泡去触发整张卡的选择', async () => {
  const onRemoveFromLibrary = vi.fn();
  const onSelect = vi.fn();
  await act(async () => root.render(
    // BattleDataModal 就是这样把整张卡做成可点的：点删除不能连带触发选择。
    <div onClick={() => onSelect('card-clicked')}>
      <DataCard
        id="local-1"
        name="本机焰"
        description="本地角色"
        type="character"
        isPublic={false}
        storageLocation="local"
        onRemoveFromLibrary={onRemoveFromLibrary}
      />
    </div>,
  ));
  const remove = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === '删除')!;
  await act(async () => remove.click());
  expect(onRemoveFromLibrary).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
});

it('线上数据卡保持原有动作集，不受本地库维度影响', async () => {
  await render({ storageLocation: 'cloud', isPublic: 1, onDownload: vi.fn(), onViewDetails: vi.fn() });
  const labels = buttonLabels();
  expect(labels.join('')).toContain('分享');
  expect(labels).toContain('详情');
  expect(labels).not.toContain('删除');
  expect(container.textContent).toContain('公开');
});
