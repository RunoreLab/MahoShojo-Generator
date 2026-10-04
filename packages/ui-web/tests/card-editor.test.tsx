// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DataCardFieldEditor,
  isHiddenDataCardField,
  orderDataCardFieldKeys,
  setDataCardFieldValue,
  toDataCardFieldId,
} from '../src/card-editor/index';

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

describe('字段规则', () => {
  it('按产品顺序排列已知字段，未知字段按字典序排在后面', () => {
    expect(orderDataCardFieldKeys(['zeta', 'analysis', 'codename', 'alpha', 'appearance']))
      .toEqual(['codename', 'appearance', 'analysis', 'alpha', 'zeta']);
  });

  it('隐藏内部、签名、历战、当前状态、裁定事件与模板字段', () => {
    for (const key of ['_author', 'signature', 'isPreset', 'arena_history', 'current_state', 'adjudicationEvents', 'templateId']) {
      expect(isHiddenDataCardField(key)).toBe(true);
    }
    expect(isHiddenDataCardField('codename')).toBe(false);
  });

  it('路径写入返回新对象，按下一段补数组或对象，模板 ID 不可改', () => {
    const original = { codename: 'a', appearance: { outfit: 'x' }, templateId: 't' };
    const next = setDataCardFieldValue(original, ['appearance', 'outfit'], 'y');
    expect(next).toEqual({ codename: 'a', appearance: { outfit: 'y' }, templateId: 't' });
    expect(original.appearance.outfit).toBe('x');
    expect(setDataCardFieldValue(original, ['list', '0'], 'v')).toMatchObject({ list: ['v'] });
    expect(setDataCardFieldValue(original, ['deep', 'key'], 1)).toMatchObject({ deep: { key: 1 } });
    expect(setDataCardFieldValue(original, ['templateId'], 'other')).toBe(original);
  });

  it('含 `.` 的键按单段处理，不会写错到嵌套字段', () => {
    const original = { 'profile.name': 'Alice', other: 1 };
    const next = setDataCardFieldValue(original, ['profile.name'], 'Bob');
    expect(next).toEqual({ 'profile.name': 'Bob', other: 1 });
    expect(next).not.toHaveProperty('profile');
  });

  it('路径写入做结构共享：未触及的子树保持原引用', () => {
    const original = { codename: 'a', appearance: { outfit: 'x' }, analysis: { trait: 'y' } };
    const next = setDataCardFieldValue(original, ['appearance', 'outfit'], 'z');
    expect(next.appearance).not.toBe(original.appearance);
    expect(next.appearance.outfit).toBe('z');
    expect(next.analysis).toBe(original.analysis);
  });

  it('DOM id 按逐段路径单射编码，含 `.`、`__`、空白的键互不冲突', () => {
    expect(toDataCardFieldId(['codename'])).toBe('editor-field-codename');
    expect(toDataCardFieldId(['appearance', 'outfit'])).toBe('editor-field-appearance__outfit');
    const ids = [
      toDataCardFieldId(['a.b']),
      toDataCardFieldId(['a', 'b']),
      toDataCardFieldId(['a__b']),
      toDataCardFieldId(['a b']),
      toDataCardFieldId(['a_b']),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

const change = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('DataCardFieldEditor', () => {
  it('渲染各类字段并以逐段路径回报修改', async () => {
    const onFieldChange = vi.fn();
    const data = {
      templateId: '魔法少女/心之花/魔法少女（问卷生成）',
      signature: 'sig',
      codename: '星光',
      appearance: { outfit: '白裙' },
      analysis: { coreTraits: ['勇敢', '温柔'] },
      magicConstruct: { basicAbilities: [{ name: '光' }] },
    };
    act(() => root.render(<DataCardFieldEditor data={data} onFieldChange={onFieldChange} />));

    expect(container.querySelector('#editor-field-templateId')).toBeNull();
    expect(container.querySelector('#editor-field-signature')).toBeNull();
    const codename = container.querySelector<HTMLInputElement>('#editor-field-codename')!;
    expect(codename.maxLength).toBe(20);
    expect(codename.getAttribute('autocomplete')).toBe('off');
    await change(codename, '月影');
    expect(onFieldChange).toHaveBeenLastCalledWith(['codename'], '月影');

    await change(container.querySelector<HTMLInputElement>('#editor-field-appearance__outfit')!, '黑裙');
    expect(onFieldChange).toHaveBeenLastCalledWith(['appearance', 'outfit'], '黑裙');

    const traits = container.querySelector<HTMLTextAreaElement>('#editor-field-analysis__coreTraits')!;
    expect(traits.value).toBe('勇敢\n温柔');
    await change(traits, '勇敢\n坚定');
    expect(onFieldChange).toHaveBeenLastCalledWith(['analysis', 'coreTraits'], ['勇敢', '坚定']);

    const abilities = container.querySelector<HTMLTextAreaElement>('#editor-field-magicConstruct__basicAbilities')!;
    expect(abilities.readOnly).toBe(true);
    expect(container.textContent).toContain('basic Abilities (只读)');
  });

  it('number / boolean 保持原 JSON 类型，null 只读展示', async () => {
    const onFieldChange = vi.fn();
    act(() => root.render(
      <DataCardFieldEditor
        data={{ level: 3, enabled: true, note: null }}
        onFieldChange={onFieldChange}
      />,
    ));

    const level = container.querySelector<HTMLInputElement>('#editor-field-level')!;
    expect(level.type).toBe('number');
    await change(level, '4');
    expect(onFieldChange).toHaveBeenLastCalledWith(['level'], 4);
    expect(typeof onFieldChange.mock.lastCall![1]).toBe('number');

    const enabled = container.querySelector<HTMLInputElement>('#editor-field-enabled')!;
    expect(enabled.type).toBe('checkbox');
    expect(enabled.checked).toBe(true);
    await act(async () => { enabled.click(); });
    expect(onFieldChange).toHaveBeenLastCalledWith(['enabled'], false);

    const note = container.querySelector<HTMLInputElement>('#editor-field-note')!;
    expect(note.readOnly).toBe(true);
    expect(note.value).toBe('null');
  });

  it('键本身含 `.` 时仍按单段路径回报', async () => {
    const onFieldChange = vi.fn();
    act(() => root.render(
      <DataCardFieldEditor data={{ 'profile.name': 'Alice' }} onFieldChange={onFieldChange} />,
    ));
    const field = container.querySelector<HTMLInputElement>('#editor-field-profile_u002ename')!;
    await change(field, 'Bob');
    expect(onFieldChange).toHaveBeenLastCalledWith(['profile.name'], 'Bob');
  });

  it('含 `.` 的键与嵌套路径产生不同 DOM id，label 各自指向正确输入框', async () => {
    const onFieldChange = vi.fn();
    act(() => root.render(
      <DataCardFieldEditor
        data={{ 'a.b': 'literal', a: { b: 'nested' } }}
        onFieldChange={onFieldChange}
      />,
    ));
    const literal = container.querySelector<HTMLInputElement>('#editor-field-a_u002eb')!;
    const nested = container.querySelector<HTMLInputElement>('#editor-field-a__b')!;
    expect(literal).not.toBe(nested);
    const htmlFors = [...container.querySelectorAll('label')].map((el) => el.htmlFor);
    expect(htmlFors).toContain('editor-field-a_u002eb');
    expect(htmlFors).toContain('editor-field-a__b');
    await change(nested, '改嵌套');
    expect(onFieldChange).toHaveBeenLastCalledWith(['a', 'b'], '改嵌套');
    await change(literal, '改字面');
    expect(onFieldChange).toHaveBeenLastCalledWith(['a.b'], '改字面');
  });

  it('宿主插槽注入行内与下方附件，并切换问题样式', () => {
    act(() => root.render(
      <DataCardFieldEditor
        data={{ codename: '星光', name: '名' }}
        onFieldChange={() => {}}
        classes={{ input: 'host-input', invalidInput: 'host-invalid' }}
        renderFieldAddon={(path, displayPath) => (path.length === 1 && path[0] === 'codename' && displayPath === 'codename'
          ? { invalid: true, inline: <button type="button">随机</button>, below: <p>提示</p> }
          : null)}
      />,
    ));
    expect(container.querySelector('#editor-field-codename')!.className).toBe('host-invalid');
    expect(container.querySelector('#editor-field-name')!.className).toBe('host-input');
    expect(container.textContent).toContain('随机');
    expect(container.textContent).toContain('提示');
  });
});
