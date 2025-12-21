import { describe, expect, it } from 'bun:test';

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Root, Table } from 'mdast';

import remarkBattleTable from '@/lib/markdown/remarkBattleTable';

describe('remarkBattleTable', () => {
  it('将管道表格段落转换为 mdast table', () => {
    const markdown = `|列A|列B|
|---|---|
|1|2|
`;

    const tree = fromMarkdown(markdown) as Root;
    const transformer = remarkBattleTable() as unknown as (root: Root, file?: unknown) => void;
    transformer(tree, { value: markdown });

    expect(tree.children[0]?.type).toBe('table');
    const table = tree.children[0] as Table;
    expect(table.children.length).toBe(2);
    expect(table.children[0].children.length).toBe(2);
  });

  it('支持表格单元格内的 Markdown 内联语法（例如加粗）', () => {
    const markdown = `|**列A**|列B|
|---|---|
|**1**|2|
`;

    const tree = fromMarkdown(markdown) as Root;
    const transformer = remarkBattleTable() as unknown as (root: Root, file?: unknown) => void;
    transformer(tree, { value: markdown });

    expect(tree.children[0]?.type).toBe('table');
    const table = tree.children[0] as Table;
    const headerFirstCell = table.children[0].children[0];
    expect(headerFirstCell.children[0]?.type).toBe('strong');
  });
});

