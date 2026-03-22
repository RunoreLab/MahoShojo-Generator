import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import {
  OFFICIAL_KEY_ARENA_BATTLE_REPORT_COOLDOWN_MS,
  USER_PROVIDED_KEY_COOLDOWN_MS,
} from '@/lib/ai/cooldowns';
import { isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
import type { ProviderCooldownMode } from '@/lib/cooldown';

export const ARENA_PROVIDER_COOLDOWN_BASE_KEY = 'generateBattleCooldown';

export type ArenaProviderCooldownConfig = {
  currentMode: ProviderCooldownMode;
  systemDurationMs: number;
  customDurationMs: number;
};

export const resolveArenaProviderCooldownConfig = (
  config: UserAIProviderConfig | null | undefined
): ArenaProviderCooldownConfig => ({
  currentMode: isUsingUserProvidedKey(config) ? 'custom' : 'system',
  systemDurationMs: OFFICIAL_KEY_ARENA_BATTLE_REPORT_COOLDOWN_MS,
  customDurationMs: USER_PROVIDED_KEY_COOLDOWN_MS,
});
