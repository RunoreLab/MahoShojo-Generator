import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import type { DesktopCardLibraryRequest } from '@mahoshojo/contracts/desktop-cloud';
import type { OwnedDataCardReplacementTarget } from '@mahoshojo/contracts/data-cards';
import { requestCardLibraryRoute } from '../src/platform/card-library-bridge';
import { createCloudCard, readCloudReplaceTarget, replaceCloudCard } from '../src/platform/private-cloud-save';
const fixture = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-cloud.json', import.meta.url), 'utf8')).cardLibrary as {
  ownedRequests: { valid: DesktopCardLibraryRequest[]; invalid: DesktopCardLibraryRequest[] };
  ownedResponses: { valid: Wire[]; invalid: Wire[] };
};
interface Wire { request: DesktopCardLibraryRequest; status: number; body: unknown }
const consume = async (wire: Wire) => {
  const invoke = vi.fn(async () => ({ status: wire.status, body: wire.body }));
  const request = wire.request;
  const body = request.body as Record<string, any>;
  let result;
  if (request.routeId === 'data-cards.create') result = await createCloudCard(invoke, request.expectedUserId!, { ...body, isPublic: body.isPublic === true || body.isPublic === 1 ? 1 : 0 } as never);
  else if (request.routeId === 'data-cards.replace-target.query') result = await readCloudReplaceTarget(invoke, request.expectedUserId!, request.query!.id);
  else result = await replaceCloudCard(invoke, request.expectedUserId!, { id: body.id, type: body.type, version: body.expectedVersion, name: 'target', description: null, isPublic: 0, reviewStatus: 'pending', hasPendingUpdate: false } as OwnedDataCardReplacementTarget, body.data);
  expect(invoke).toHaveBeenCalledOnce();
  return result;
};
describe('owned cloud fixture through actual renderer bridge and adapters', () => {
  test.each(fixture.ownedRequests?.valid ?? [])('request accepted %j', async (request) => {
    const invoke = vi.fn(async () => ({ status: 400, body: {} }));
    await requestCardLibraryRoute(invoke, request); expect(invoke).toHaveBeenCalledOnce();
  });
  test.each(fixture.ownedRequests?.invalid ?? [])('request rejected before IPC %j', async (request) => {
    const invoke = vi.fn(); await expect(requestCardLibraryRoute(invoke, request)).rejects.toMatchObject({ code: 'invalid-request' }); expect(invoke).not.toHaveBeenCalled();
  });
  test('fixture contains bidirectional owned request/response cases', () => {
    for (const group of [fixture.ownedRequests, fixture.ownedResponses]) { expect(group.valid.length).toBeGreaterThan(0); expect(group.invalid.length).toBeGreaterThan(0); }
  });
  test.each(fixture.ownedResponses?.valid ?? [])('owned acknowledgement accepted %j', async (wire) => {
    const result = await consume(wire); expect(['saved', 'ready']).toContain(result.kind);
  });
  test.each(fixture.ownedResponses?.invalid ?? [])('owned acknowledgement rejected without replay %j', async (wire) => {
    const result = await consume(wire); expect(['saved', 'ready']).not.toContain(result.kind);
  });
});
