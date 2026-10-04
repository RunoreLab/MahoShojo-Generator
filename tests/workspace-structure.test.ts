import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'comment-json';

const rootDirectory = process.cwd();

describe('phase 1 workspace structure', () => {
  it('declares native pnpm apps and packages globs while preserving install policy', () => {
    const workspaceManifest = readFileSync(path.join(rootDirectory, 'pnpm-workspace.yaml'), 'utf8');

    expect(workspaceManifest).toContain('  - apps/*');
    expect(workspaceManifest).toContain('  - packages/*');
    expect(workspaceManifest).toContain('allowBuilds:');
    expect(workspaceManifest).toContain('peerDependencyRules:');
  });

  it('exposes only workspace orchestration scripts from the root package', () => {
    const packageJson = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['workspace:test']).toContain('--filter "./packages/*"');
    expect(packageJson.scripts['workspace:test']).toContain('--filter "./apps/*"');
    expect(packageJson.scripts['workspace:lint']).toContain('--filter "./packages/*"');
    expect(packageJson.scripts['workspace:build']).toContain('--filter "./apps/*"');
    expect(packageJson.scripts['workspace:checks']).toContain('check:workspace:boundaries');
    expect(packageJson.scripts['workspace:verify']).toContain('workspace:checks');
    expect(packageJson.scripts['workspace:verify']).toContain('workspace:build');
    expect(packageJson.scripts['workspace:verify']).not.toContain('pnpm test');
  });

  it('provides one CI entrypoint that verifies workspaces and repository gates', () => {
    const packageJson = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['ci:verify']).toContain('workspace:verify');
    expect(packageJson.scripts['ci:verify']).toContain('test:repo');
    expect(packageJson.scripts['ci:verify']).toContain('lint:repo');
  });

  it('ignores workspace-local generated artifacts with exact glob rules', () => {
    const gitignore = readFileSync(path.join(rootDirectory, '.gitignore'), 'utf8');

    for (const rule of [
      'apps/*/coverage/',
      'apps/*/build/',
      'apps/*/out/',
      'apps/*/.next/',
      'apps/*/.open-next/',
      'apps/*/src-tauri/target/',
      'apps/*/src-tauri/gen/schemas/',
      'packages/*/coverage/',
      'packages/*/build/',
      'packages/*/out/',
      'packages/*/.open-next/',
    ]) {
      expect(gitignore).toContain(rule);
    }
  });

  it('keeps the config PoC in explicit source-export mode', () => {
    const configPackage = JSON.parse(
      readFileSync(path.join(rootDirectory, 'packages/config/package.json'), 'utf8'),
    ) as {
      type?: string;
      scripts: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const packagesReadme = readFileSync(path.join(rootDirectory, 'packages/README.md'), 'utf8');

    expect(configPackage.type).toBe('module');
    expect(configPackage.scripts.build).toContain('--noEmit');
    expect(configPackage.devDependencies?.esbuild).toBe('^0.28.1');
    expect(existsSync(path.join(rootDirectory, 'packages/config/tsconfig.build.json'))).toBe(false);
    expect(packagesReadme).toContain('source-export');
    expect(packagesReadme).toContain('esbuild');
  });
});

