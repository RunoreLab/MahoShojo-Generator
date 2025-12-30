export const MainColor = {
    Red: '红色',
    Orange: '橙色',
    Cyan: '青色',
    Blue: '蓝色',
    Purple: '紫色',
    Pink: '粉色',
    Yellow: '黄色',
    Green: '绿色'
} as const;

export type MainColorKey = keyof typeof MainColor;
export type MainColorLabel = (typeof MainColor)[MainColorKey];

export const MAIN_COLOR_KEYS = Object.keys(MainColor) as MainColorKey[];

export const COLOR_GRADIENTS: Record<MainColorLabel, { first: string; second: string }> = {
  [MainColor.Red]: { first: '#ff6b6b', second: '#ee5a6f' },
  [MainColor.Orange]: { first: '#ff922b', second: '#ffa94d' },
  [MainColor.Cyan]: { first: '#22b8cf', second: '#66d9e8' },
  [MainColor.Blue]: { first: '#5c7cfa', second: '#748ffc' },
  [MainColor.Purple]: { first: '#9775fa', second: '#b197fc' },
  [MainColor.Pink]: { first: '#ff9a9e', second: '#fecfef' },
  [MainColor.Yellow]: { first: '#f59f00', second: '#fcc419' },
  [MainColor.Green]: { first: '#51cf66', second: '#8ce99a' },
};

export function getMainColorGradient(key: MainColorKey | null | undefined): { first: string; second: string } {
  const resolvedKey: MainColorKey = key && key in MainColor ? (key as MainColorKey) : 'Pink';
  const label = MainColor[resolvedKey];
  return COLOR_GRADIENTS[label] ?? COLOR_GRADIENTS[MainColor.Pink];
}
