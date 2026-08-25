import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const characterManagerSource = readFileSync(
  join(process.cwd(), 'components/character/CharacterManagerPage.tsx'),
  'utf8',
);

const getReplacementHandlerSource = (): string => {
  const match = characterManagerSource.match(
    /const handleReplaceExistingCard = async \(card: any\) => \{([\s\S]*?)\n    \};/,
  );
  if (!match) throw new Error('未找到数据卡替换处理函数');
  return match[1];
};

describe('角色管理页叙事历史替换接线', () => {
  test('为数据卡列表开启叙事历史替换入口', () => {
    const modalInvocation = characterManagerSource.match(
      /< DataCardsModal[\s\S]*?\n            \/>/,
    )?.[0];

    expect(modalInvocation).toContain('allowHistoryReplace={true}');
  });

  test('叙事历史替换进入专用编辑器，而不是通用角色数据替换流程', () => {
    const handlerSource = getReplacementHandlerSource();

    expect(handlerSource).toContain("if (card?.type === 'history')");
    expect(handlerSource).toContain('await handleLoadDataCard(card);');
  });
});
