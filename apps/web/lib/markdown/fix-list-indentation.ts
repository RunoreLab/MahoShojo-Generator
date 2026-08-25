/**
 * Fix nested ordered list indentation to ensure sub-items are properly recognized.
 *
 * In CommonMark, a sub-list must be indented to at least the content column of
 * the parent list item. For example, under `12. ` (marker width 3), sub-items
 * need at least 4 spaces of indentation.
 */
export function fixNestedListIndentation(markdown: string): string {
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
