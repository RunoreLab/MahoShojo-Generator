import { describe, expect, test } from 'bun:test';

import { getAdminDataCleanupTargetSchemas } from '@/lib/database/admin-data-maintenance';

describe('admin data maintenance target schemas', () => {
  test('暴露最新的 Auth / PVP / 战报扩展 target', () => {
    const schemas = getAdminDataCleanupTargetSchemas();
    const targetMap = new Map(schemas.map((item) => [item.target, item]));

    expect(targetMap.has('battle_report_generation_combatants')).toBeTrue();
    expect(targetMap.has('auth_audit_logs')).toBeTrue();
    expect(targetMap.has('auth_password_reset_tokens')).toBeTrue();
    expect(targetMap.has('ba_verification')).toBeTrue();
    expect(targetMap.has('user_auth_links')).toBeTrue();
    expect(targetMap.has('pvp_room_chat_messages')).toBeTrue();
    expect(targetMap.has('pvp_room_hands')).toBeTrue();
    expect(targetMap.has('pvp_room_submissions')).toBeTrue();
    expect(targetMap.has('pvp_room_card_snapshots')).toBeTrue();
    expect(targetMap.has('pvp_round_choices')).toBeTrue();

    expect(targetMap.get('user_auth_links')?.previewOnly).toBeTrue();
    expect(targetMap.get('auth_audit_logs')?.previewOnly).toBeFalse();
    expect(targetMap.get('pvp_room_submissions')?.previewOnly).toBeFalse();
    expect(targetMap.get('auth_audit_logs')?.fieldDefinitions.map((item) => item.field)).toContain('metadata_json');
    expect(targetMap.get('battle_report_generation_combatants')?.fieldDefinitions.map((item) => item.field)).toEqual([
      'character_guidance',
    ]);
    expect(targetMap.get('pvp_room_hands')?.fieldDefinitions.map((item) => item.field)).toEqual(['hand_json']);
  });
});
