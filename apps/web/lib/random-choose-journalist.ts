import journalistsData from '../public/journalists.json';

export interface JournalistInfo {
  name: string;
  publication: string;
}

// 定义记者条目的接口
interface JournalistEntry {
    name: string;
    source?: string;
}

/**
 * 从 journalists.json 中随机抽取记者和媒体。
 * 规则：
 * 1. 从 journalists 数组中随机选择一名记者。
 * 2. 如果该记者有绑定的媒体（source），则直接使用。
 * 3. 如果该记者没有绑定的媒体（自由记者），则从独立的 sources 数组中随机选择一个。
 * @returns {JournalistInfo} 包含记者和媒体信息的对象
 */
export function getRandomJournalist(): JournalistInfo {
    const journalists: JournalistEntry[] = journalistsData.journalists;
    const sources: string[] = journalistsData.sources;

    if (!journalists || journalists.length === 0) {
        // 如果列表为空，返回一个默认值以避免崩溃
        return { name: '佚名记者', publication: '魔法国度时报' };
    }

    // 1. 随机抽取一名记者
    const randomJournalistIndex = Math.floor(Math.random() * journalists.length);
    const selectedJournalist = journalists[randomJournalistIndex];

    const name = selectedJournalist.name;
    let publication = selectedJournalist.source;

    // 2. 如果是自由记者，则从独立的 sources 数组中分配一个媒体
    if (!publication) {
        if (sources && sources.length > 0) {
            const randomSourceIndex = Math.floor(Math.random() * sources.length);
            publication = sources[randomSourceIndex];
        } else {
            // 如果没有可用媒体，给一个默认值
            publication = '魔法国度时报';
        }
    }

    return { name, publication: publication! };
}