### 部署指南：本地运行魔法少女生成器

这个指南将帮助你从零开始，在自己的电脑上成功运行这个项目。

-----

#### 第 1 步：准备工作 (环境安装)

在开始之前，你的电脑需要安装两个基本软件。

1.  **安装 Node.js 与 pnpm**

      * 本项目使用 pnpm 作为包管理器与脚本调度入口，推荐 Node.js v24.14.0，最低要求 Node.js 22。
      * 安装 Node.js 后，可通过 Corepack 启用固定版本：`corepack prepare pnpm@11.3.0 --activate`。
      * 当前测试运行器已迁移到 Vitest，运维脚本入口统一通过 `pnpm` 调度；本地运行、测试和常规维护不再需要安装 Bun。

2.  **获取 AI 提供商 API Key**

      * 这个项目需要连接 AI 服务来生成内容，你需要一个 API Key（可以理解为访问 AI 服务的密码）。
      * `README.md` 文件推荐使用 `gemini-1.5-flash` 模型。你可以前往 [Google AI Studio](https://aistudio.google.com/) 免费获取 Gemini 的 API Key。

-----

#### 第 2 步：下载项目代码

你需要将项目的代码文件下载到你的电脑上。

  * **方式一 (推荐):** 直接下载 ZIP 压缩包。

    1.  访问项目 GitHub 页面: [https://github.com/colasama/MahoShojo-Generator](https://github.com/colasama/MahoShojo-Generator)
    2.  点击绿色的 **`< > Code`** 按钮，然后选择 **`Download ZIP`**。
    3.  下载后，将文件解压到一个你喜欢的位置。

  * **方式二 (进阶):** 使用 Git。

      * 打开你的终端，输入以下命令并回车：
        ```bash
        git clone https://github.com/colasama/MahoShojo-Generator.git
        ```
      * 这会在当前目录下创建一个名为 `MahoShojo-Generator` 的文件夹。

-----

#### 第 3 步：安装项目依赖

“依赖”是这个项目运行所需要的一些第三方代码库。

1.  打开你的终端 (Terminal / PowerShell / CMD)。

2.  使用 `cd` 命令进入你刚刚解压或克隆的项目文件夹。例如： `cd Downloads/MahoShojo-Generator`。

3.  运行以下命令来安装所有必要的依赖：

    ```bash
    pnpm install
    ```

4.  等待命令执行完成。pnpm 会自动下载并安装所有需要的东西。

-----

#### 第 4 步：配置你的 AI Key

这是最关键的一步，目的是让项目知道如何连接到 AI 服务。

1.  在项目文件夹中，找到一个名为 `env.example` 的文件。

2.  复制这个文件，并把副本重命名为 `.env.local`。

3.  用任何文本编辑器（如记事本、VS Code）打开新建的 `.env.local` 文件。

4.  你会看到类似下面的内容：

    ```shell
    AI_PROVIDERS_CONFIG='[
      {{
        "name": "gemini_provider", 
        "apiKey": "your_gemini_api_key_here",
        "baseUrl": "https://xxx.com/v1",
        "model": "gemini-1.5-flash",
        "type": "google"
      },
      {
        "name": "gemini_provider", 
        "apiKey": "your_gemini_api_key_here",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "model": "gemini-1.5-flash",
        "type": "google"
      }
    ]'
    ```

5.  **简化并修改它**。将你在第 1 步中获取的 Gemini API Key 粘贴到 `apiKey` 的位置。为了简单起见，我们只保留一个 AI 提供商。修改后的内容应该如下所示：

    ```shell
    AI_PROVIDERS_CONFIG='[
      {
        "name": "my_gemini",
        "apiKey": "这里粘贴你从Google AI Studio获取的API Key",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "model": "gemini-1.5-flash",
        "type": "google"
      }
    ]'
    ```

6.  **保存并关闭** `.env.local` 文件。

-----

#### 第 5 步：启动项目！

一切准备就绪，现在可以运行项目了。

1.  回到你的终端（确保你仍然在项目文件夹目录下）。

2.  运行以下命令：

    ```bash
    pnpm dev
    ```

3.  终端会显示一些信息，如果一切顺利，你会看到提示项目已经成功启动。

-----

#### 第 6 步：访问应用

项目已经在你的电脑上运行了。

1.  打开你的网页浏览器 (如 Chrome, Edge, Firefox)。
2.  在地址栏输入 `http://localhost:3000` 并回车。
3.  现在你应该能看到魔法少女生成器的首页了！

至此，你已成功在本地部署了该项目。祝你玩得开心！

-----

#### 第 6.5 步：运行质量检查（可选）

如果你要提交代码或验证本地环境，请使用 pnpm 运行当前质量门禁：

```bash
pnpm test
pnpm lint
pnpm build
```

其中 `pnpm test` 使用 Vitest，`pnpm build` 使用 Next.js 构建；这些命令都不依赖 Bun。

-----

#### 第 7 步：配置 Cloudflare D1 Binding（Auth/ORM 必需）

部署到 Cloudflare Pages 时，请在项目环境变量中设置 `PNPM_VERSION=11.3.0`，确保平台使用与仓库 `packageManager` 一致的 pnpm 版本。

如果你要启用 Better Auth 与 Drizzle（推荐），需要在 `wrangler.toml` 中配置 `DB` 绑定。

1. 打开 `wrangler.toml`，确认存在以下结构（仓库已提供模板）：

```toml
[[d1_databases]]
binding = "DB"
database_name = "ifmahoushoujo"
database_id = "replace_with_production_d1_database_id"
preview_database_id = "replace_with_preview_d1_database_id"
migrations_dir = "drizzle"
```

2. 将 `database_id` / `preview_database_id` 替换成你在 Cloudflare D1 控制台中的真实 ID。

3. 如果你使用 `env.production` / `env.preview`，请同步替换对应区块里的 `d1_databases` 配置。

4. 部署前执行硬校验（会拦截占位值或非法 UUID）：

```bash
pnpm check:wrangler:d1
```

> 说明：当前项目里 Better Auth 路由（`/api/auth/[...all]`）在没有 `DB` 绑定时会直接返回 `BETTER_AUTH_DB_UNAVAILABLE`（503）。

-----

#### 第 8 步：执行 Drizzle Migration（本地/远端）

1. 生成迁移（如有 schema 改动）：

```bash
pnpm db:generate
```

2. 应用到本地 D1（生产环境配置）：

```bash
pnpm db:migrate:local:prod
```

3. 应用到远端 D1（生产）：

```bash
pnpm db:migrate:remote:prod
```

4. 预览环境可使用：

```bash
pnpm db:migrate:local:preview
pnpm db:migrate:remote:preview
```

> 说明：以上迁移命令已切换到 `scripts/d1-migrate-safe.mjs`，并内置以下保护：
> - 自动初始化 `d1_migrations` 元表并按文件顺序执行。
> - 对 `0001_users_admin_flags.sql` 采用“列存在检查 + 缺失补齐 + 迁移记录补写”，避免历史库因已存在列而中断。
> - 所有迁移前会先执行 `check:wrangler:d1`，阻断错误 D1 配置。

> 测试库建议：若仅在测试库验证，请额外带上 `--env-file env.test`（或在 shell 中先导入 `env.test`），避免误连生产配置。

> 补充：`scripts/backfill-user-auth-links.ts` 仍依赖 `CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID` 这组 HTTP API 凭据，请在 `.env.local` 中同时配置。
