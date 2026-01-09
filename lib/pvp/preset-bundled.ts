import C01_egg from '@/public/presets/C01_egg.json';
import C02_pupa from '@/public/presets/C02_pupa.json';
import C03_choir_and_dancer from '@/public/presets/C03_choir_and_dancer.json';
import C04_flesh_spider_web from '@/public/presets/C04_flesh_spider_web.json';
import C05_cinder_guard_spider from '@/public/presets/C05_cinder_guard_spider.json';
import C06_moth from '@/public/presets/C06_moth.json';
import C07_returning_to_simplicity from '@/public/presets/C07_returning_to_simplicity.json';
import C08_silent_worm from '@/public/presets/C08_silent_worm.json';
import M00_white_lily from '@/public/presets/M00_white_lily.json';
import M01_centaurea from '@/public/presets/M01_centaurea.json';
import M02_white_rose from '@/public/presets/M02_white_rose.json';
import M03_little_brocade from '@/public/presets/M03_little_brocade.json';
import M04_boxue from '@/public/presets/M04_boxue.json';
import M05_kite from '@/public/presets/M05_kite.json';
import M06_sparrow from '@/public/presets/M06_sparrow.json';
import M07_margaret from '@/public/presets/M07_margaret.json';
import M08_asagao from '@/public/presets/M08_asagao.json';
import M09_pine_flower from '@/public/presets/M09_pine_flower.json';
import M10_mugwort from '@/public/presets/M10_mugwort.json';
import M11_sunflower from '@/public/presets/M11_sunflower.json';
import M12_greatness_in_simplicity from '@/public/presets/M12_greatness_in_simplicity.json';
import M13_greatness_in_complexity from '@/public/presets/M13_greatness_in_complexity.json';
import M14_centaurea_claw_marks from '@/public/presets/M14_centaurea_claw_marks.json';
import M15_centaurea_in_heart from '@/public/presets/M15_centaurea_in_heart.json';
import M90_goose from '@/public/presets/M90_goose.json';
import U_CS_horde from '@/public/presets/U_CS_horde.json';
import U_CS_horde_strong from '@/public/presets/U_CS_horde_strong.json';
import U_CS_horde_tide from '@/public/presets/U_CS_horde_tide.json';
import U_CS_horde_weak from '@/public/presets/U_CS_horde_weak.json';
import U_CS_solo from '@/public/presets/U_CS_solo.json';
import U_CS_solo_boss from '@/public/presets/U_CS_solo_boss.json';
import U_CS_solo_strong from '@/public/presets/U_CS_solo_strong.json';
import U_CS_solo_weak from '@/public/presets/U_CS_solo_weak.json';
import U_MG_solo from '@/public/presets/U_MG_solo.json';
import U_MG_solo_strong from '@/public/presets/U_MG_solo_strong.json';
import U_MG_solo_top from '@/public/presets/U_MG_solo_top.json';
import U_MG_solo_weak from '@/public/presets/U_MG_solo_weak.json';
import U_MG_team from '@/public/presets/U_MG_team.json';
import U_MG_team_strong from '@/public/presets/U_MG_team_strong.json';
import U_MG_team_top from '@/public/presets/U_MG_team_top.json';
import U_MG_team_weak from '@/public/presets/U_MG_team_weak.json';

const PRESET_DATA_BY_FILENAME: Record<string, unknown> = {
  'C01_egg.json': C01_egg,
  'C02_pupa.json': C02_pupa,
  'C03_choir_and_dancer.json': C03_choir_and_dancer,
  'C04_flesh_spider_web.json': C04_flesh_spider_web,
  'C05_cinder_guard_spider.json': C05_cinder_guard_spider,
  'C06_moth.json': C06_moth,
  'C07_returning_to_simplicity.json': C07_returning_to_simplicity,
  'C08_silent_worm.json': C08_silent_worm,
  'M00_white_lily.json': M00_white_lily,
  'M01_centaurea.json': M01_centaurea,
  'M02_white_rose.json': M02_white_rose,
  'M03_little_brocade.json': M03_little_brocade,
  'M04_boxue.json': M04_boxue,
  'M05_kite.json': M05_kite,
  'M06_sparrow.json': M06_sparrow,
  'M07_margaret.json': M07_margaret,
  'M08_asagao.json': M08_asagao,
  'M09_pine_flower.json': M09_pine_flower,
  'M10_mugwort.json': M10_mugwort,
  'M11_sunflower.json': M11_sunflower,
  'M12_greatness_in_simplicity.json': M12_greatness_in_simplicity,
  'M13_greatness_in_complexity.json': M13_greatness_in_complexity,
  'M14_centaurea_claw_marks.json': M14_centaurea_claw_marks,
  'M15_centaurea_in_heart.json': M15_centaurea_in_heart,
  'M90_goose.json': M90_goose,
  'U_MG_solo.json': U_MG_solo,
  'U_MG_solo_weak.json': U_MG_solo_weak,
  'U_MG_solo_strong.json': U_MG_solo_strong,
  'U_MG_solo_top.json': U_MG_solo_top,
  'U_MG_team.json': U_MG_team,
  'U_MG_team_weak.json': U_MG_team_weak,
  'U_MG_team_strong.json': U_MG_team_strong,
  'U_MG_team_top.json': U_MG_team_top,
  'U_CS_solo.json': U_CS_solo,
  'U_CS_solo_weak.json': U_CS_solo_weak,
  'U_CS_solo_strong.json': U_CS_solo_strong,
  'U_CS_solo_boss.json': U_CS_solo_boss,
  'U_CS_horde.json': U_CS_horde,
  'U_CS_horde_weak.json': U_CS_horde_weak,
  'U_CS_horde_strong.json': U_CS_horde_strong,
  'U_CS_horde_tide.json': U_CS_horde_tide,
};

export const BUNDLED_PRESET_FILENAMES: string[] = Object.keys(PRESET_DATA_BY_FILENAME);

export const getBundledPresetData = (filename: string): unknown | null => {
  return PRESET_DATA_BY_FILENAME[filename] ?? null;
};
