// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, test } from 'vitest';
import { DataCardFieldEditor } from '@mahoshojo/ui-web/card-editor';

const characterManagerSource = readFileSync(
  join(process.cwd(), 'components/character/CharacterManagerPage.tsx'),
  'utf8',
);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('角色管理回用共源字段编辑器（D3.2b-1）', () => {
  test('递归表单与路径写入不再在 Web 内另有一份实现', () => {
    expect(characterManagerSource).toContain("from '@mahoshojo/ui-web/card-editor'");
    expect(characterManagerSource).toContain('<DataCardFieldEditor');
    expect(characterManagerSource).toContain('setDataCardFieldValue(prev, path, value)');
    expect(characterManagerSource).not.toContain('isNextKeyNumeric');
    expect(characterManagerSource).not.toContain('const keyOrder = [');
  });

  test('Web 注入的全局样式类与随机代号附件按原位置渲染', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(
      <DataCardFieldEditor
        data={{ codename: '星光', appearance: { outfit: '白裙' } }}
        onFieldChange={() => {}}
        classes={{ input: 'input-field', label: 'block text-sm font-medium text-gray-700 capitalize' }}
        renderFieldAddon={(path) => (path === 'codename' ? { inline: <button type="button">随机</button> } : null)}
      />,
    ));
    const codename = container.querySelector('#editor-field-codename')!;
    expect(codename.className).toBe('input-field');
    expect(codename.parentElement?.textContent).toContain('随机');
    expect(container.querySelector('#editor-field-appearance__outfit')).not.toBeNull();
    act(() => root.unmount());
  });
});
