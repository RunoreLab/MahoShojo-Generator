import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/desktop-backup.json';
import restore from '../../../fixtures/desktop-restore.json';
import {
  DesktopBackupIdSchema, DesktopBackupSummarySchema, DesktopBackupListSchema, DesktopBackupErrorSchema,
  DesktopRestoreIdSchema, DesktopPrepareRestoreRequestSchema, DesktopPrepareRestoreResponseSchema, DesktopRestoreErrorSchema,
} from '../src/desktop-ipc';

describe('native backup IPC', () => {
  it('restricts restore requests to native identifiers and shares native response fixtures', () => {
    expect(DesktopPrepareRestoreRequestSchema.parse(restore.request)).toEqual(restore.request);
    expect(DesktopPrepareRestoreResponseSchema.parse(restore.response)).toEqual(restore.response);
    expect(DesktopPrepareRestoreRequestSchema.safeParse({ ...restore.request, path: 'C:/arbitrary' }).success).toBe(false);
    for (const id of restore.validIds) expect(DesktopRestoreIdSchema.safeParse(id).success, id).toBe(true);
    for (const id of restore.invalidIds) expect(DesktopRestoreIdSchema.safeParse(id).success, id).toBe(false);
    for (const code of restore.errorCodes) expect(DesktopRestoreErrorSchema.parse({ code, message: 'safe error' }).code).toBe(code);
  });
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