describe('G25D Web workspace app ownership', () => {
  const appDirectory = path.join(rootDirectory, 'apps/web');
  const appManifestPath = path.join(appDirectory, 'package.json');

  it('moves every legacy Web ownership root into apps/web', () => {
    for (const relativePath of [
      'package.json',
      'README.md',
      'env.example',
      'app/layout.tsx',
      'components',
      'lib',
      'public',
      'tests',
      'next.config.ts',
      'open-next.config.ts',
      'wrangler.jsonc',
      'vitest.config.ts',
    ]) {
      expect(existsSync(path.join(appDirectory, relativePath)), `apps/web/${relativePath} must exist`).toBe(true);
    }

    for (const retiredRoot of [
      '.dev.vars',
      '.eslintrc.json',
      'app',
      'components',
      'components.json',
      'env.example',
      'lib',
      'middleware.ts',
      'next.config.ts',
      'open-next.config.ts',
      'postcss.config.mjs',
      'public',
      'styles',
      'types',
      'wrangler.jsonc',
    ]) {
      expect(existsSync(path.join(rootDirectory, retiredRoot)), `${retiredRoot}/ must be retired`).toBe(false);
    }
  });

  it('declares an independently testable, buildable and deployable Web lifecycle', () => {
    expect(existsSync(appManifestPath)).toBe(true);
    if (!existsSync(appManifestPath)) return;

    const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8')) as {
      name?: string;
      private?: boolean;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    expect(appManifest).toMatchObject({ name: '@mahoshojo/web', private: true });
    for (const scriptName of ['dev', 'test', 'lint', 'build', 'build:cf', 'preview', 'deploy', 'start']) {
      expect(appManifest.scripts?.[scriptName], `missing scripts.${scriptName}`).toEqual(expect.any(String));
    }
    for (const dependencyName of ['next', 'react', 'react-dom', '@opennextjs/cloudflare']) {
      expect(appManifest.dependencies?.[dependencyName], `missing dependency ${dependencyName}`).toEqual(expect.any(String));
    }
  });

  it('keeps production Web type-checking fail-closed without loading test fixtures', () => {
    const buildTsconfigPath = path.join(appDirectory, 'tsconfig.build.json');
    expect(existsSync(buildTsconfigPath)).toBe(true);
    if (!existsSync(buildTsconfigPath)) return;

    const buildTsconfig = JSON.parse(readFileSync(buildTsconfigPath, 'utf8')) as {
      extends?: string;
      exclude?: string[];
    };
    const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const nextConfig = readFileSync(path.join(appDirectory, 'next.config.ts'), 'utf8');
    const openNextConfig = readFileSync(path.join(appDirectory, 'open-next.config.ts'), 'utf8');

    expect(buildTsconfig.extends).toBe('./tsconfig.json');
    expect(buildTsconfig.exclude).toEqual(expect.arrayContaining([
      'node_modules',
      'scripts',
      'tests',
      '.open-next',
      '.wrangler',
    ]));
    expect(nextConfig).toContain("tsconfigPath: 'tsconfig.build.json'");
    expect(nextConfig).toContain('ignoreBuildErrors: true');
    expect(appManifest.scripts?.['typecheck:build']).toContain(
      'tsc --noEmit --pretty false -p tsconfig.build.json',
    );
    expect(appManifest.scripts?.['typecheck:build']).toContain(
      'node --max-old-space-size=3072 node_modules/typescript/bin/tsc',
    );
    expect(appManifest.scripts?.['build:next']).toBe(
      'pnpm run generate:content && pnpm run clean:next && pnpm run typecheck:build && next build '
      + '&& node scripts/check-hosted-dr-client-bundle.mjs --dir .next/static',
    );
    expect(appManifest.scripts?.['build:sw']).toBeUndefined();
    expect(appManifest.scripts?.build).toContain('pnpm run build:next');
    expect(appManifest.scripts?.['build:cf']).toContain('opennextjs-cloudflare build');
    expect(appManifest.scripts?.['build:cf']).not.toContain('--skipNextBuild');
    expect(openNextConfig).toContain("buildCommand: 'pnpm run build:next'");
  });

  it('keeps root commands as filtered compatibility entrypoints without runtime dependencies', () => {
    const rootManifest = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    for (const scriptName of ['dev', 'test', 'lint', 'build', 'build:cf', 'preview', 'deploy', 'start']) {
      expect(rootManifest.scripts[scriptName], `root scripts.${scriptName}`).toContain(
        'pnpm --filter @mahoshojo/web',
      );
    }
    expect(rootManifest.dependencies ?? {}).toEqual({});
  });

  it('keeps the root Drizzle generator able to resolve Web schema aliases', () => {
    const rootTsconfig = JSON.parse(
      readFileSync(path.join(rootDirectory, 'tsconfig.json'), 'utf8'),
    ) as {
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    };

    expect(rootTsconfig.compilerOptions?.baseUrl).toBe('.');
    expect(rootTsconfig.compilerOptions?.paths?.['@/*']).toEqual(['apps/web/*']);
  });
});

describe('phase 2.5A D1 Gateway workspace app', () => {
  const appDirectory = path.join(rootDirectory, 'apps/d1-gateway');
  const appManifestPath = path.join(appDirectory, 'package.json');
  const appWranglerPath = path.join(appDirectory, 'wrangler.jsonc');

  it('moves the Worker deployment unit out of the legacy server directory', () => {
    expect(existsSync(path.join(appDirectory, 'index.ts'))).toBe(true);
    expect(existsSync(appWranglerPath)).toBe(true);
    expect(existsSync(path.join(appDirectory, 'README.md'))).toBe(true);
    expect(existsSync(path.join(rootDirectory, 'server/d1-gateway/index.ts'))).toBe(false);
    expect(existsSync(path.join(rootDirectory, 'server/d1-gateway/wrangler.jsonc'))).toBe(false);
  });

  it('declares an independently testable and deployable app lifecycle', () => {
    expect(existsSync(appManifestPath)).toBe(true);
    if (!existsSync(appManifestPath)) return;

    const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8')) as {
      name?: string;
      private?: boolean;
      type?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(appManifest).toMatchObject({
      name: '@mahoshojo/d1-gateway',
      private: true,
      type: 'module',
    });
    for (const scriptName of ['dev', 'test', 'lint', 'build', 'deploy']) {
      expect(appManifest.scripts?.[scriptName], `missing scripts.${scriptName}`).toEqual(expect.any(String));
    }
    expect(appManifest.scripts?.build).toContain('tsc --noEmit');
    expect(appManifest.scripts?.build).toContain('wrangler deploy --dry-run');
    expect(appManifest.scripts?.deploy).not.toContain('--dry-run');
    expect(appManifest.dependencies).toBeUndefined();
    for (const dependencyName of [
      '@typescript-eslint/parser',
      'esbuild',
      'eslint',
      'typescript',
      'vitest',
      'wrangler',
    ]) {
      expect(appManifest.devDependencies?.[dependencyName], `missing devDependency ${dependencyName}`).toEqual(
        expect.any(String),
      );
    }
  });

  it('keeps root lifecycle commands as workspace-filtered compatibility entrypoints', () => {
    const rootManifest = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(rootManifest.scripts['dev:d1-gateway']).toBe(
      'pnpm --filter @mahoshojo/d1-gateway run dev',
    );
    expect(rootManifest.scripts['deploy:d1-gateway']).toBe(
      'pnpm --filter @mahoshojo/d1-gateway run deploy',
    );
  });

  it('preserves the Worker route, observability, and D1 binding contract', () => {
    expect(existsSync(appWranglerPath)).toBe(true);
    if (!existsSync(appWranglerPath)) return;

    const wrangler = parse(readFileSync(appWranglerPath, 'utf8'), undefined, true) as {
      name?: string;
      main?: string;
      compatibility_date?: string;
      workers_dev?: boolean;
      routes?: unknown[];
      observability?: Record<string, unknown>;
      d1_databases?: unknown[];
    };

    expect(wrangler).toMatchObject({
      name: 'mahoshojo-d1-gateway',
      main: 'index.ts',
      compatibility_date: '2025-04-01',
      workers_dev: false,
      routes: [
        {
          pattern: 'mahoshojo-d1-gateway.colanns.me',
          custom_domain: true,
        },
      ],
      observability: {
        enabled: true,
        head_sampling_rate: 0.1,
      },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'mahoshojo',
          database_id: '8eb9b25c-5a00-4feb-b5cb-c5dd25cda1d3',
          migrations_dir: '../../drizzle',
        },
      ],
    });
  });
});

