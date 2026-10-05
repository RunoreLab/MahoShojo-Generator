import magicalQuestionnaire from '../../../content/questionnaires/presets/magical-girl-default.json';
import canshouQuestionnaire from '../public/questionnaires/presets/canshou-default.json';

// 魔法少女默认问卷的权威源已迁移到仓库根 content/；这里不能依赖生成到 public/ 的副本。
// 残兽默认问卷仍是 Web 侧现有资源，待其迁移时一并调整这个入口。
export { magicalQuestionnaire, canshouQuestionnaire };
