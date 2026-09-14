import { expect, it } from 'vitest';
import { selectedExportIds } from '../src/client/export-model';
it('导出使用勾选范围优先于当前详情，并冻结选择副本', () => {
  const checked = ['a', 'b']; const ids = selectedExportIds(checked, { id: 'other' });
  checked.push('c'); expect(ids).toEqual(['a', 'b']);
  expect(selectedExportIds([], { id: 'current' })).toEqual(['current']);
});
it('导出要求明确范围，拒绝超限或重复选择', () => {
  expect(() => selectedExportIds([], null)).toThrow('勾选');
  expect(selectedExportIds(Array.from({ length: 100 }, (_, i) => String(i)), null)).toHaveLength(100);
  expect(() => selectedExportIds(Array.from({ length: 101 }, (_, i) => String(i)), null)).toThrow('100');
  expect(() => selectedExportIds(['a', 'a'], null)).toThrow('无效');
});
