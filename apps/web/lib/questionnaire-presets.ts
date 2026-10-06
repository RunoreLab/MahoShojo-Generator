import magicalQuestionnaire from '../../../content/questionnaires/presets/magical-girl-default.json';
import canshouQuestionnaire from '../../../content/questionnaires/presets/canshou-default.json';

// 两份默认问卷的权威源都在仓库根 content/；public/ 副本由内容生成器在 dev/build 时产出，
// 测试与 lint 流程里并不存在，因此这里一律从权威源导入（MONO-006）。
export { magicalQuestionnaire, canshouQuestionnaire };
