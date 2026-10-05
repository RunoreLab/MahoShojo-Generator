# 竞技场新闻：给 AI 的生成说明

你必须输出一个完整、独立的 HTML 文档来替换 index.html；本包不提供完整网站或可直接展示的新闻成品。根据本场实际角色、战斗经过、结果和用户要求，原创编排新闻首页、可点击的文章详情、评论区与世界观内的模拟广告。新闻叙述应忠实于比赛输入；采访、评论、广告等创作内容应显著标注为虚构，不把未发生的事写成比赛事实。避免只有标题卡片而没有正文。

视觉、布局、栏目、报道视角由你决定：报纸、门户、独立杂志、赛场直播等均可。每篇文章应有独特内容和可访问的详情。不要照搬组件示例的占位文案。包内资源全部可用可不用，你也可以写自己的 CSS/JS；不必为了用完资源而堆砌组件。

你只能写 index.html，不能修改资源或生成其他文件。使用同一 HTML 内的 section 和 hash 链接模拟多页，例如 href="#article-one"，不要链接到不存在的 article.html。在 srcdoc 沙盒中原生 href="#..." 会继承宿主页地址，必须保留本包 news.js 的点击拦截，或自行用 preventDefault() 加 location.hash 实现当前文档路由；不要使用 link.href 或跨源 history.pushState。普通指向 DOM id 的跳转链接由脚本直接滚动并聚焦目标。写出完整正文、广告详情与交互所需标记。全部静态资源使用 assetCatalog 中的相对路径；运行时不要 fetch 本地文件、导入模块、动态加载组件或请求后端。组件 HTML 只是创作参考，不能 iframe/src/include 引用；如选择它们，请将 catalog 中示例结构改写进你的 HTML。

可选资源加载：head 中先 link styles/tokens.css，再 link styles/news.css；body 添加 class="news"。在 body 末尾以 <script src="scripts/news.js"></script> 引用经典脚本（也支持 DOMContentLoaded 自动初始化）。脚本会自动挂载；不需要额外调用 API。AI 可以覆写 CSS 变量和类；data-news-theme="night" 或 "broadcast" 可放在 body。不要通过 @import、CSS url()、模块 import 或 fetch 间接引用包内资源；图片使用 img src，配有合适 alt。

assetCatalog 已给出脚本完整属性契约，严格按契约使用。所有 view 包含唯一 data-news-view，首页为 home；详情初始 hidden。只使用一个全局搜索与分类器，data-news-item 仅放在首页新闻卡片。不要在同一按钮混用多类 data-news-* 操作。所有脚本操作只是内存内模拟，刷新会重置：明确告知用户；无需真实邮箱、账号、联系方式、付费或登录。脚本不保存信息，不依赖 localStorage/cookie，适用于隔离 iframe。

为键盘与读屏用户使用原生 a/button/form、可见 label、图片 alt、标题层级、可见焦点。按钮指定 type。本包脚本直接处理模拟表单的提交按钮点击与单行输入 Enter；textarea Enter 保留换行。沙盒没有 allow-forms，自写模拟逻辑也必须阻止按钮的原生提交并直接处理，不依赖 submit()/requestSubmit()。评论使用 required 和 maxlength；全局提供一个可见的 <p data-news-status role="status" aria-live="polite"></p>，放在所有路由 view 外。保留视口缩放，不添加 user-scalable=no。对动态用户文字只用 textContent 等安全 DOM API，不使用 innerHTML、eval 或 onclick 属性。

默认离线可用。确有必要时可用合适的 HTTPS 图片等外部素材并说明来源，但网络策略可能阻止外部资源，必须提供可读回退；不要使用外部脚本、追踪器或字体作为核心依赖。仓库 logo 仅作竞技场品牌标识，插画是抽象素材，不能冒充本场真实照片。
