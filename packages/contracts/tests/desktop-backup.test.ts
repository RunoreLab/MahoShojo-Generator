import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/desktop-backup.json';
import {
  DesktopBackupIdSchema, DesktopBackupSummarySchema, DesktopBackupListSchema, DesktopBackupErrorSchema,
} from '../src/desktop-ipc';

describe('native backup IPC', () => {
  it('shares the native identity and response fixtures', () => {
    for (const id of fixture.validIds) expect(DesktopBackupIdSchema.safeParse(id).success, id).toBe(true);
    for (const id of fixture.invalidIds) expect(DesktopBackupIdSchema.safeParse(id).success, id).toBe(false);
    expect(DesktopBackupSummarySchema.parse(fixture.summary)).toEqual(fixture.summary);
    expect(DesktopBackupListSchema.parse({ backups: [fixture.summary], invalidCount: 1 }).invalidCount).toBe(1);
    for (const code of fixture.errorCodes) {
      expect(DesktopBackupErrorSchema.parse({ code, message: 'safe static error' }).code).toBe(code);
    }
  });
  it('rejects unsafe counts and undeclared secret fields', () => {
    expect(DesktopBackupSummarySchema.safeParse({ ...fixture.summary, secret: 'must not escape' }).success).toBe(false);
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(DesktopBackupSummarySchema.safeParse({ ...fixture.summary, blobBytes: value }).success).toBe(false);
    }
  });
});
