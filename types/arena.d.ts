// types/arena.d.ts

/**
 * @fileoverview 定义与魔法少女竞技场和角色成长相关的类型。
 */

/**
 * 历战记录中的单个事件条目。
 * 对应 SRS 3.1.2 节。
 */
export interface CurrentStateField {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  value: string | number | boolean;
}

export interface CharacterCurrentState {
  summary: string;
  fields?: CurrentStateField[];
  updated_at?: string | null;
}

export interface ArenaHistoryEntry {
  id: number; // 从 1 开始自增
  type: 'daily' | 'kizuna' | 'classic' | 'scenario' | 'sublimation' | 'tea-party';
  title: string;
  participants: string[];
  winner: string;
  impact: string; // AI生成的对此角色的影响
  metadata: {
    user_guidance: string | null;
    /** 用户对该角色的行动/想法引导（可选；若开启写入且用户填写则记录）。 */
    character_guidance?: string | null;
    scenario_title: string | null;
    non_native_data_involved: boolean;
  };
}

/**
 * 完整的历战记录对象。
 * 对应 SRS 3.1.1 节。
 */
export interface ArenaHistory {
  attributes: {
    world_line_id: string; // UUID
    created_at: string; // ISO 8601
    updated_at: string; // ISO 8601
    sublimation_count: number;
    last_sublimation_at: string | null; // ISO 8601
  };
  entries: ArenaHistoryEntry[];
}

// =================================================================
// 增强型随机判定器类型定义
// =================================================================

/**
 * @description 定义一个判定事件成功或失败后，可能触发的下一个连锁事件。
 * 这是一个递归结构，允许无限嵌套，形成事件链。
 */
export interface ChainedEvent {
  event: AdjudicatorEvent;
}

/**
 * @description 定义一个自定义结果事件中的单个可能结果。
 */
export interface CustomOutcome {
  id: string;          // 用于React key的唯一标识
  name: string;        // 结果的名称，例如“晴天”、“下雨”
  probability: number; // 此结果的发生概率 (0-100)
  chainedEvent?: ChainedEvent; // 【连锁功能】如果判定为这个结果，可以选择性地触发下一个事件
}

/**
 * @description 核心的判定事件结构。一个事件可以是“二元判定”或“自定义多结果判定”。
 */
export interface AdjudicatorEvent {
  id: string;          // 用于React key的唯一标识
  description: string; // 事件的描述，例如“天气如何？”或“攻击是否命中？”
  type: 'binary' | 'custom'; // 事件类型

  // --- 仅用于 'binary' (二元判定) 类型 ---
  /**
   * @description 成功的概率 (1-100)。失败概率将自动计算为 (100 - probability)。
   */
  probability?: number;
  /**
   * @description 【连锁功能】判定成功后触发的事件。
   */
  onSuccess?: ChainedEvent;
  /**
   * @description 【连锁功能】判定失败后触发的事件。
   */
  onFailure?: ChainedEvent;
  // 注：未来可以轻松扩展出 onGreatSuccess, onFailure 等

  // --- 仅用于 'custom' (自定义多结果) 类型 ---
  /**
   * @description 自定义结果的列表。UI需要确保所有子项的 probability 总和为100。
   */
  outcomes?: CustomOutcome[];
}

/**
 * @description API端进行判定后，用于展示给用户和AI的格式化结果。
 */
export interface AdjudicationResult {
    depth: number;                      // 事件链的深度，根事件为0
    description: string;                // 判定的事件描述
    type: 'binary' | 'custom';          // 判定类型
    roll: number;                       // 掷骰的点数 (1-100)
    outcome: string;                    // 最终判定的结果名称
    details: string;                    // 详细的判定过程描述，例如 "掷骰(80) ≤ 成功率(60%)"
}

// =================================================================
// 叙事历史（战报正文连续记录）
// =================================================================

/**
 * @description 单条叙事历史记录（用于把每次生成的战报正文串起来，供后续续写）。
 */
export interface NarrativeHistoryEntry {
  id: string;
  title: string;
  content: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * @description 叙事历史数据卡（可上传到云端，占用数据卡槽位）。
 */
export interface NarrativeHistoryDataCardV1 {
  templateId: 'narrative-history';
  version: 1;
  title?: string;
  updatedAt: string; // ISO 8601
  entries: NarrativeHistoryEntry[];
}
