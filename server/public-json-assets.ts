import seasonsConfig from '@/public/config/seasons.json';
import canshou100Questions from '@/public/questionnaires/presets/canshou-100-questions.json';
import canshouAfterworkWorldLoreCore from '@/public/questionnaires/presets/canshou-afterwork-world-lore-core.json';
import canshouAfterworkWorldLoreEvolution from '@/public/questionnaires/presets/canshou-afterwork-world-lore-evolution.json';
import canshouAfterworkWorld from '@/public/questionnaires/presets/canshou-afterwork-world.json';
import canshouDefault from '@/public/questionnaires/presets/canshou-default.json';
import canshouFullProfile from '@/public/questionnaires/presets/canshou-full-profile.json';
import canshouHungerShape from '@/public/questionnaires/presets/canshou-hunger-shape.json';
import canshouMbtiProfile from '@/public/questionnaires/presets/canshou-mbti-profile.json';
import canshouNestEcho from '@/public/questionnaires/presets/canshou-nest-echo.json';
import girlBandTaibanWar from '@/public/questionnaires/presets/girl-band-taiban-war-1.1.json';
import presetIndex from '@/public/questionnaires/presets/index.json';
import magicalGirl100Questions from '@/public/questionnaires/presets/magical-girl-100-questions.json';
import magicalGirlAfterworkWorldLoreCore from '@/public/questionnaires/presets/magical-girl-afterwork-world-lore-core.json';
import magicalGirlAfterworkWorldLorePowerSystem from '@/public/questionnaires/presets/magical-girl-afterwork-world-lore-power-system.json';
import magicalGirlAfterworkWorld from '@/public/questionnaires/presets/magical-girl-afterwork-world.json';
import magicalGirlDefault from '@/public/questionnaires/presets/magical-girl-default.json';
import magicalGirlFullProfile from '@/public/questionnaires/presets/magical-girl-full-profile.json';
import magicalGirlHeartCompass from '@/public/questionnaires/presets/magical-girl-heart-compass.json';
import magicalGirlImmersiveVn from '@/public/questionnaires/presets/magical-girl-immersive-vn.json';
import magicalGirlMbtiProfile from '@/public/questionnaires/presets/magical-girl-mbti-profile.json';
import magicalGirlSquadDynamics from '@/public/questionnaires/presets/magical-girl-squad-dynamics.json';
import magicalGirlWastetraceTraveler from '@/public/questionnaires/presets/magical-girl-wastetrace-traveler.json';

const PUBLIC_JSON_ASSETS = new Map<string, string>([
  ['/config/seasons.json', JSON.stringify(seasonsConfig)],
  ['/questionnaires/presets/index.json', JSON.stringify(presetIndex)],
  ['/questionnaires/presets/canshou-100-questions.json', JSON.stringify(canshou100Questions)],
  ['/questionnaires/presets/canshou-afterwork-world-lore-core.json', JSON.stringify(canshouAfterworkWorldLoreCore)],
  ['/questionnaires/presets/canshou-afterwork-world-lore-evolution.json', JSON.stringify(canshouAfterworkWorldLoreEvolution)],
  ['/questionnaires/presets/canshou-afterwork-world.json', JSON.stringify(canshouAfterworkWorld)],
  ['/questionnaires/presets/canshou-default.json', JSON.stringify(canshouDefault)],
  ['/questionnaires/presets/canshou-full-profile.json', JSON.stringify(canshouFullProfile)],
  ['/questionnaires/presets/canshou-hunger-shape.json', JSON.stringify(canshouHungerShape)],
  ['/questionnaires/presets/canshou-mbti-profile.json', JSON.stringify(canshouMbtiProfile)],
  ['/questionnaires/presets/canshou-nest-echo.json', JSON.stringify(canshouNestEcho)],
  ['/questionnaires/presets/girl-band-taiban-war-1.1.json', JSON.stringify(girlBandTaibanWar)],
  ['/questionnaires/presets/magical-girl-100-questions.json', JSON.stringify(magicalGirl100Questions)],
  ['/questionnaires/presets/magical-girl-afterwork-world-lore-core.json', JSON.stringify(magicalGirlAfterworkWorldLoreCore)],
  ['/questionnaires/presets/magical-girl-afterwork-world-lore-power-system.json', JSON.stringify(magicalGirlAfterworkWorldLorePowerSystem)],
  ['/questionnaires/presets/magical-girl-afterwork-world.json', JSON.stringify(magicalGirlAfterworkWorld)],
  ['/questionnaires/presets/magical-girl-default.json', JSON.stringify(magicalGirlDefault)],
  ['/questionnaires/presets/magical-girl-full-profile.json', JSON.stringify(magicalGirlFullProfile)],
  ['/questionnaires/presets/magical-girl-heart-compass.json', JSON.stringify(magicalGirlHeartCompass)],
  ['/questionnaires/presets/magical-girl-immersive-vn.json', JSON.stringify(magicalGirlImmersiveVn)],
  ['/questionnaires/presets/magical-girl-mbti-profile.json', JSON.stringify(magicalGirlMbtiProfile)],
  ['/questionnaires/presets/magical-girl-squad-dynamics.json', JSON.stringify(magicalGirlSquadDynamics)],
  ['/questionnaires/presets/magical-girl-wastetrace-traveler.json', JSON.stringify(magicalGirlWastetraceTraveler)],
]);

export const getPublicJsonAssetResponse = (pathname: string): Response | null => {
  const body = PUBLIC_JSON_ASSETS.get(pathname);
  if (body === undefined) return null;

  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
};