describe('desktop workspace app ownership', () => {
  const appDirectory = path.join(rootDirectory, 'apps/desktop');
  const tauriDirectory = path.join(appDirectory, 'src-tauri');

  it('由 apps/desktop 独占本地 client runtime 的 manifest、构建与运行时源码', () => {
    for (const relativePath of [
      'package.json',
      'README.md',
      'index.html',
      'vite.config.ts',
      'vitest.config.ts',
      'eslint.config.mjs',
      'tsconfig.json',
      'tsconfig.build.json',
      'src/main.tsx',
      'src/app/App.tsx',
      'src/platform/desktop-bridge.ts',
      'src-tauri/Cargo.toml',
      'src-tauri/Cargo.lock',
      'src-tauri/build.rs',
      'src-tauri/tauri.conf.json',
      'src-tauri/capabilities/main-ui.json',
      'src-tauri/src/lib.rs',
      'src-tauri/src/main.rs',
    ]) {
      expect(
        existsSync(path.join(appDirectory, relativePath)),
        `apps/desktop/${relativePath} must exist`,
      ).toBe(true);
    }
  });

  it('声明独立 app 生命周期，并把 Rust 编译移出 workspace build', () => {
    const appManifest = JSON.parse(
      readFileSync(path.join(appDirectory, 'package.json'), 'utf8'),
    ) as {
      name?: string;
      private?: boolean;
      type?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(appManifest).toMatchObject({
      name: '@mahoshojo/desktop',
      private: true,
      type: 'module',
    });
    for (const scriptName of ['dev', 'test', 'lint', 'build']) {
      expect(appManifest.scripts?.[scriptName], `missing scripts.${scriptName}`).toEqual(
        expect.any(String),
      );
    }

    // workspace:build 会遍历所有 app，因此 build 只能是前端产物。
    expect(appManifest.scripts?.build).not.toContain('tauri build');
    expect(appManifest.scripts?.build).toContain('vite build');
    expect(appManifest.scripts?.['build:tauri']).toContain('tauri build');
    expect(appManifest.scripts?.['check:rust']).toContain('cargo test');

    // renderer 侧不引入任何通用原生能力插件。
    for (const dependencyName of Object.keys(appManifest.dependencies ?? {})) {
      expect(dependencyName, `renderer dependency ${dependencyName} must not be a native plugin`).not.toMatch(
        /^@tauri-apps\/plugin-/u,
      );
    }
  });

  it('把 capability 授权面收窄到单个 webview 且不含通配 label', () => {
    const capability = JSON.parse(
      readFileSync(path.join(tauriDirectory, 'capabilities', 'main-ui.json'), 'utf8'),
    ) as {
      identifier?: string;
      webviews?: string[];
      windows?: string[];
      permissions?: string[];
    };

    expect(capability.identifier).toBe('main-ui');
    // windows 命中会启用到该 window 下的所有 webview，因此必须只写 webviews。
    expect(capability.windows).toBeUndefined();
    expect(capability.webviews).toEqual(['main-ui']);
    for (const label of capability.webviews ?? []) {
      expect(label).not.toContain('*');
    }
    for (const permission of capability.permissions ?? []) {
      expect(permission, `permission ${permission} must not be a plugin or wildcard grant`).not.toMatch(
        /^(?:[a-z0-9-]+:)?\*$/u,
      );
      if (permission.startsWith('core:')) {
        // D4a / DESK-011：core 只保留逐项核对后的最小显式权限，不得回退到 core:default 大集合。
        expect(permission, `core permission ${permission} must be an explicit minimal grant`).toMatch(
          /^core:[a-z]+:(?:allow|deny)-[a-z0-9-]+$/u,
        );
      } else {
        // 自有 command 的 ACL 权限是 AppManifest 生成的裸 allow-/deny- 标识符（无命名空间前缀）。
        expect(permission, `permission ${permission} must be a core or app command grant`).toMatch(
          /^(?:allow|deny)-[a-z0-9-]+$/u,
        );
      }
    }

    // 逐项核对结果（D4a）：onCloseRequested 经 plugin:event|listen 注册监听、返回的释放
    // 函数走 unlisten、空闲放行后经 plugin:window|destroy 销毁窗口；Channel 的事件取回由
    // Tauri 内置豁免命令承担，不占权限。新增任何 core 权限都必须先论证再改这里。
    const corePermissions = (capability.permissions ?? [])
      .filter((permission) => permission.startsWith('core:'))
      .sort();
    expect(corePermissions).toEqual([
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'core:window:allow-destroy',
    ]);
  });

  it('keeps generate_handler, AppManifest commands and capability grants in exact agreement', () => {
    // DESK-012 / D4a：声明 app ACL manifest 后，未登记的自有 command 会被 Tauri 拒绝，
    // 而 capability 漏掉的 allow-* 会让合法 command 无权限。三方必须逐项一致：
    //   generate_handler!（注册了哪些 command）
    //   AppManifest::commands（为哪些 command 生成 allow-/deny- 权限）
    //   main-ui capability（实际授予 main-ui 哪些 allow-*）
    // 没有这条门禁时，新增 command 未进 ACL 不会让任何既有测试变红。
    const libSource = readFileSync(path.join(tauriDirectory, 'src', 'lib.rs'), 'utf8');
    const handler = libSource.match(/generate_handler!\[([\s\S]*?)\]/);
    expect(handler, 'apps/desktop must register an explicit command handler').not.toBeNull();
    const handlerCommands = (handler?.[1] ?? '')
      .split(',')
      .map((command) => command.trim())
      .filter((command) => command.length > 0);

    const buildSource = readFileSync(path.join(tauriDirectory, 'build.rs'), 'utf8');
    const manifestBlock = /\.commands\(\s*&\[([\s\S]*?)\]\s*\)/u.exec(buildSource);
    expect(
      manifestBlock,
      'build.rs must declare AppManifest::commands with a literal command list',
    ).not.toBeNull();
    const manifestCommands = [...(manifestBlock?.[1] ?? '').matchAll(/"([a-z_][a-z0-9_]*)"/gu)].flatMap(
      (match) => (match[1] ? [match[1]] : []),
    );

    expect(
      manifestCommands,
      'AppManifest::commands must mirror generate_handler! exactly',
    ).toEqual(handlerCommands);

    const capability = JSON.parse(
      readFileSync(path.join(tauriDirectory, 'capabilities', 'main-ui.json'), 'utf8'),
    ) as { permissions?: string[] };
    const commandGrants = (capability.permissions ?? []).filter((permission) =>
      /^(?:allow|deny)-/u.test(permission),
    );
    const expectedGrants = handlerCommands.map((command) => `allow-${command.replaceAll('_', '-')}`);
    expect(
      [...commandGrants].sort(),
      'main-ui capability must grant exactly allow-<command> for every manifest command',
    ).toEqual([...expectedGrants].sort());

    // tauri-build 只写不清理：删除 command 后残留的 autogenerated TOML 不会自己消失，
    // 该 command 的权限会继续留在 ACL manifest。该目录是 gitignore 的衍生资产、不提交，
    // 但本地 build 后一旦存在就必须与清单逐项一致。
    const autogeneratedDirectory = path.join(tauriDirectory, 'permissions', 'autogenerated');
    if (existsSync(autogeneratedDirectory)) {
      const generatedCommands = readdirSync(autogeneratedDirectory)
        .filter((file) => file.endsWith('.toml'))
        .map((file) => file.slice(0, -'.toml'.length))
        .sort();
      expect(
        generatedCommands,
        'permissions/autogenerated must not retain TOML files for removed commands',
      ).toEqual([...handlerCommands].sort());
    }
  });

  it('exposes no plaintext secret read surface on the Rust command set', () => {
    const libSource = readFileSync(path.join(tauriDirectory, 'src', 'lib.rs'), 'utf8');
    const handler = libSource.match(/generate_handler!\[([\s\S]*?)\]/);
    expect(handler, 'apps/desktop must register an explicit command handler').not.toBeNull();

    const commands = (handler?.[1] ?? '')
      .split(',')
      .map((command) => command.trim())
      .filter((command) => command.length > 0);

    expect(commands).toEqual([
      'desktop_runtime_info',
      'set_provider_secret',
      'has_provider_secret',
      'delete_provider_secret',
      'save_provider_profile',
      'list_provider_profile_ids',
      'get_provider_profile',
      'delete_provider_profile',
      'validate_provider_execution_profile',
      'stream_direct_ai',
      'cancel_direct_ai',
      'save_local_card',
      'get_local_card',
      'list_local_cards',
      'delete_local_card',
      'restore_local_card',
      'purge_local_card',
      'save_web_package',
      'get_web_package',
      'list_web_packages',
      'delete_web_package',
      'restore_web_package',
      'purge_web_package',
      'read_web_package_archive',
      'begin_local_archive_export',
      'append_local_archive_export_chunk',
      'audit_local_library',
      'create_local_backup',
      'list_local_backups',
      'prepare_local_restore',
      'exit_after_local_restore',
      'collect_local_garbage',
    ]);

    // renderer 可用的 secret 能力只有写入与存在性；任何读取形态都会让
    // ACCEPT-002 的「已持久化 secret 不可读回」失效。
    for (const command of commands) {
      expect(command, `${command} must not read a secret back`).not.toMatch(
        /(?:get|read|reveal|export|dump)_?(?:provider_)?secret$/u,
      );
    }
    expect(commands).not.toContain('get_provider_secret');
    expect(commands).not.toContain('read_provider_secret');

    // Direct 通路的选择器只能是 profileId 与 requestId：请求 DTO 不得携带 endpoint 或 secret。
    const streamCommand = commands.filter((command) => /direct_ai/u.test(command));
    expect(streamCommand).toEqual(['stream_direct_ai', 'cancel_direct_ai']);
    for (const parameter of ['base_url', 'baseUrl', 'endpoint', 'url', 'api_key', 'apiKey', 'headers']) {
      expect(libSource, `Direct command surface must not accept ${parameter}`).not.toMatch(
        new RegExp(`\\b${parameter}\\s*:\\s*(?:String|&str)`, 'u'),
      );
    }
  });

  it('exposes only business-level local library commands with no renderer-supplied paths', () => {
    const libSource = readFileSync(path.join(tauriDirectory, 'src', 'lib.rs'), 'utf8');
    const handler = libSource.match(/generate_handler!\[([\s\S]*?)\]/);
    const commands = (handler?.[1] ?? '')
      .split(',')
      .map((command) => command.trim())
      .filter((command) => command.length > 0);

    // ADR 第 7 条：IPC 必须是业务级的。通用读写形态一旦出现，renderer 就能指定路径或 SQL，
    // "Rust 自己产生所有落盘路径、文件名与 SQL 选择器"这条边界随之失效。
    for (const command of commands) {
      expect(
        command,
        `${command} looks like a generic capability rather than a business operation`,
      ).not.toMatch(/^(?:read|write|delete|open|save|list|query|exec|run)_?(?:any_)?file$/u);
      expect(command, `${command} must not be a generic SQL surface`).not.toMatch(
        /^(?:query|exec|sql|query_?sql)$/u,
      );
      expect(command, `${command} must not be a generic fetch surface`).not.toMatch(
        /^(?:fetch|http_?request|request)$/u,
      );
    }

    // 本地卡命令只接受 id、时间戳与已校验记录，不接受路径。
    const cardCommands = commands.filter((command) => /_local_card/iu.test(command));
    expect(cardCommands.length).toBeGreaterThan(0);
    expect(cardCommands).toEqual(
      expect.arrayContaining([
        'save_local_card',
        'get_local_card',
        'list_local_cards',
        'delete_local_card',
        'restore_local_card',
        'purge_local_card',
      ]),
    );
    for (const parameter of ['path', 'file_path', 'filePath', 'directory', 'dir', 'sql', 'query']) {
      expect(
        libSource,
        `local library command surface must not accept ${parameter}`,
      ).not.toMatch(new RegExp(`\\b${parameter}\\s*:\\s*(?:String|&str)`, 'u'));
    }
  });

  it('pins the blob GC delete order so it can never be reversed', () => {
    // DESK-072：先删 metadata 行、后删文件。反过来崩溃后会留下"metadata 在、文件不在"——
    // DESK-051 明令禁止的悬空记录，而且没有任何自愈路径能修它（写入时找不到对应引用行）。
    //
    // 这条无法由运行期测试覆盖：要在单进程里造出"文件已删、行还在"的崩溃中间态，需要真的
    // 在两步之间断电。因此门禁落在源码顺序上——它是文本事实，比一个依赖时序的测试可靠。
    const gcSource = readFileSync(path.join(tauriDirectory, 'src', 'gc.rs'), 'utf8');
    const deleteIndex = gcSource.indexOf('"DELETE FROM blob');
    const removeIndex = gcSource.indexOf('remove_blob_file(&target)');

    expect(deleteIndex, 'GC must delete a metadata row').toBeGreaterThan(-1);
    expect(removeIndex, 'GC must remove a blob file').toBeGreaterThan(-1);
    expect(
      deleteIndex,
      'the metadata DELETE MUST come before the file removal (DESK-072)',
    ).toBeLessThan(removeIndex);

    // 再确认必须与删除同在一条语句里。写成"先 SELECT 再 DELETE"会留下一个间隙。
    const deleteStatement = gcSource.slice(deleteIndex, deleteIndex + 400);
    expect(
      deleteStatement,
      'the DELETE must carry its own NOT EXISTS guard (mark-then-reconfirm)',
    ).toContain('NOT EXISTS');
  });

it('runs maintenance commands off the IPC thread and inside a maintenance window', () => {
    // DESK-067：Tauri 的同步 command 在调用线程执行。审计要为每个被引用 blob 重算 SHA-256，
    // 是 O(字节) 的工作——同步执行会冻结整个 WebView。
    //
    // 这条无法由 Rust 单测覆盖：command 是否 `async` 是源码形状，不是运行期行为。
    const libSource = readFileSync(path.join(tauriDirectory, 'src', 'lib.rs'), 'utf8');

    for (const command of ['audit_local_library', 'collect_local_garbage']) {
      const declaration = new RegExp(`async fn ${command}\\(([\\s\\S]*?)\\n\\}`, 'u').exec(libSource);
      expect(declaration, `${command} must be declared to inspect`).not.toBeNull();
      const body = declaration?.[0] ?? '';
      expect(
        body,
        `${command} must be async — a sync command would block the WebView`,
      ).toMatch(/\basync fn\b/u);
      expect(
        body,
        `${command} must move blocking work into spawn_blocking`,
      ).toContain('spawn_blocking');
      // 许可必须在进入窗口后才 spawn，且要 move 进阻塞任务——否则它会在 spawn 之前
      // drop，窗口等于没开。
      expect(body, `${command} must take the maintenance permit`).toContain('enter_maintenance');
    }
  });

  it('routes every local library store through one managed state and one connection', () => {
    // DESK-065：一次保存跨 blob 文件、blob metadata 与包事务三个资源。四个 store 此前各开
    // 一条连接、各持一把 Mutex，于是 "写 blob" 与 "写包事务" 之间存在一个无人持有的观察
    // 窗口——GC 落在那里就会删掉 in-flight 的字节。这条断言把该形状钉死，避免它被改回去。
    const libSource = readFileSync(path.join(tauriDirectory, 'src', 'lib.rs'), 'utf8');

    for (const store of ['LocalCardStore', 'WebPackageStore', 'BlobStore', 'LocalStore']) {
      expect(
        libSource,
        `${store} must be reached through LocalLibrary, not registered as its own Tauri state`,
      ).not.toMatch(new RegExp(`app\\.manage\\([^)]*${store}`, 'u'));
      expect(
        libSource,
        `${store} must not appear as a State parameter type`,
      ).not.toMatch(new RegExp(`State<'_,\\s*${store}>`, 'u'));
    }

    // 生产路径只有一个本地库 State（连同单实例守卫与凭据/注册表，setup 一共 manage 三个）。
    const managedStates = libSource.match(/app\.manage\([^)]*\)/gu) ?? [];
    expect(
      managedStates.filter((call) => /library/iu.test(call)),
      'apps/desktop must manage exactly one local library state',
    ).toEqual(['app.manage(library)']);

    // 单实例必须在打开库**之前**获取：反过来两个进程可能都已建连接，第二个才失败，
    // 而它已经跑完迁移阶梯，可能留下一个迁移了一半的库。
    const acquireAt = libSource.indexOf('InstanceGuard::acquire');
    const openAt = libSource.indexOf('LocalLibrary::open');
    expect(acquireAt).toBeGreaterThan(-1);
    expect(openAt).toBeGreaterThan(-1);
    expect(
      acquireAt,
      'InstanceGuard::acquire must precede LocalLibrary::open in setup',
    ).toBeLessThan(openAt);

    // 锁必须 manage 出去。它是 setup 的局部变量，不 manage 就会在 setup 返回时 drop，
    // 锁随之释放，单实例约束形同虚设。
    expect(
      libSource,
      'the instance guard must be managed so its lock outlives setup',
    ).toContain('app.manage(instance)');
  });

  it('takes a maintenance write permit on every local library mutation command', () => {
    // DESK-065：维护窗口内写入必须被**拒**而不是排队。许可因此必须覆盖整次 IPC 调用——
    // 若只在 store 内部取，save_web_package 的第二步（包事务）就落在窗口之外。
    const libSource = readFileSync(path.join(tauriDirectory, 'src', 'lib.rs'), 'utf8');

    const mutationCommands = [
      'save_local_card',
      'delete_local_card',
      'restore_local_card',
      'purge_local_card',
      'save_web_package',
      'delete_web_package',
      'restore_web_package',
      'purge_web_package',
      'save_provider_profile',
      'delete_provider_profile',
    ];

    for (const command of mutationCommands) {
      const declaration = new RegExp(
        `fn ${command}\\(([\\s\\S]*?)\\n\\}`,
        'u',
      ).exec(libSource);
      expect(declaration, `${command} must have a declaration to inspect`).not.toBeNull();
      expect(
        declaration?.[1] ?? '',
        `${command} must acquire a maintenance write permit`,
      ).toContain('enter_write()');
    }

    // 读取路径刻意**不**取许可：GC 只回收无引用 blob，而读取只触达被引用的 blob，
    // 因此维护期间读到的仍然是一致状态。要求读也取许可会让用户在备份时无法翻看本地库。
    for (const command of ['get_local_card', 'list_local_cards', 'read_web_package_archive']) {
      const declaration = new RegExp(`fn ${command}\\(([\\s\\S]*?)\\n\\}`, 'u').exec(libSource);
      expect(declaration, `${command} must have a declaration to inspect`).not.toBeNull();
      expect(
        declaration?.[1] ?? '',
        `${command} is a read and must not take the maintenance write permit`,
      ).not.toContain('enter_write()');
    }
  });

  it('keeps the local library document free of a serde_json::Value write gate', () => {
    // DESK-062：serde_json::Value 会拒绝 \ud800，而 JSON.stringify 会产出它、Web 的
    // IndexedDB 也照常保存它。把 Value 解析当落盘前提会静默拒收 Web 已有的合法数据。
    const localCardSource = readFileSync(path.join(tauriDirectory, 'src', 'local_card.rs'), 'utf8');
    expect(localCardSource).toContain('RawValue');

    // 只扫描生产代码：测试里用 Value 提取断言字段是合理的，真正要禁的是落盘路径上的解析。
    const productionSource = localCardSource.split('#[cfg(test)]')[0] ?? '';
    expect(productionSource, 'local card storage must not gate writes on serde_json::Value').not.toMatch(
      /from_str::<\s*serde_json::Value\s*>/u,
    );
    expect(productionSource, 'local card storage must not build a serde_json::Value from the document').not.toMatch(
      /to_value\s*\(/u,
    );
  });

  it('keeps the secret reference rules single-sourced and cross-runtime checked', () => {
    const secretSource = readFileSync(path.join(tauriDirectory, 'src', 'secret.rs'), 'utf8');

    // Rust 侧必须在编译期读入 TypeScript 持有的 fixture，否则两侧规则会静默漂移。
    expect(secretSource).toContain('packages/contracts/fixtures/desktop-secret-refs.json');
    expect(
      existsSync(
        path.join(rootDirectory, 'packages/contracts/fixtures/desktop-secret-refs.json'),
      ),
    ).toBe(true);
    expect(
      existsSync(path.join(rootDirectory, 'packages/contracts/src/desktop-ipc.ts')),
    ).toBe(true);

    const contractsManifest = JSON.parse(
      readFileSync(path.join(rootDirectory, 'packages/contracts/package.json'), 'utf8'),
    ) as { exports?: Record<string, unknown> };
    expect(Object.keys(contractsManifest.exports ?? {})).toContain('./desktop-ipc');
  });

  it('keeps a write-only SecureVault port free of any plaintext read', () => {
    const vaultSource = readFileSync(
      path.join(rootDirectory, 'packages/ai-direct/src/vault.ts'),
      'utf8',
    );

    expect(vaultSource).toContain('hasSecret');
    expect(vaultSource).not.toContain('getSecret');
  });

  it('keeps the local store opaque and free of renderer-supplied paths or SQL', () => {
    const storeSource = readFileSync(path.join(tauriDirectory, 'src', 'store.rs'), 'utf8');
    const libSource = readFileSync(path.join(tauriDirectory, 'src', 'lib.rs'), 'utf8');

    // Rust 是"已校验文档的 dumb store"：SQL 全部是内部常量，不接受 renderer 传入的选择器。
    const interpolatedStatements = storeSource.match(/"[^"]*\{[^"]*\}\s*"/gu) ?? [];
    expect(
      interpolatedStatements.filter((statement) => /SELECT|INSERT|UPDATE|DELETE/iu.test(statement)),
      'SQL must never be assembled from interpolated input',
    ).toEqual([]);

    // 命令签名里不得出现路径或 SQL 形态的**参数**（只匹配 `name: Type` 形式，
    // 避免误伤散文里的 "directory:" 之类字样）。
    for (const forbidden of [
      /\bpath\s*:\s*(?:String|&str|PathBuf)/u,
      /\bsql\s*:\s*(?:String|&str)/u,
      /\bfilename\s*:\s*(?:String|&str|PathBuf)/u,
      /\bdirectory\s*:\s*(?:String|&str|PathBuf)/u,
    ]) {
      expect(libSource, `command surface must not accept ${forbidden}`).not.toMatch(forbidden);
    }

    // 落盘的必须是完整 Profile 文档，而不是 native 的窄投影。
    expect(libSource).toContain('StoredProviderProfileIdentity');
  });

  it('refuses project-owned endpoints on the native side as well', () => {
    const profileSource = readFileSync(path.join(tauriDirectory, 'src', 'provider_profile.rs'), 'utf8');

    expect(profileSource).toContain('PROJECT_DOMAIN_SUFFIXES');
    expect(profileSource).toContain('mahoshojo.colanns.me');
    expect(profileSource).toContain('deny_unknown_fields');
    // 跨运行时一致性：native 侧在编译期读入 TypeScript 持有的 fixture。
    expect(profileSource).toContain('packages/contracts/fixtures/provider-execution-profiles.json');
  });

  it('以结构化方式关闭远程内容、全局 Tauri 对象与 iframe', () => {
    const tauriConfig = JSON.parse(
      readFileSync(path.join(tauriDirectory, 'tauri.conf.json'), 'utf8'),
    ) as {
      identifier?: string;
      build?: { devUrl?: string; frontendDist?: string };
      app?: {
        withGlobalTauri?: boolean;
        windows?: { label?: string }[];
        security?: { capabilities?: string[]; csp?: string | null };
      };
      bundle?: { active?: boolean; createUpdaterArtifacts?: boolean };
      plugins?: Record<string, unknown>;
    };

    expect(tauriConfig.identifier).not.toBe('com.tauri.dev');
    expect(tauriConfig.build?.frontendDist).toBe('../dist');
    expect(tauriConfig.build?.devUrl).toMatch(/^http:\/\/localhost:\d+$/u);
    expect(tauriConfig.app?.withGlobalTauri).toBe(false);
    expect(tauriConfig.app?.windows?.map((window) => window.label)).toEqual(['main-ui']);
    expect(tauriConfig.app?.security?.capabilities).toEqual(['main-ui']);

    const csp = tauriConfig.app?.security?.csp;
    expect(csp, 'desktop must declare an explicit CSP').toEqual(expect.any(String));
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain("script-src *");
    // 不可信内容只能走独立 webview，因此主文档内不允许任何 frame。
    expect(csp).toContain("frame-src 'none'");

    // 发行与 updater 属于 D5，D0 不预先打开。
    expect(tauriConfig.bundle?.createUpdaterArtifacts).toBe(false);
    expect(Object.keys(tauriConfig.plugins ?? {})).toEqual([]);
  });
});

describe('phase 2.5C Hono API workspace app ownership', () => {
  const appDirectory = path.join(rootDirectory, 'apps/api');
  const appManifestPath = path.join(appDirectory, 'package.json');

  it('由 apps/api 独占 Hono source、测试、容器和部署生命周期', () => {
    for (const relativePath of [
      'package.json',
      'README.md',
      'env.example',
      'Dockerfile',
      'compose.local.yml',
      'src/index.ts',
      'tests/route-manifest.test.ts',
      'scripts/build.mjs',
      'scripts/generate-route-manifest.mjs',
      'scripts/verify-runtime.mjs',
      'deploy/compose.yml',
      'deploy/deploy-bundle.sh',
    ]) {
      expect(
        existsSync(path.join(appDirectory, relativePath)),
        `apps/api/${relativePath} must exist`,
      ).toBe(true);
    }

    expect(existsSync(path.join(rootDirectory, 'server/index.ts'))).toBe(false);
    expect(existsSync(path.join(rootDirectory, 'Dockerfile.hono'))).toBe(false);
    expect(existsSync(path.join(rootDirectory, 'compose.hono.yml'))).toBe(false);
    expect(existsSync(path.join(rootDirectory, 'deploy/hono'))).toBe(false);
  });

  it('本地 Hono Compose 显式声明 local target 与 loopback fault scope', () => {
    const compose = readFileSync(path.join(appDirectory, 'compose.local.yml'), 'utf8');

    expect(compose).toContain('HOSTED_API_ENVIRONMENT: local');
    expect(compose).toContain('HOSTED_DR_LOCAL_FAULT_INJECTION: "true"');
    expect(compose).toContain(
      'R2_ACCOUNT_ID: ${R2_ACCOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID:?请配置 R2_ACCOUNT_ID 或 CLOUDFLARE_ACCOUNT_ID}}',
    );
  });

  it('在 env example 中列出本地 Hono Compose 的全部必填变量', () => {
    const compose = readFileSync(path.join(appDirectory, 'compose.local.yml'), 'utf8');
    const envExample = readFileSync(path.join(appDirectory, 'env.example'), 'utf8');
    const requiredVariables = [
      ...new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/gu)].map((match) => match[1])),
    ];
    const missingVariables = requiredVariables.filter(
      (variableName) => !new RegExp(`^${variableName}=`, 'mu').test(envExample),
    );

    expect(missingVariables).toEqual([]);
  });

  it('声明独立 app 生命周期，并由 root scripts 只做代理入口', () => {
    expect(existsSync(appManifestPath)).toBe(true);
    if (!existsSync(appManifestPath)) return;

    const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8')) as {
      name?: string;
      private?: boolean;
      type?: string;
      scripts?: Record<string, string>;
    };
    expect(appManifest).toMatchObject({
      name: '@mahoshojo/api',
      private: true,
      type: 'module',
    });
    for (const scriptName of [
      'dev',
      'start',
      'test',
      'lint',
      'build',
      'build:bundle',
      'routes',
      'verify:runtime',
      'deploy:prepare',
    ]) {
      expect(appManifest.scripts?.[scriptName], `missing scripts.${scriptName}`).toEqual(expect.any(String));
    }

    const rootManifest = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(rootManifest.scripts['dev:server']).toBe('pnpm --filter @mahoshojo/api run dev');
    expect(rootManifest.scripts['start:server']).toBe('pnpm --filter @mahoshojo/api run start');
    expect(rootManifest.scripts['build:server']).toBe('pnpm --filter @mahoshojo/api run build:bundle');
    expect(rootManifest.scripts['server:routes']).toBe('pnpm --filter @mahoshojo/api run routes');
    expect(rootManifest.scripts['verify:server:runtime']).toBe('pnpm --filter @mahoshojo/api run verify:runtime');
    expect(rootManifest.scripts['test:server']).toBe('pnpm --filter @mahoshojo/api run test');
  });

  it('Docker install layer 只复制 apps/api 及其 workspace 依赖闭包', () => {
    const dockerfilePath = path.join(appDirectory, 'Dockerfile');
    expect(existsSync(dockerfilePath)).toBe(true);
    if (!existsSync(dockerfilePath)) return;

    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const installIndex = dockerfile.indexOf('RUN pnpm install --frozen-lockfile');
    expect(installIndex).toBeGreaterThan(-1);
    const dependencyClosure = [
      'apps/api/package.json',
      'packages/ai-core/package.json',
      'packages/contracts/package.json',
      'packages/domain/package.json',
      'packages/hosted-api/package.json',
      'packages/hosted-runtime/package.json',
    ];
    for (const manifestPath of dependencyClosure) {
      const copyIndex = dockerfile.indexOf(`COPY ${manifestPath} ./${manifestPath}`);
      expect(copyIndex, `${manifestPath} must be copied before install`).toBeGreaterThan(-1);
      expect(copyIndex).toBeLessThan(installIndex);
    }
    const copiedWorkspaceManifests = Array.from(
      dockerfile.matchAll(/^COPY ((?:apps|packages)\/[^/]+\/package\.json) \.\/\1$/gm),
      (match) => match[1],
    );
    expect(copiedWorkspaceManifests).toEqual(dependencyClosure);
    expect(dockerfile).toContain('pnpm install --frozen-lockfile --filter @mahoshojo/api...');
  });
});
