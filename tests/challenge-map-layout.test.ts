import { describe, expect, test } from 'bun:test';

import { buildChallengeMapLayout } from '@/lib/challenge/map-layout';
import { advanceMapVisibility, generateChallengeMap } from '@/lib/challenge/map';

describe('challenge map layout', () => {
  test('为每个节点分配稳定轨道位，并让同层节点横向坐标不同', () => {
    const mapState = generateChallengeMap({ runSeed: 'layout-a', worldPresetId: 'arena' });
    const layout = buildChallengeMapLayout({
      mapState,
      selectableNodeIds: ['L1-N1', 'L1-N2'],
      selectedNodeId: null,
    });

    const layerOne = layout.nodes.filter((node) => node.layer === 1);
    expect(layerOne).toHaveLength(2);
    expect(new Set(layerOne.map((node) => node.trackSlot)).size).toBe(2);
    expect(new Set(layerOne.map((node) => node.x)).size).toBe(2);
  });

  test('相同地图输入会输出稳定布局', () => {
    const mapState = generateChallengeMap({ runSeed: 'layout-stable', worldPresetId: 'arena' });
    const input = {
      mapState,
      selectableNodeIds: ['L1-N1', 'L1-N2'],
      selectedNodeId: null,
    };

    expect(buildChallengeMapLayout(input)).toEqual(buildChallengeMapLayout(input));
  });

  test('会把边状态区分为 completed / available / locked', () => {
    const mapState = generateChallengeMap({ runSeed: 'layout-b', worldPresetId: 'arena' });
    const layout = buildChallengeMapLayout({
      mapState,
      selectableNodeIds: ['L1-N1', 'L1-N2'],
      selectedNodeId: null,
    });

    expect(layout.edges.some((edge) => edge.state === 'available')).toBe(true);
    expect(layout.edges.some((edge) => edge.state === 'locked')).toBe(true);
  });

  test('默认选中当前可进入节点中的第一个，否则回落到最近已完成或首个 focused 节点', () => {
    const mapState = generateChallengeMap({ runSeed: 'layout-c', worldPresetId: 'arena' });
    const layout = buildChallengeMapLayout({
      mapState,
      selectableNodeIds: ['L1-N2'],
      selectedNodeId: null,
    });

    expect(layout.selectedNodeId).toBe('L1-N2');
  });

  test('手动传入 selectedNodeId 的优先级高于默认选中规则', () => {
    const mapState = generateChallengeMap({ runSeed: 'layout-selected', worldPresetId: 'arena' });
    const layout = buildChallengeMapLayout({
      mapState,
      selectableNodeIds: ['L1-N1', 'L1-N2'],
      selectedNodeId: 'L2-N1',
    });

    expect(layout.selectedNodeId).toBe('L2-N1');
  });

  test('没有可进入节点时，会回落到最近已完成节点', () => {
    const mapState = advanceMapVisibility(
      generateChallengeMap({ runSeed: 'layout-resolved', worldPresetId: 'arena' }),
      'L2-N1'
    );
    const layout = buildChallengeMapLayout({
      mapState,
      selectableNodeIds: [],
      selectedNodeId: null,
    });

    expect(layout.selectedNodeId).toBe('L2-N1');
  });
});
