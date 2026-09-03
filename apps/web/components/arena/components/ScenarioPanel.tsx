'use client';

import { ArenaScenarioSection } from '../editor/features/scenario/ArenaScenarioSection';
import { useSoloScenarioSectionModel } from '../editor/features/scenario/useSoloScenarioSection';

interface ScenarioPanelProps {
  onOpenScenarioModal: () => void;
  onRandomMatchScenario: () => void;
  onOpenAuxScenarioModal: () => void;
  isAuthenticated: boolean;
}

/**
 * 单人情景区块入口：区块级组装已收口到 editor/features/scenario 共享视图，
 * 这里只保留单人 adapter（上传/粘贴/随机匹配/服务器预设目录）的接线。
 */
export function ScenarioPanel({
  onOpenScenarioModal,
  onRandomMatchScenario,
  onOpenAuxScenarioModal,
  isAuthenticated,
}: ScenarioPanelProps) {
  const model = useSoloScenarioSectionModel({
    onOpenMainModal: onOpenScenarioModal,
    onOpenAuxModal: onOpenAuxScenarioModal,
    onRandomMatchMain: onRandomMatchScenario,
    isAuthenticated,
  });
  return <ArenaScenarioSection model={model} />;
}
