// @vitest-environment jsdom
/**
 * DESK-AIP-009 / AIP-1 共源控件回归：
 * - `AiProviderCustomSelect` 的分组、独立操作区、键盘导航与禁用原因；
 * - `AiExecutionLocationField` 与 `GenerationModeSwitcher` 共用 `SegmentedControl`
 *   的轨道/aria 语义及选项级禁用；
 * - `AiProviderSelectorForm` 的受控槽位渲染（持久化副作用由宿主注入，本组件不写存储）。
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AiProviderCustomSelect,
  AiExecutionLocationField,
  AiProviderSelectorForm,
  type AiProviderSelectOption,
} from '../src/ai-provider/index';
import { GenerationModeSwitcher } from '../src/details-controls/index';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async (node: ReactNode): Promise<void> => {
  await act(async () => {
    root.render(node);
  });
};

const keydown = (target: Element | Document, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

const triggerOf = () =>
  container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;

const menuOf = () => container.querySelector<HTMLElement>('[role="listbox"]');

describe('AiProviderCustomSelect（AIP-1 分组/动作/键盘）', () => {
  const options: AiProviderSelectOption[] = [
    { value: 'p1', label: '内置 A', description: '预设 a', group: '内置供应商', kind: 'preset' },
    { value: 'p2', label: '内置 B', description: '预设 b', group: '内置供应商', kind: 'preset' },
    { value: 'c1', label: '我的连接 1', description: '已保存', group: '我的连接', kind: 'connection' },
    {
      value: 'x1',
      label: '不可用项',
      group: '内置供应商',
      disabled: true,
      disabledReason: '该协议暂不支持',
    },
  ];

  it('按 group 渲染分组标题，未选择时保持占位', async () => {
    const onChange = vi.fn();
    await render(
      <AiProviderCustomSelect
        options={options}
        value=""
        onChange={onChange}
        placeholder="选择供应商"
      />,
    );
    await act(async () => triggerOf().click());
    const groups = [...container.querySelectorAll('[role="group"]')].map(
      (el) => el.getAttribute('aria-label'),
    );
    expect(groups).toContain('内置供应商');
    expect(groups).toContain('我的连接');
    expect(container.textContent).toContain('内置供应商');
    expect(container.textContent).toContain('我的连接');
    // 禁用项给出原因且标记 aria-disabled
    const disabledOption = [...container.querySelectorAll('[role="option"]')].find(
      (el) => el.getAttribute('aria-disabled') === 'true',
    );
    expect(disabledOption?.textContent).toContain('该协议暂不支持');
  });

  it('操作区动作经 onAction 派发，不进入 onChange 取值空间', async () => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    await render(
      <AiProviderCustomSelect
        options={options}
        value="p1"
        onChange={onChange}
        placeholder="选择供应商"
        actions={[{ id: 'new', label: '＋ 新建自定义连接' }, { id: 'manage', label: '管理连接' }]}
        onAction={onAction}
      />,
    );
    await act(async () => triggerOf().click());
    const actionButton = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === '＋ 新建自定义连接',
    )!;
    await act(async () => actionButton.click());
    expect(onAction).toHaveBeenCalledWith('new');
    expect(onChange).not.toHaveBeenCalled();
    expect(menuOf()).toBeNull();
    expect(triggerOf().getAttribute('aria-expanded')).toBe('false');
  });

  it('键盘：ArrowDown 展开、方向键移动 activedescendant、Enter 选定', async () => {
    const onChange = vi.fn();
    await render(
      <AiProviderCustomSelect
        options={options}
        value="p2"
        onChange={onChange}
        placeholder="选择供应商"
      />,
    );
    await act(async () => {
      keydown(triggerOf(), 'ArrowDown');
    });
    expect(menuOf()).not.toBeNull();
    // 打开时定位到当前选中项（p2）
    const active = triggerOf().getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.textContent).toContain('内置 B');

    await act(async () => {
      keydown(triggerOf(), 'ArrowDown');
      keydown(triggerOf(), 'ArrowDown');
    });
    const next = triggerOf().getAttribute('aria-activedescendant');
    expect(document.getElementById(next!)?.textContent).toContain('不可用项');

    // Enter 落在禁用项上：不触发 onChange、不关闭菜单
    await act(async () => {
      keydown(triggerOf(), 'Enter');
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(menuOf()).not.toBeNull();

    await act(async () => {
      keydown(triggerOf(), 'Home');
    });
    await act(async () => {
      keydown(triggerOf(), 'Enter');
    });
    expect(onChange).toHaveBeenCalledWith('p1');
    expect(menuOf()).toBeNull();
  });

  it('Escape 关闭并把焦点还给触发器；Tab 关闭且不拦截', async () => {
    await render(
      <AiProviderCustomSelect
        options={options}
        value=""
        onChange={() => {}}
        placeholder="选择供应商"
      />,
    );
    await act(async () => triggerOf().focus());
    await act(async () => triggerOf().click());
    expect(menuOf()).not.toBeNull();

    await act(async () => {
      keydown(document, 'Escape');
    });
    expect(menuOf()).toBeNull();
    expect(document.activeElement).toBe(triggerOf());

    await act(async () => triggerOf().click());
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      triggerOf().dispatchEvent(tabEvent);
    });
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(menuOf()).toBeNull();
  });

  it('打开弹层再点外部区域关闭', async () => {
    await render(
      <AiProviderCustomSelect
        options={options}
        value=""
        onChange={() => {}}
        placeholder="选择供应商"
      />,
    );
    await act(async () => triggerOf().click());
    expect(menuOf()).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menuOf()).toBeNull();
  });
});

describe('AiExecutionLocationField（SegmentedControl 共源）', () => {
  it('与生成方式共用同一分段结构：legend 标签 + aria-pressed 选项', async () => {
    const onChange = vi.fn();
    await render(
      <AiExecutionLocationField
        value="client"
        client={{ enabled: true }}
        server={{ enabled: true }}
        onChange={onChange}
      />,
    );
    const legend = container.querySelector('legend');
    expect(legend?.textContent).toBe('AI 执行');
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['客户端', '服务器']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
    // 与 GenerationModeSwitcher 相同的全宽分段轨道
    expect(container.querySelector('.rounded-full')).not.toBeNull();
    await act(async () => buttons[1].click());
    expect(onChange).toHaveBeenCalledWith('server');
  });

  it('选项级禁用：按钮禁用、原因可见、悬浮提示含原因', async () => {
    await render(
      <AiExecutionLocationField
        value="client"
        client={{ enabled: true }}
        server={{ enabled: false, reason: '服务器 BYOK 尚未开放' }}
      />,
    );
    const server = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '服务器',
    )!;
    expect(server.disabled).toBe(true);
    expect(server.title).toContain('服务器 BYOK 尚未开放');
    expect(container.textContent).toContain('服务器 BYOK 尚未开放');
  });
});

describe('GenerationModeSwitcher（AIP-1 选项级禁用与上下文 helper）', () => {
  it('disabledReasons 只禁用对应选项并附原因', async () => {
    const onChange = vi.fn();
    await render(
      <GenerationModeSwitcher
        value="non-stream"
        onChange={onChange}
        helper={false}
        disabledReasons={{ stream: '客户端执行仅支持结构化（非流式）生成' }}
      />,
    );
    const stream = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '流式',
    )!;
    const nonStream = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '非流式',
    )!;
    expect(stream.disabled).toBe(true);
    expect(stream.title).toContain('客户端执行仅支持结构化（非流式）生成');
    expect(nonStream.disabled).toBe(false);
    await act(async () => stream.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('helper 传 ReactNode 时渲染宿主上下文说明而非默认战报文案', async () => {
    await render(
      <GenerationModeSwitcher
        value="non-stream"
        onChange={() => {}}
        helper={<p data-testid="ctx-helper">按当前业务输出 JSON 结构化结果。</p>}
      />,
    );
    expect(container.querySelector('[data-testid="ctx-helper"]')).not.toBeNull();
    // 默认 helper 的战报结论文案不渲染（选项自身描述里的「战报」说明不受 helper 控制）
    expect(container.textContent).not.toContain('你已选择【非流式生成】');
  });
});

describe('AiProviderSelectorForm（纯受控骨架）', () => {
  it('渲染供应商/模型/凭据/高级设置槽位；未提供区块不渲染', async () => {
    await render(
      <AiProviderSelectorForm
        providerSelect={<div data-testid="provider-slot" />}
        modelSelect={<div data-testid="model-slot" />}
        customModelId={{
          input: <input data-testid="custom-model-input" />,
          hint: '仅切换模型名。',
        }}
        apiKey={{
          content: <p data-testid="key-status">已配置</p>,
          hint: '凭据只存于操作系统凭据存储。',
        }}
        advancedSettings={<div data-testid="adv" />}
      />,
    );
    expect(container.querySelector('[data-testid="provider-slot"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="model-slot"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="custom-model-input"]')).not.toBeNull();
    expect(container.textContent).toContain('已配置');
    expect(container.textContent).toContain('凭据只存于操作系统凭据存储。');
    expect(container.querySelector('[data-testid="adv"]')).not.toBeNull();
    expect(container.textContent).toContain('更多提供商正在添加中');
    expect(container.textContent).toContain('高级设置按「供应商 + 模型」分别保存');
  });

  it('footnote 传 null 时隐藏默认说明', async () => {
    await render(
      <AiProviderSelectorForm
        providerSelect={<div data-testid="provider-slot" />}
        providerFootnote={null}
        advancedFootnote={null}
      />,
    );
    expect(container.textContent).not.toContain('更多提供商正在添加中');
    expect(container.textContent).not.toContain('高级设置按「供应商 + 模型」分别保存');
  });
});
