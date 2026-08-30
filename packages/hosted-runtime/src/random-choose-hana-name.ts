import flowersData from './assets/flowers.json';

export interface Flower {
    name: string;
    meaning: string;
}

/**
 * 从flowers.json中随机选择指定数量的花和它们的含义
 * @param count 要选择的花的数量，默认为10
 * @returns 包含选中花朵信息的字符串
 */
export function getRandomFlowers(count: number = 10): string {
    const flowers = flowersData.flowers;

    // 创建花朵数组的副本，避免修改原数组
    const shuffledFlowers = [...flowers];

    // Fisher-Yates 洗牌算法
    for (let i = shuffledFlowers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledFlowers[i], shuffledFlowers[j]] = [shuffledFlowers[j], shuffledFlowers[i]];
    }

    // 取前count个花朵
    const selectedFlowers = shuffledFlowers.slice(0, count);

    // 格式化为字符串
    const result = selectedFlowers
        .map((flower, index) => `${index + 1}. ${flower.name} - ${flower.meaning}`)
        .join('\n');

    return result;
}

/**
 * 获取随机花朵并以对象数组形式返回
 * @param count 要选择的花的数量，默认为10
 * @returns 包含选中花朵的对象数组
 */
export function getRandomFlowersArray(count: number = 10): Flower[] {
    const flowers = flowersData.flowers;

    const shuffledFlowers = [...flowers];

    for (let i = shuffledFlowers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledFlowers[i], shuffledFlowers[j]] = [shuffledFlowers[j], shuffledFlowers[i]];
    }

    return shuffledFlowers.slice(0, count);
}

export const randomChooseHanaName = () => {
    const hanaNames = [''];
    return hanaNames[Math.floor(Math.random() * hanaNames.length)];
};

// 随机获取一个花名
export const randomChooseOneHanaName = () => {
    const flowers = getRandomFlowersArray(1);
    return flowers[0].name;
}
