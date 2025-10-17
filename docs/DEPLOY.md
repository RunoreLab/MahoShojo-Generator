### 部署指南：本地运行魔法少女生成器

这个指南将帮助你从零开始，在自己的电脑上成功运行这个项目。

-----

#### 第 1 步：准备工作 (环境安装)

在开始之前，你的电脑需要安装两个基本软件。

1.  **安装 Bun**

      * 这是一个现代化的工具，可以帮你安装和运行项目。根据 `README.md` 文件，这是项目推荐的工具。
      * 访问 [Bun 的官方网站](https://bun.sh/)，根据你的操作系统（Windows, macOS, Linux）按照指示进行安装。安装过程通常只需要在终端（命令行工具）里复制粘贴一行命令。

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
    bun install
    ```

4.  等待命令执行完成。Bun 会自动下载并安装所有需要的东西。

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
    bun run dev
    ```

3.  终端会显示一些信息，如果一切顺利，你会看到提示项目已经成功启动。

-----

#### 第 6 步：访问应用

项目已经在你的电脑上运行了。

1.  打开你的网页浏览器 (如 Chrome, Edge, Firefox)。
2.  在地址栏输入 `http://localhost:3000` 并回车。
3.  现在你应该能看到魔法少女生成器的首页了！

至此，你已成功在本地部署了该项目。祝你玩得开心！