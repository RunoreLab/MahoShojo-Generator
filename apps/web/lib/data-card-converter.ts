import {
  CanshouSchema,
  GeneralCharacterSchema,
  GeneralScenarioSchema,
  MagicalGirlSchema,
  ScenarioSchema,
} from './schemas';
import {
  DATA_CARD_TEMPLATE_LABELS,
  inferDataCardTemplate,
  type DataCardTemplate,
  type InferableDataCardTemplate,
} from '@mahoshojo/domain/data-cards';
import {
  convertDataCard as convertDataCardCore,
  createBlankDataCard as createBlankDataCardCore,
} from '@mahoshojo/domain/sublimation';

// 模板集合/中文标签/结构推断与转换实现的 canonical 定义已上移
// `@mahoshojo/domain/data-cards` 与 `@mahoshojo/domain/sublimation`（Desktop 角色管理
// 共用同一套判定与映射）。这里只保留 Web 语义层：转换结果仍过各模板的 Zod schema——
// schemas 都是 catchall passthrough，校验产出与 domain 输出同形，但保留「非法结构即抛」
// 的既有失败路径（`validateDataCard` 的云端上传门禁也依赖同一套 schema）。
export type { DataCardTemplate };
export type InferableTemplate = InferableDataCardTemplate;

export const TEMPLATE_LABELS = DATA_CARD_TEMPLATE_LABELS;

export const inferTemplate = inferDataCardTemplate;

interface AssignResult<T> {
  data: T;
  warnings: string[];
}

const parseByTemplate = (template: DataCardTemplate, data: Record<string, unknown>) => {
  switch (template) {
    case 'magical-girl':
      return MagicalGirlSchema.parse(data);
    case 'canshou':
      return CanshouSchema.parse(data);
    case 'general':
      return GeneralCharacterSchema.parse(data);
    case 'scenario':
      return ScenarioSchema.parse(data);
    case 'general-scenario':
      return GeneralScenarioSchema.parse(data);
  }
};

export function createBlankDataCard(template: DataCardTemplate) {
  return parseByTemplate(template, createBlankDataCardCore(template));
}

export function convertDataCard(data: any, target: DataCardTemplate, sourceTemplate: InferableTemplate = inferTemplate(data)): AssignResult<any> {
  const { data: converted, warnings } = convertDataCardCore(data, target, sourceTemplate);
  return { data: parseByTemplate(target, converted), warnings };
}
