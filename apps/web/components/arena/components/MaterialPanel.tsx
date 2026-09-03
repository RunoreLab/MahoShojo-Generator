'use client';

import { ArenaMaterialSection } from '../editor/features/material/ArenaMaterialSection';
import { useSoloMaterialSectionModel } from '../editor/features/material/useSoloMaterialSection';

type MaterialPanelProps = {
  onOpenMaterialModal: () => void;
};

/**
 * 单人素材区块入口：区块级组装已收口到 editor/features/material 共享视图，
 * 这里只保留单人 adapter（上传/粘贴/参考项预算）的接线。
 */
export function MaterialPanel({ onOpenMaterialModal }: MaterialPanelProps) {
  const model = useSoloMaterialSectionModel({ onOpenModal: onOpenMaterialModal });
  return <ArenaMaterialSection model={model} />;
}
