/**
 * 客户端随机角色生成（无签名）。
 *
 * 素材库权威在仓库根 `content/random-assets/`（与 `flowers.ts` 同一模式：
 * 包源码直接 import content JSON，构建期打包进各宿主，不走运行时 fetch）。
 * 客户端本地生成无法持有签名密钥；Web 侧由服务端补签，Desktop 侧保持未签名。
 */
import mgCodenameAppearance from '../../../content/random-assets/magical-girl/codename_appearance.json';
import mgMagicConstruct from '../../../content/random-assets/magical-girl/magicConstruct.json';
import mgWonderlandRule from '../../../content/random-assets/magical-girl/wonderlandRule.json';
import mgBlooming from '../../../content/random-assets/magical-girl/blooming.json';
import mgAnalysis from '../../../content/random-assets/magical-girl/analysis.json';

import canshouNameAppearance from '../../../content/random-assets/canshou/name_appearance.json';
import canshouCore from '../../../content/random-assets/canshou/core.json';
import canshouStage from '../../../content/random-assets/canshou/stage.json';
import canshouAbilities from '../../../content/random-assets/canshou/abilities.json';
import canshouLore from '../../../content/random-assets/canshou/lore.json';

const getRandomElement = <T>(arr: T[]): T => {
  if (!arr || arr.length === 0) {
    return {} as T;
  }
  return arr[Math.floor(Math.random() * arr.length)];
};

/** 同步生成一份完整魔法少女设定（不含签名）。调用方按页面模板形状使用。 */
export const generateRandomMagicalGirl = (): any => {
  const data = {
    ...getRandomElement(mgCodenameAppearance),
    magicConstruct: getRandomElement(mgMagicConstruct),
    wonderlandRule: getRandomElement(mgWonderlandRule),
    blooming: getRandomElement(mgBlooming),
    analysis: getRandomElement(mgAnalysis),
    templateId: '魔法少女/心之花/魔法少女（问卷生成）',
  };
  return data;
};

/** 同步生成一份完整残兽设定（不含签名）。调用方按页面模板形状使用。 */
export const generateRandomCanshou = (): any => {
  const data = {
    ...getRandomElement(canshouNameAppearance),
    ...getRandomElement(canshouCore),
    ...getRandomElement(canshouStage),
    ...getRandomElement(canshouAbilities),
    ...getRandomElement(canshouLore),
    templateId: '魔法少女/心之花/残兽（问卷生成）',
  };
  return data;
};
