import { webApplicationDirectory, workspaceDirectories } from '@mahoshojo/config';

describe('@mahoshojo/config exports', () => {
  it('resolves the public package entrypoint and exposes only workspace layout data', () => {
    expect(workspaceDirectories).toEqual(['apps', 'packages']);
    expect(webApplicationDirectory).toBe('apps/web');
  });
});
