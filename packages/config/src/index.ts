export const workspaceDirectories = ['apps', 'packages'] as const;

export const webApplicationDirectory = 'apps/web' as const;

export type WorkspaceDirectory = (typeof workspaceDirectories)[number];
