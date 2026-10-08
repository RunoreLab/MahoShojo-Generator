import { COLOR_GRADIENTS, MAIN_COLOR_VALUES, MainColor } from '@mahoshojo/domain/main-color';

/** 沿用 Web 角色管理的颜色匹配顺序与粉色回退，颜色值仅由 domain 维护。 */
export function resolveMagicalGirlGradient(colorScheme: unknown): string {
  const text = typeof colorScheme === 'string' ? colorScheme : '';
  const color = MAIN_COLOR_VALUES.find((candidate) => text.includes(candidate)) ?? MainColor.Pink;
  const { first, second } = COLOR_GRADIENTS[color];
  return `linear-gradient(135deg, ${first} 0%, ${second} 100%)`;
}
