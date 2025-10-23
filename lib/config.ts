// lib/config.ts

// AI 提供商配置接口
export interface AIProvider {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string | string[]; // 支持单个模型或多个模型数组
  type: 'openai' | 'google';
  retryCount?: number;
  skipProbability?: number;
  mode?: 'json' | 'auto' | 'tool' | undefined;
  weight?: number; // 负载均衡权重，数值越大被选中概率越高
}

// [新增 v0.2.1] AI 安全检查策略配置接口 (SRS 3.1.1)
export interface SafetyCheckPolicy {
    character: 'non-native-only' | 'all' | 'none'; // 角色文件检查策略
    scenario: 'non-native-only' | 'all' | 'none';  // 情景文件检查策略
    userGuidance: 'all' | 'none';                   // 故事引导检查策略
}

// 解析 AI 提供商配置的函数
const parseAIProviders = (): AIProvider[] => {
  // JSON 配置方式
  if (process.env.AI_PROVIDERS_CONFIG) {
    try {
      const providers = JSON.parse(process.env.AI_PROVIDERS_CONFIG) as AIProvider[];
      return providers
        .filter(p => p.apiKey && p.baseUrl && p.model && p.type)
        .map(p => ({
          ...p,
          retryCount: p.retryCount ?? 1,
          skipProbability: p.skipProbability ?? 0
        }));
    } catch (error) {
      console.warn('解析 AI_PROVIDERS_CONFIG 失败，回退到简单配置:', error);
    }
  }

  // 向后兼容：单个 API Key 方式
  const singleKey = process.env.AI_API_KEY;
  const singleUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const singleModel = process.env.AI_MODEL || 'gemini-2.0-flash';

  if (singleKey) {
    return [{
      name: 'default_provider',
      apiKey: singleKey,
      baseUrl: singleUrl,
      model: singleModel,
      type: singleUrl.includes('googleapis.com') ? 'google' : 'openai',
      retryCount: 1,
      skipProbability: 0
    }];
  }

  return [];
};

// 获取有效的 API 提供商（按配置顺序）
const getAPIProviders = (): AIProvider[] => {
  return parseAIProviders();
};

// 为了保持向后兼容，转换为原有的格式
const parseApiPairs = () => {
  const providers = getAPIProviders();
  return providers.map(provider => ({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    name: provider.name,
    model: provider.model,
    mode: provider?.mode || 'auto'
  }));
};

// 获取第一个提供商的模型
const getDefaultModel = (): string | string[] => {
  const providers = getAPIProviders();
  if (providers.length > 0) {
    return providers[0].model;
  }
  return 'gemini-2.5-flash';
};

// 获取负载均衡策略
const getLoadBalanceStrategy = (): string => {
  return process.env.AI_LOAD_BALANCE_STRATEGY || 'random';
};

// 获取统计数据显示开关
const getShowStatData = (): boolean => {
  const showStat = process.env.SHOW_STAT_DATA || 'false';
  if (showStat === 'false' || showStat === '0') {
    return false;
  }
  return true; // 默认显示统计数据
};

// 获取排行榜模式
const getLeaderboardMode = (): 'all' | 'preset' | 'user' => {
  const mode = process.env.LEADERBOARD_MODE;
  if (mode === 'preset' || mode === 'user') {
    return mode;
  }
  return 'all'; // 默认为 'all'
};

// 获取竞技场用户引导功能开关
const getEnableArenaUserGuidance = (): boolean => {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_ARENA_USER_GUIDANCE ?? 'true';
  return enabled === 'true';
};

// 获取世界观检查功能开关的函数
const getEnableWorldviewCheck = (): boolean => {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_WORLDVIEW_CHECK ?? 'false';
  // 默认关闭，只有当环境变量明确设置为 'true' 时才开启
  return enabled === 'true';
};

// 获取内容安全检查相关开关的函数
const getEnableSensitiveWordFilter = (): boolean => {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER ?? 'true';
  return enabled === 'true';
};

const getEnableAiSafetyCheck = (): boolean => {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_AI_SAFETY_CHECK ?? 'false';
  return enabled === 'true';
};

const getSkipNativeScenarioCheck = (): boolean => {
  const enabled = process.env.NEXT_PUBLIC_SKIP_NATIVE_SCENARIO_CHECK ?? 'true';
  return enabled === 'true';
};

// --- [新增 v0.2.1] AI安全检查策略配置 ---

