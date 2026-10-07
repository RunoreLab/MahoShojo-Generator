/**
 * 生成物屏蔽工具的原子性（P2）：`maskThenRestore` 必须保证——
 * 屏蔽中途失败只留「全部恢复」的干净工作区，不存在部分 masked 的中间态；
 * action 抛错同样逆序恢复。注入 rename 缝模拟第 N 次调用抛错来钉住该不变量。
 */
import { describe, expect, it, vi } from 'vitest';

import { maskThenRestore } from '../scripts/test-without-generated-public.mjs';

const target = (name: string) => ({
  absolute: `/repo/${name}`,
  masked: `/repo/${name}.generated-masked`,
  relativePath: name,
});

const silentConsole = () => vi.spyOn(console, 'log').mockImplementation(() => {});

describe('maskThenRestore — masking atomicity', () => {
  it('masks all targets, runs the action, then restores in reverse order', () => {
    silentConsole();
    const ops: string[] = [];
    const targets = [target('a'), target('b'), target('c')];
    let ran = false;

    const { masked, restoreFailures } = maskThenRestore(
      targets,
      () => {
        ran = true;
        return 'done';
      },
      (from, to) => ops.push(`${from} -> ${to}`),
    );

    expect(ran).toBe(true);
    expect(restoreFailures).toEqual([]);
    expect(masked).toEqual(targets);
    expect(ops).toEqual([
      '/repo/a -> /repo/a.generated-masked',
      '/repo/b -> /repo/b.generated-masked',
      '/repo/c -> /repo/c.generated-masked',
      '/repo/c.generated-masked -> /repo/c',
      '/repo/b.generated-masked -> /repo/b',
      '/repo/a.generated-masked -> /repo/a',
    ]);
  });

  it('restores only the successfully masked prefix when a rename fails midway', () => {
    silentConsole();
    const ops: string[] = [];
    let call = 0;
    const targets = [target('a'), target('b'), target('c'), target('d')];
    const action = vi.fn();

    expect(() =>
      maskThenRestore(targets, action, (from, to) => {
        call += 1;
        // 第 3 次 rename（mask c）失败：工作区不能停在 a/b 仍被屏蔽的态。
        if (call === 3) throw new Error('EBUSY: resource busy or locked');
        ops.push(`${from} -> ${to}`);
      }),
    ).toThrow('EBUSY');

    expect(action).not.toHaveBeenCalled();
    expect(ops).toEqual([
      '/repo/a -> /repo/a.generated-masked',
      '/repo/b -> /repo/b.generated-masked',
      '/repo/b.generated-masked -> /repo/b',
      '/repo/a.generated-masked -> /repo/a',
    ]);
  });

  it('restores in reverse order when the action itself throws', () => {
    silentConsole();
    const ops: string[] = [];
    const targets = [target('a'), target('b')];

    expect(() =>
      maskThenRestore(
        targets,
        () => {
          throw new Error('spawn failed');
        },
        (from, to) => ops.push(`${from} -> ${to}`),
      ),
    ).toThrow('spawn failed');

    expect(ops).toEqual([
      '/repo/a -> /repo/a.generated-masked',
      '/repo/b -> /repo/b.generated-masked',
      '/repo/b.generated-masked -> /repo/b',
      '/repo/a.generated-masked -> /repo/a',
    ]);
  });

  it('collects restore failures instead of aborting the remaining restores', () => {
    silentConsole();
    const ops: string[] = [];
    let call = 0;
    const targets = [target('a'), target('b')];

    const { restoreFailures } = maskThenRestore(targets, () => {}, (from, to) => {
      call += 1;
      if (call === 3) throw new Error('restore b failed');
      ops.push(`${from} -> ${to}`);
    });

    // b 的恢复失败后，a 的恢复仍继续；失败项被上报而不是吞掉。
    expect(ops).toEqual([
      '/repo/a -> /repo/a.generated-masked',
      '/repo/b -> /repo/b.generated-masked',
      '/repo/a.generated-masked -> /repo/a',
    ]);
    expect(restoreFailures).toHaveLength(1);
    expect(restoreFailures[0].target.relativePath).toBe('b');
  });
});
