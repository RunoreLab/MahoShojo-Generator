import { describe, expect, it } from 'vitest';

import { buildSafeFileName } from '../src/client/fileName';

describe('buildSafeFileName（共享导出文件名清洗）', () => {
  it('剥掉文件名非法字符并保留中文', () => {
    expect(buildSafeFileName('卡/名:*?"<>|测试', 'json', '数据卡')).toBe('卡_名_______测试.json');
  });

  it('空白基名回退到 fallback，扩展名的点号与空白被归一', () => {
    expect(buildSafeFileName('   ', 'json', '数据卡')).toBe('数据卡.json');
    expect(buildSafeFileName('名字', '.JSON ', '数据卡')).toBe('名字.JSON');
    expect(buildSafeFileName('名字', '  ', '数据卡')).toBe('名字.txt');
  });

  it('基名截断到 80 字符——超长标题不会撞文件系统文件名上限', () => {
    const long = '长'.repeat(120);
    const name = buildSafeFileName(long, 'json', '数据卡');
    expect(name).toBe(`${'长'.repeat(80)}.json`);
    expect(name.length).toBe(85);
  });

  it('合并连续空白并去掉首尾空白', () => {
    expect(buildSafeFileName('  魔法   少女  ', 'json', '数据卡')).toBe('魔法 少女.json');
  });
});
