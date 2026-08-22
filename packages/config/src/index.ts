export const workspaceDirectories = ['apps', 'packages'] as const;

export const legacyRootApp = 'root' as const;

export type WorkspaceDirectory = (typeof workspaceDirectories)[number];
