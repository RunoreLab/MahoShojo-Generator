// lib/random-character-generator.ts

/**
 * @fileoverview 客户端随机角色生成工具。
 * 该模块将原有的后端API逻辑迁移至客户端，以避免API速率限制问题。
 * [V0.3.1 修正] 移除了客户端签名逻辑，因为客户端无法访问服务端密钥。
 * 签名将在角色数据发送到服务端后，由服务端进行补签。
 */

// 导入所有需要的预设素材库JSON文件
import mgCodenameAppearance from '../public/random-assets/magical-girl/codename_appearance.json';
import mgMagicConstruct from '../public/random-assets/magical-girl/magicConstruct.json';
import mgWonderlandRule from '../public/random-assets/magical-girl/wonderlandRule.json';
import mgBlooming from '../public/random-assets/magical-girl/blooming.json';
import mgAnalysis from '../public/random-assets/magical-girl/analysis.json';

import canshouNameAppearance from '../public/random-assets/canshou/name_appearance.json';
import canshouCore from '../public/random-assets/canshou/core.json';
import canshouStage from '../public/random-assets/canshou/stage.json';
import canshouAbilities from '../public/random-assets/canshou/abilities.json';
import canshouLore from '../public/random-assets/canshou/lore.json';

/**
 * 从数组中随机选择一个元素。
 * @param arr - 来源数组。
 * @returns 数组中的一个随机元素。
 */
const getRandomElement = <T>(arr: T[]): T => {
  if (!arr || arr.length === 0) {
    return {} as T;
  }
  return arr[Math.floor(Math.random() * arr.length)];
};

/**
 * 同步生成一个包含完整设定的随机魔法少女对象。
 * @returns {any} 返回一个完整的魔法少女设定对象（不含签名）。
 */
export const generateRandomMagicalGirl = (): any => {
  // 从各个JSON模块中随机抽取部分来组合成一个完整的角色
  const data = {
    ...getRandomElement(mgCodenameAppearance),
    magicConstruct: getRandomElement(mgMagicConstruct),
    wonderlandRule: getRandomElement(mgWonderlandRule),
    blooming: getRandomElement(mgBlooming),
    analysis: getRandomElement(mgAnalysis),
    // 附加模板ID，使其结构与问卷生成的高级角色保持一致
    templateId: "魔法少女/心之花/魔法少女（问卷生成）",
  };
  
  return data;
};

/**
 * 同步生成一个包含完整设定的随机残兽对象。
 * @returns {any} 返回一个完整的残兽设定对象（不含签名）。
 */
export const generateRandomCanshou = (): any => {
  // 从各个JSON模块中随机抽取部分来组合成一个完整的角色
  const data = {
    ...getRandomElement(canshouNameAppearance),
    ...getRandomElement(canshouCore),
    ...getRandomElement(canshouStage),
    ...getRandomElement(canshouAbilities),
    ...getRandomElement(canshouLore),
    // 附加模板ID
    templateId: "魔法少女/心之花/残兽（问卷生成）",
  };

  return data;
};