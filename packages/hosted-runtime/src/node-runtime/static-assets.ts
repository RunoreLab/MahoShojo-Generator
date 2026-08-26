import questionnairePresetIndex from '../assets/questionnaires/presets/index.json';
import { DEFAULT_ARENA_PROMPT_QUESTIONS } from '../arena-generation/compatibility-prompt';
import { QUESTIONNAIRE_PRESET_ASSETS } from '../generated/questionnaire-presets';

export { CANSHOU_LORE } from '../canshou-lore';
export {
  getRandomFlowers,
  getRandomFlowersArray,
  randomChooseHanaName,
  randomChooseOneHanaName,
  type Flower,
} from '../random-choose-hana-name';

export const QUESTIONNAIRE_PRESET_INDEX = questionnairePresetIndex;

export const loadQuestionnairePresetAsset = (path: string): unknown => {
  const asset = QUESTIONNAIRE_PRESET_ASSETS[path];
  return asset === undefined ? null : structuredClone(asset);
};

export const DEFAULT_MAGICAL_GIRL_QUESTION_TEXTS =
  DEFAULT_ARENA_PROMPT_QUESTIONS.magicalGirl;
export const DEFAULT_CANSHOU_QUESTION_TEXTS = DEFAULT_ARENA_PROMPT_QUESTIONS.canshou;
