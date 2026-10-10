import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import type {
  Parent,
  Paragraph,
  PhrasingContent,
  Root,
  Table,
  TableCell,
  TableRow,
  Text,
} from 'mdast';
import { mathFromMarkdown } from 'mdast-util-math';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

type Align = 'left' | 'right' | 'center' | null;

function getFileSourceText(file: unknown): string | null {
  if (!file || typeof file !== 'object') return null;

  const value = (file as { value?: unknown }).value;
  if (typeof value === 'string') return value;

  if (value instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(value);
    } catch {
      return null;
    }
  }

  return null;
}

function splitTableLine(line: string): string[] {
  const trimmed = line.trim();
  const withoutLeading = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const withoutEdgePipes = withoutLeading.endsWith('|') ? withoutLeading.slice(0, -1) : withoutLeading;

  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < withoutEdgePipes.length; index++) {
    const ch = withoutEdgePipes[index];
    if (ch === '\\' && withoutEdgePipes[index + 1] === '|') {
      current += '|';
      index++;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlignToken(token: string): Align | undefined {
  const compact = token.replace(/\s+/g, '');
  if (!compact) return undefined;

  const match = compact.match(/^:?-{3,}:?$/);
  if (!match) return undefined;

  const starts = compact.startsWith(':');
  const ends = compact.endsWith(':');
  if (starts && ends) return 'center';
  if (ends) return 'right';
  if (starts) return 'left';
  return null;
}

function parseInlineMarkdown(value: string): PhrasingContent[] {
  const root = fromMarkdown(value, {
    extensions: [math({ singleDollarTextMath: true })],
    mdastExtensions: [mathFromMarkdown()],
  });
  const first = root.children[0];
  if (!first || first.type !== 'paragraph') {
    return [{ type: 'text', value } satisfies Text] as PhrasingContent[];
  }
  return (first as Paragraph).children as PhrasingContent[];
}

function tryParseTableFromParagraphText(raw: string): Table | null {
  const text = raw.trimEnd();
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  if (lines.length < 2) return null;

  const headerLine = lines[0];
  const delimiterLine = lines[1];

  if (!headerLine.includes('|') || !delimiterLine.includes('|')) return null;

  const alignTokens = splitTableLine(delimiterLine).map(parseAlignToken);
  if (alignTokens.length < 2) return null;
  if (alignTokens.some((token) => token === undefined)) return null;

  const align = alignTokens as Align[];
  const columns = align.length;

  const headerCells = splitTableLine(headerLine);
  if (headerCells.length !== columns) return null;

  const bodyLines = lines.slice(2);
  if (bodyLines.length === 0) return null;

  const rows: TableRow[] = [];
  const headerRow: TableRow = {
    type: 'tableRow',
    children: headerCells.map(
      (cell): TableCell => ({
        type: 'tableCell',
        children: parseInlineMarkdown(cell),
      })
    ),
  };
  rows.push(headerRow);

  for (const line of bodyLines) {
    if (!line.includes('|')) return null;
    const rowCells = splitTableLine(line);
    if (rowCells.length !== columns) return null;
    rows.push({
      type: 'tableRow',
      children: rowCells.map(
        (cell): TableCell => ({
          type: 'tableCell',
          children: parseInlineMarkdown(cell),
        })
      ),
    });
  }

  return {
    type: 'table',
    align,
    children: rows,
  };
}

function paragraphToPlainText(node: Paragraph): string | null {
  if (node.children.length === 0) return null;

  const extract = (child: PhrasingContent): string => {
    if (child.type === 'text') return (child as Text).value;
    if (child.type === 'break') return '\n';

    const maybeMath = child as unknown as { type?: unknown; value?: unknown };
    if (maybeMath.type === 'inlineMath') {
      return typeof maybeMath.value === 'string' ? `$${maybeMath.value}$` : '';
    }
    if (maybeMath.type === 'math') {
      return typeof maybeMath.value === 'string' ? `$$${maybeMath.value}$$` : '';
    }

    const maybeParent = child as unknown as { children?: unknown };
    if (Array.isArray(maybeParent.children)) {
      return (maybeParent.children as PhrasingContent[]).map(extract).join('');
    }

    return '';
  };

  const value = node.children.map(extract).join('');
  return value.trim().length > 0 ? value : null;
}

const remarkBattleTable: Plugin<[], Root> = () => {
  return (tree, file) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if ((parent as Parent).type === 'tableCell') return;

      const source = getFileSourceText(file);
      const startOffset = node.position?.start?.offset;
      const endOffset = node.position?.end?.offset;
      const raw =
        typeof startOffset === 'number' && typeof endOffset === 'number' && typeof source === 'string'
          ? source.slice(startOffset, endOffset)
          : null;

      const text = raw ?? paragraphToPlainText(node);
      if (!text) return;

      const table = tryParseTableFromParagraphText(text);
      if (!table) return;

      (parent as Parent).children.splice(index, 1, table);
    });
  };
};

export default remarkBattleTable;
