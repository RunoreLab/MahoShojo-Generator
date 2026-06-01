import { describe, expect, test } from 'vitest';

import { getAdminDataCleanupTargetSchemas } from '@/lib/database/admin-data-maintenance';

describe('admin data maintenance target schemas', () => {
  test('暴露最新的 Auth / PVP / 战报扩展 target', () => {
    const schemas = getAdminDataCleanupTargetSchemas();
    const targetMap = new Map(schemas.map((item) => [item.target, item]));

    expect(targetMap.has('battle_report_generation_combatants')).toBe(true);
    expect(targetMap.has('auth_audit_logs')).toBe(true);
    expect(targetMap.has('auth_password_reset_tokens')).toBe(true);
    expect(targetMap.has('ba_verification')).toBe(true);
    expect(targetMap.has('user_auth_links')).toBe(true);
    expect(targetMap.has('pvp_room_chat_messages')).toBe(true);
    expect(targetMap.has('pvp_room_hands')).toBe(true);
    expect(targetMap.has('pvp_room_submissions')).toBe(true);
    expect(targetMap.has('pvp_room_card_snapshots')).toBe(true);
    expect(targetMap.has('pvp_round_choices')).toBe(true);

    expect(targetMap.get('user_auth_links')?.previewOnly).toBe(true);
    expect(targetMap.get('auth_audit_logs')?.previewOnly).toBe(false);
    expect(targetMap.get('pvp_room_submissions')?.previewOnly).toBe(false);
    expect(targetMap.get('auth_audit_logs')?.fieldDefinitions.map((item) => item.field)).toContain('metadata_json');
    expect(targetMap.get('battle_report_generation_combatants')?.fieldDefinitions.map((item) => item.field)).toEqual([
      'character_guidance',
    ]);
    expect(targetMap.get('pvp_room_hands')?.fieldDefinitions.map((item) => item.field)).toEqual(['hand_json']);
  });
});