/**
 * 获取AI安全检查策略 (SRS 3.1.1)
 * @returns {SafetyCheckPolicy} 详细的检查策略对象
 */
const getSafetyCheckPolicy = (): SafetyCheckPolicy => {
    try {
        if (process.env.NEXT_PUBLIC_SAFETY_CHECK_POLICY) {
            const parsed = JSON.parse(process.env.NEXT_PUBLIC_SAFETY_CHECK_POLICY);
            return {
                character: parsed.character || 'non-native-only',
                scenario: parsed.scenario || 'non-native-only',
                userGuidance: parsed.userGuidance || 'all',
            };
        }
    } catch (e) {
        console.error("解析 NEXT_PUBLIC_SAFETY_CHECK_POLICY 失败，使用默认值", e);
    }
    // 默认策略
    return {
        character: 'non-native-only',
        scenario: 'non-native-only',
        userGuidance: 'all',
    };
};

/**
 * 获取是否启用“连坐”打包检查机制 (SRS 3.1.2)
 * @returns {boolean} 是否启用
 */
const getEnableBundleSafetyCheck = (): boolean => {
    // 默认为 true, 只有当环境变量明确设置为 'false' 时才禁用
    return process.env.NEXT_PUBLIC_ENABLE_BUNDLE_SAFETY_CHECK !== 'false';
};

/**
 * 获取AI安全检查提示词等级 (SRS 3.1.3)
 * @returns {'strict' | 'moderate' | 'lenient'} 提示词等级
 */
const getAiSafetyPromptLevel = (): 'strict' | 'moderate' | 'lenient' => {
    const level = process.env.NEXT_PUBLIC_AI_SAFETY_PROMPT_LEVEL;
    if (level === 'strict' || level === 'lenient') {
        return level;
    }
    return 'moderate'; // 默认为 'moderate'
};

/**
 * [新增] 获取是否允许被引导的升华保持原生性签名。
 * @returns {boolean}
 */
const getAllowGuidedSublimationNativeSigning = (): boolean => {
    // 默认为 false, 只有当环境变量明确设置为 'true' 时才开启
    return process.env.ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING === 'true';
};

export const config = {
  // Vercel AI 配置
  API_PAIRS: parseApiPairs(),
  MODEL: getDefaultModel(),
  PROVIDERS: getAPIProviders(),
  LOAD_BALANCE_STRATEGY: getLoadBalanceStrategy(),

  // 统计数据显示开关配置
  SHOW_STAT_DATA: getShowStatData(),

  // 排行榜模式配置
  LEADERBOARD_MODE: getLeaderboardMode(),

  // 竞技场用户引导功能开关
  ENABLE_ARENA_USER_GUIDANCE: getEnableArenaUserGuidance(),

  // 世界观检查功能开关
  ENABLE_WORLDVIEW_CHECK: getEnableWorldviewCheck(),

  // 内容安全与检查机制开关
  ENABLE_SENSITIVE_WORD_FILTER: getEnableSensitiveWordFilter(),
  ENABLE_AI_SAFETY_CHECK: getEnableAiSafetyCheck(),
  SKIP_NATIVE_SCENARIO_CHECK: getSkipNativeScenarioCheck(),

  // [新增 v0.2.1] AI安全检查策略
  SAFETY_CHECK_POLICY: getSafetyCheckPolicy(),
  ENABLE_BUNDLE_SAFETY_CHECK: getEnableBundleSafetyCheck(),
  AI_SAFETY_PROMPT_LEVEL: getAiSafetyPromptLevel(),

  // [新增] 升华功能配置
  ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING: getAllowGuidedSublimationNativeSigning(),

  // 数据卡管理配置
  DEFAULT_DATA_CARD_CAPACITY: 20,
  RECYCLE_BIN_LIMIT: 5,

  // 魔法少女生成配置
  MAGICAL_GIRL_GENERATION: {
    temperature: 0.8,
    systemPrompt: `你是一个专业的魔法少女角色设计师。请根据用户输入的真名，设计一个独特的魔法少女角色。
设计要求：
1. 魔法少女名字应该以花名为主题，要与用户的真名有某种关联性或呼应
2. 外貌特征要协调统一，符合魔法少女的设定
3. 变身咒语要朗朗上口，充满魔法感
请严格按照提供的 JSON schema 格式返回结果。`
  }
}
