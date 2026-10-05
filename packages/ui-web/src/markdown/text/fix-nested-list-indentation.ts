/**
 * 修正嵌套有序列表的缩进。
 *
 * CommonMark 要求子列表至少缩进到父列表项的内容列：`12. ` 的 marker 宽 3，因此子项需要至少 4 个
 * 空格。百科正文里存在这类列表，不修正时它们会被渲染成同级项。
 *
 * 这是纯文本变换，没有领域知识也不依赖任何宿主，因此属于共享层而不是某个 app 的工具函数。
 */
export const fixNestedListIndentation = (markdown: string): string => {
    const lines = markdown.split('\n');
    const result: string[] = [];

    // Stack to track parent list items: each entry has {indent, markerWidth}
    const stack: { indent: number; markerWidth: number }[] = [];

    const listRegex = /^(\s*)(\d+)\.\s/;

    for (const line of lines) {
        const match = line.match(listRegex);

        if (match) {
            const currentIndent = match[1].length;
            const markerWidth = match[2].length + 1; // digits + period

            // Pop parents that are at the same or deeper level
            while (stack.length > 0 && currentIndent <= stack[stack.length - 1].indent) {
                stack.pop();
            }

            // Check if we need to adjust indentation
            if (stack.length > 0) {
                const parent = stack[stack.length - 1];
                const requiredIndent = parent.indent + parent.markerWidth + 1;

                if (currentIndent < requiredIndent) {
                    const content = line.substring(match[1].length);
                    const adjustedLine = ' '.repeat(requiredIndent) + content;
                    result.push(adjustedLine);
                    stack.push({ indent: requiredIndent, markerWidth });
                    continue;
                }
            }

            stack.push({ indent: currentIndent, markerWidth });
            result.push(line);
        } else {
            // Non-list line
            const trimmed = line.trim();
            if (trimmed === '') {
                // Blank line, keep the stack (list continues after blank)
                result.push(line);
            } else {
                // Non-blank, non-list line, clear the stack
                stack.length = 0;
                result.push(line);
            }
        }
    }

    return result.join('\n');
}
