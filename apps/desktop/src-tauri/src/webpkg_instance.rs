//! Web Package 受限 webview 的 staging 注册表与 `maho-webpkg` 资源 resolver（D4b / DESK-013 / DESK-014）。
//!
//! ## 不变量
//!
//! 1. **资源空间只由已验证的包构成。** 渲染层先把 ZIP 解成"声明文件表 + 逐文件字节"交给
//!    本模块，native 只按 portable path 与 media type 规则复核——它不解包、不读 manifest、
//!    不知道什么是 overlay。解包与 overlay 语义归 TypeScript 权威实现（`DESK-059`）。
//! 2. **label 与 instance 双向钉定。** webview label 是 `webpkg-<instanceId>`；resolver 只在
//!    "请求方 label 去掉前缀后等于 URL 里的 instance id"时才服务——foreign instance、
//!    main-ui、任何别的 webview 一律 404。这让同一 `maho-webpkg` origin 下的多个包窗口
//!    也拿不到彼此的字节。
//! 3. **失败一律 404。** 非法路径、未知 instance、未 Open 的 instance、未声明的文件——对外
//!    只有一种结果。不区分"不存在"与"不许看"，否则状态差异本身就是一份可探测的侧信道。
//! 4. **字节只活在内存里。** staging 不落盘：包字节归 blob store，临时镜像归本注册表；
//!    窗口 Destroyed 时 instance 连同字节一并释放。本模块**不产生任何文件路径**。
//!
//! ## 为什么 staging 走 begin/append/open 三段而不是一次调用
//!
//! 与 `export.rs` 同一条理由链：raw **请求**体不能携带结构化参数，而一个 ≤ 256 MiB 的文件表
//! 若用 base64 JSON 一次传入，会把 33% 体积膨胀与一次解码峰值直接落在渲染层——那正是
//! `DESK-064`/`DESK-070` 记在案的既有债务形态。begin 声明文件表（含每文件长度），append
//! 按 `x-webpkg-offset` 升序、以不超过 `MAX_APPEND_CHUNK_BYTES` 的块投递并核对偏移与
//! 声明长度，open 只在"每文件已收 = 声明"时开窗——完整性不是 UI 的礼貌约定，是 native
//! 的接收条件。"实例预算"（256 MiB 常驻字节）与"单次 IPC 预算"（4 MiB）是两个独立的量。
//!
//! ## staging TTL 与"为什么没有 finish/abort command"
//!
//! 渲染层崩在 staging 中途时，没有任何人会来收尾。本模块因此给 Collecting 会话一个 TTL，
//! 并在 `begin`/`append`/`open` 时惰性回收——与 `export.rs` 让 `begin` 回收旧会话是同一
//! 种自愈，只是这里用时间窗而不是顶替关系（同一个包可能同时被开两次）。

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;
use tauri::http;
use tauri::{AppHandle, Manager, WebviewUrl};
use tauri::{WebviewWindowBuilder, WindowEvent};

/// 自定义协议 scheme。必须与 `fixtures/desktop-web-package-instance.json` 一致。
pub const URI_SCHEME: &str = "maho-webpkg";
/// 资源 URL 的 host 段。macOS/Linux 上 URL 保持 `maho-webpkg://localhost/…`。
pub const RESOURCE_HOST: &str = "localhost";
/// Windows/Android 上 Tauri 把自定义协议映射为 `http://<scheme>.localhost`。
pub const WINDOWS_RESOURCE_HOST: &str = "maho-webpkg.localhost";
/// 资源命名空间前缀。与 `@mahoshojo/web-package` 的 `WEB_PACKAGE_INSTANCE_PREFIX` 同源。
pub const INSTANCE_URL_PREFIX: &str = "/__web-package__/instance/";
/// 受限 webview 的 label 前缀。capability 只授权 `main-ui`，因此此前缀天然零权限。
pub const WEBVIEW_LABEL_PREFIX: &str = "webpkg-";
/// append 请求携带 instance id 的 header。与 TS 契约同名。
pub const INSTANCE_ID_HEADER: &str = "x-webpkg-instance";
/// append 请求携带 percent-encode 后逻辑路径的 header。
pub const RESOURCE_PATH_HEADER: &str = "x-webpkg-path";
/// append 请求携带块内偏移的 header（十进制 u64）。native 按 "offset == 该文件已收字节数"
/// 验收——偏移乱序或越界都是 `webpkg-resource-mismatch`，不存在可猜测的语义。
pub const RESOURCE_OFFSET_HEADER: &str = "x-webpkg-offset";

/// 单实例文件数上限：与 `MAX_ARCHIVE_ENTRIES` 同源（解压工作量界，不是产品尺寸）。
pub const MAX_INSTANCE_FILES: usize = 4096;
/// 单实例**常驻 staging 字节**上限。与 `MAX_ARCHIVE_EXPANDED_BYTES`（ZIP 解压防护）
/// **语义独立**：一个是运行时内存占用界，一个是解包工作量界——当前恰好同取 256 MiB，
/// 任何一侧调整都必须单独评审。
pub const MAX_INSTANCE_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
/// `append_web_package_resource` 单次请求的体上限。"实例预算"与"单次 IPC 预算"是两个
/// 独立的量——前者允许 256 MiB，后者钉在 4 MiB（与 `MAX_LOCAL_LIBRARY_IPC_CHUNK_BYTES`
/// 同源），大文件由渲染层按 `x-webpkg-offset` 升序分块投递。
pub const MAX_APPEND_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
/// resolver 单帧响应上限：Range 请求的 206 响应不超过此值（镜像 Tauri 官方 streaming
/// 示例的单帧截断语义）。无 Range 的请求返回完整资源——单次响应分配的诚实上界因此是
/// 实例预算而非此数；把大文件切成 Range 读是 webview 自己的事。
pub const MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
/// 同时存活的 instance 上限（Collecting + Open）。机制界，不是产品承诺。
pub const MAX_LIVE_INSTANCES: usize = 8;
/// 全部存活 instance 的合计字节上限。
pub const MAX_LIVE_BYTES: u64 = 512 * 1024 * 1024;
/// 窗口标题上限。渲染层提供（通常 manifest.name），native 只按长度验收。
pub const MAX_TITLE_LENGTH: usize = 128;
/// Collecting 会话的存活时间。超时后下一次访问按 `webpkg-instance-stale` 失败并回收。
pub const COLLECT_TTL: Duration = Duration::from_secs(300);

/// `sandbox allow-scripts`：与 iframe restricted mode 同一语义的 HTTP 头形态。
/// 只对 `text/html` 响应下发——对非文档资源加 CSP 没有意义，反而会干扰 Worker/媒体加载。
const HTML_SANDBOX_CSP: &str = "sandbox allow-scripts";

/// `encodeURIComponent` 留下的字符集：unreserved（A-Z a-z 0-9 - _ . ! ~ * ' ( )）。
/// 与 `resource-space.ts` 的 `buildWebPackageInstanceUrl` 逐段编码同一规则——两侧对同一条
/// 逻辑路径必须编出同一个 URL 段，否则 TS 侧断言"resolver 会解析回该路径"不再可信。
const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// portable package path 校验（`WebPackagePathSchema` 的 Rust 镜像）。
///
/// 规则必须逐条对应，不能"差不多"：resolver 的 404 语义依赖它和 TS 侧对同一条路径给出
/// 同一结论。两侧的同一断言由 `fixtures/desktop-web-package-instance.json` 的
/// validPaths/invalidPaths 驱动。
///
/// - 长度 1..=512（按 `char` 数计，与 JS 的 UTF-16 code unit 口径不同——见下）。
/// - 不得以 `/` 开头；不得含 `\0-\x1f \x7f < > : " | ? * % \\`。
/// - 每个 `/` 分段：非空、非 `.`/`..`、不以 `.` 或空格结尾、文件名主干不是
///   `con|prn|aux|nul|com[1-9]|lpt[1-9]`（大小写不敏感）。
///
/// ## 长度口径差
///
/// JS 的 `.length`/`max(512)` 数的是 UTF-16 code unit，Rust 的 `chars().count()` 数的是
/// Unicode scalar。BMP 外字符（emoji 等）在 JS 里占 2、在 Rust 里占 1——即某些 513-code-unit
/// 路径会被 TS 拒、被 Rust 收。反过来（Rust 拒、TS 收）不可能发生：scalar 数永远
/// ≤ code unit 数。本函数是**接收侧**校验，更宽意味着唯一后果是"TS 放不进来的路径在
/// Rust 这里也能存"——而那样的路径根本到不了这里（TS 已经拒了）。按 UTF-8 字节数
/// 收紧会让合法的 512-code-unit 中文路径被误拒，因此选 `chars()` 口径并在测试里钉住。
pub fn is_valid_package_path(path: &str) -> bool {
    let length = path.chars().count();
    if length == 0 || length > 512 || path.starts_with('/') {
        return false;
    }
    if path.chars().any(|c| {
        matches!(
            c,
            '\u{0}'..='\u{1f}' | '\u{7f}' | '<' | '>' | ':' | '"' | '|' | '?' | '*' | '%' | '\\'
        )
    }) {
        return false;
    }
    for segment in path.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.ends_with('.')
            || segment.ends_with(' ')
            || is_reserved_file_stem(segment)
        {
            return false;
        }
    }
    true
}

/// `con|prn|aux|nul|com[1-9]|lpt[1-9]`（可带扩展名），大小写不敏感。
fn is_reserved_file_stem(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or_default();
    let lower = stem.to_ascii_lowercase();
    matches!(lower.as_str(), "con" | "prn" | "aux" | "nul")
        || (lower.len() == 4
            && (lower.starts_with("com") || lower.starts_with("lpt"))
            && lower.as_bytes()[3].is_ascii_digit()
            && lower.as_bytes()[3] != b'0')
}

/// media type 形状（`MediaTypeSchema` 的 Rust 镜像）：`token/token`，小写字符集。
///
/// resolver 把它直接写进 `Content-Type`，因此校验面必须与 manifest 侧一致——
/// 一个含 `;` 或空格的"media type"会成为响应头注入面。
pub fn is_valid_media_type(media_type: &str) -> bool {
    if media_type.len() > 128 || media_type.is_empty() {
        return false;
    }
    let Some((major, minor)) = media_type.split_once('/') else {
        return false;
    };
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "!#$&^_.+-".contains(c))
    };
    valid(major) && valid(minor)
}

/// `withCharset` 的 Rust 镜像：text/*、三个显式类型与 *+json/*+xml 追加 `; charset=utf-8`。
fn content_type_for(media_type: &str) -> String {
    if media_type.starts_with("text/")
        || matches!(
            media_type,
            "application/json" | "image/svg+xml" | "application/javascript"
        )
        || media_type.ends_with("+json")
        || media_type.ends_with("+xml")
    {
        return format!("{media_type}; charset=utf-8");
    }
    media_type.to_string()
}

/// Web Package instance id：`wpk-<单调正整数>`。渲染层只原样回传，形状是 native 的内部事实。
fn is_valid_instance_id(id: &str) -> bool {
    let Some(digits) = id.strip_prefix("wpk-") else {
        return false;
    };
    !digits.is_empty()
        && digits.len() <= 16
        && digits.chars().all(|c| c.is_ascii_digit())
        && !digits.starts_with('0')
}

/// `label = "webpkg-" + instance_id` 是双向钉定的唯一形态。
fn label_for_instance(instance_id: &str) -> String {
    format!("{WEBVIEW_LABEL_PREFIX}{instance_id}")
}

/// instance URL 里的一段：逐段 `encodeURIComponent` 等价编码。
pub fn encode_path_segments(path: &str) -> String {
    path.split('/')
        .map(|segment| utf8_percent_encode(segment, PATH_SEGMENT_ENCODE_SET).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// 入口文档的完整资源 URL（`maho-webpkg://localhost/<prefix><id>/<entry>`）。
pub fn entry_url(instance_id: &str, entry: &str) -> String {
    format!(
        "{URI_SCHEME}://{RESOURCE_HOST}{INSTANCE_URL_PREFIX}{instance_id}/{}",
        encode_path_segments(entry)
    )
}

/// 导航 allowlist：只允许 `maho-webpkg://localhost` 或 Windows 映射 `http://maho-webpkg.localhost`
/// 的 **本 instance** 路径。foreign instance 连导航都被拒（resolver 层还有第二道）。
pub fn is_allowed_navigation(url: &url::Url, instance_id: &str) -> bool {
    let host_ok = (url.scheme() == URI_SCHEME && url.host_str() == Some(RESOURCE_HOST))
        || (url.scheme() == "http" && url.host_str() == Some(WINDOWS_RESOURCE_HOST));
    host_ok
        && url
            .path()
            .starts_with(&format!("{INSTANCE_URL_PREFIX}{instance_id}/"))
}

/// instance URL path → (instance_id, package_path)。任何一步不合法都是 `None`。
fn parse_instance_path(pathname: &str) -> Option<(String, String)> {
    let rest = pathname.strip_prefix(INSTANCE_URL_PREFIX)?;
    let (instance_id, raw_path) = rest.split_once('/')?;
    if !is_valid_instance_id(instance_id) || raw_path.is_empty() {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(raw_path)
        .decode_utf8()
        .ok()?;
    if !is_valid_package_path(&decoded) {
        return None;
    }
    Some((instance_id.to_string(), decoded.into_owned()))
}

/// webpkg 失败。序列化 `{code, message}`——与 `export.rs`/`web_package.rs` 同一投影形状。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebpkgError {
    /// 请求形状不合法（路径/mediaType/entry/重复路径等契约违例）。
    Invalid,
    TooManyFiles,
    /// 单实例总字节或全局存活字节超预算。
    TooLarge,
    TooManyInstances,
    /// instance 不存在，或已度过 Collecting 阶段。
    InstanceMissing,
    /// Collecting 会话超过 TTL。
    InstanceStale,
    /// open 时仍有文件未送达。
    InstanceIncomplete,
    /// append 的文件不在 begin 声明的表里。
    ResourceUndeclared,
    /// 同一文件重复 append。
    ResourceDuplicate,
    /// 送达字节数与声明不符。
    ResourceMismatch,
    /// webview 创建/聚焦失败。
    WindowUnavailable,
    Failure,
}

impl WebpkgError {
    pub fn code(&self) -> &'static str {
        match self {
            WebpkgError::Invalid => "webpkg-invalid",
            WebpkgError::TooManyFiles => "webpkg-too-many-files",
            WebpkgError::TooLarge => "webpkg-too-large",
            WebpkgError::TooManyInstances => "webpkg-too-many-instances",
            WebpkgError::InstanceMissing => "webpkg-instance-missing",
            WebpkgError::InstanceStale => "webpkg-instance-stale",
            WebpkgError::InstanceIncomplete => "webpkg-instance-incomplete",
            WebpkgError::ResourceUndeclared => "webpkg-resource-undeclared",
            WebpkgError::ResourceDuplicate => "webpkg-resource-duplicate",
            WebpkgError::ResourceMismatch => "webpkg-resource-mismatch",
            WebpkgError::WindowUnavailable => "webpkg-window-unavailable",
            WebpkgError::Failure => "webpkg-failure",
        }
    }
}

impl std::fmt::Display for WebpkgError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WebpkgError::Invalid => write!(formatter, "Web Package 实例请求不合法"),
            WebpkgError::TooManyFiles => write!(formatter, "Web Package 实例文件数超限"),
            WebpkgError::TooLarge => write!(formatter, "Web Package 实例字节超预算"),
            WebpkgError::TooManyInstances => write!(formatter, "同时打开的 Web Package 实例过多"),
            WebpkgError::InstanceMissing => write!(formatter, "Web Package 实例不存在或已关闭"),
            WebpkgError::InstanceStale => {
                write!(formatter, "Web Package 实例暂存已超时，请重新打开")
            }
            WebpkgError::InstanceIncomplete => write!(formatter, "Web Package 资源尚未收齐"),
            WebpkgError::ResourceUndeclared => write!(formatter, "文件不在实例声明的文件表内"),
            WebpkgError::ResourceDuplicate => write!(formatter, "文件重复投递"),
            WebpkgError::ResourceMismatch => write!(formatter, "文件字节数与声明不符"),
            WebpkgError::WindowUnavailable => write!(formatter, "Web Package 窗口不可用"),
            WebpkgError::Failure => write!(formatter, "Web Package 实例操作失败"),
        }
    }
}

impl std::error::Error for WebpkgError {}

impl Serialize for WebpkgError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("WebpkgError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

/// begin 声明的一个文件。`media_type` 随字节走而不随索引走：它是 resolver 的响应事实，
/// 与 manifest 同源但不读 manifest。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclaredResourceFile {
    pub path: String,
    pub media_type: String,
    pub byte_length: u64,
}

#[derive(Debug)]
struct StagedFile {
    media_type: String,
    bytes: Vec<u8>,
}

/// `Open` 实例的两个阶段。区别只在窗口句柄是否已建成；字节与 label 都已在位。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenPhase {
    /// 字节已收齐、正在创建窗口。**resolver 从这个阶段起就允许服务**——初始页面
    /// 可能在 `.build()` 返回前就发出资源请求。
    Opening,
    /// 窗口已建立。回收挂在窗口 Destroyed 事件上。
    Serving,
}

#[derive(Debug)]
enum InstanceState {
    Collecting {
        title: String,
        entry: String,
        declared: HashMap<String, DeclaredResourceFile>,
        received: HashMap<String, StagedFile>,
        deadline: Instant,
    },
    Open {
        files: HashMap<String, StagedFile>,
        label: String,
        phase: OpenPhase,
    },
}

#[derive(Debug, Default)]
struct RegistryInner {
    instances: HashMap<String, InstanceState>,
    /// 所有存活 instance（Collecting + Open）已收字节合计。
    live_bytes: u64,
}

/// `maho-webpkg` instance 注册表。进程内、纯内存、无文件系统面。
///
/// `Mutex` 的理由与 `export.rs` 相同：`State<'_, T>` 只给 `&T`，并发 command 会同时到达，
/// 内部可变性让"并发 begin/append/open"有确定的答案而不是未定义。
#[derive(Debug)]
pub struct WebPackageInstances {
    inner: Mutex<RegistryInner>,
    /// 第二次 `open` 遇到 `Opening` 时挂在这里等第一次建窗完成，而不是把
    /// instance 当成"窗口缺失"删掉。任何离开 `Opening` 的转移都必须 `notify_all`。
    open_ready: Condvar,
    next_id: AtomicU64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginInstanceOutcome {
    pub instance_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendResourceOutcome {
    pub received_byte_length: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInstanceOutcome {
    pub label: String,
}

impl Default for WebPackageInstances {
    fn default() -> Self {
        Self {
            inner: Mutex::new(RegistryInner::default()),
            open_ready: Condvar::new(),
            next_id: AtomicU64::new(1),
        }
    }
}

impl WebPackageInstances {
    /// 目标会话本身已过期时给出 `webpkg-instance-stale` 并当场回收。
    ///
    /// 这个分支存在于 `evict_expired` 之前：`stale` 与 `missing` 对调用方是两种
    /// 信号——前者说"重新走一遍 staging"，后者说"这个 id 你从来没有过"。如果先整体
    /// 惰性回收再查表，过期会话会被静默并进 missing，契约里 `stale` 就永远是死码。
    fn fail_if_stale(
        &self,
        inner: &mut RegistryInner,
        instance_id: &str,
        now: Instant,
    ) -> Result<(), WebpkgError> {
        if let Some(InstanceState::Collecting { deadline, .. }) = inner.instances.get(instance_id) {
            if *deadline <= now {
                Self::remove_instance(inner, instance_id);
                return Err(WebpkgError::InstanceStale);
            }
        }
        Ok(())
    }

    /// 回收超时的 Collecting 会话。Open 实例不参与——它们的回收挂在
    /// 窗口生命周期上（建窗失败即时回收、Destroyed 事件回收）。
    fn evict_expired(inner: &mut RegistryInner, now: Instant) {
        let mut freed = 0u64;
        inner.instances.retain(|_id, state| match state {
            InstanceState::Collecting {
                deadline, received, ..
            } => {
                if *deadline <= now {
                    freed += received.values().map(|f| f.bytes.len() as u64).sum::<u64>();
                    false
                } else {
                    true
                }
            }
            InstanceState::Open { .. } => true,
        });
        inner.live_bytes = inner.live_bytes.saturating_sub(freed);
    }

    /// 开启一次 staging。声明的全部校验都在这里，command 层只做 DTO 形状转换。
    pub fn begin(
        &self,
        entry: &str,
        title: &str,
        files: Vec<DeclaredResourceFile>,
        now: Instant,
    ) -> Result<BeginInstanceOutcome, WebpkgError> {
        if files.is_empty() {
            return Err(WebpkgError::Invalid);
        }
        if files.len() > MAX_INSTANCE_FILES {
            return Err(WebpkgError::TooManyFiles);
        }
        let title = title.trim();
        if title.is_empty() || title.chars().count() > MAX_TITLE_LENGTH {
            return Err(WebpkgError::Invalid);
        }
        if !is_valid_package_path(entry) {
            return Err(WebpkgError::Invalid);
        }
        let mut declared = HashMap::with_capacity(files.len());
        let mut folded_paths = HashSet::with_capacity(files.len());
        let mut total = 0u64;
        for file in &files {
            if !is_valid_package_path(&file.path)
                || !is_valid_media_type(&file.media_type)
                || file.byte_length > MAX_INSTANCE_TOTAL_BYTES
                || !folded_paths.insert(file.path.to_lowercase())
            {
                return Err(WebpkgError::Invalid);
            }
            total = total
                .checked_add(file.byte_length)
                .ok_or(WebpkgError::TooLarge)?;
            declared.insert(file.path.clone(), file.clone());
        }
        if total > MAX_INSTANCE_TOTAL_BYTES {
            return Err(WebpkgError::TooLarge);
        }
        // entry 必须是声明表中的 text/html 文件——与 manifest 的 entry 约束同源。
        match declared.get(entry) {
            Some(file) if file.media_type == "text/html" => {}
            _ => return Err(WebpkgError::Invalid),
        }

        let mut inner = self.inner.lock().map_err(|_| WebpkgError::Failure)?;
        Self::evict_expired(&mut inner, now);
        if inner.instances.len() >= MAX_LIVE_INSTANCES {
            return Err(WebpkgError::TooManyInstances);
        }
        if inner.live_bytes.saturating_add(total) > MAX_LIVE_BYTES {
            return Err(WebpkgError::TooLarge);
        }

        let id = format!("wpk-{}", self.next_id.fetch_add(1, Ordering::SeqCst));
        inner.instances.insert(
            id.clone(),
            InstanceState::Collecting {
                title: title.to_string(),
                entry: entry.to_string(),
                declared,
                received: HashMap::new(),
                deadline: now + COLLECT_TTL,
            },
        );
        Ok(BeginInstanceOutcome { instance_id: id })
    }

    /// 追加一个文件的一段字节。每个声明的文件按 `x-webpkg-offset` 升序、以不超过
    /// `MAX_APPEND_CHUNK_BYTES` 的块投递——单次 IPC 预算与实例预算是两个独立的量。
    /// 偏移必须恰好接上已收字节：乱序、跳跃、重叠与越界都是 `webpkg-resource-mismatch`。
    pub fn append(
        &self,
        instance_id: &str,
        encoded_path: &str,
        offset: u64,
        bytes: &[u8],
        now: Instant,
    ) -> Result<AppendResourceOutcome, WebpkgError> {
        let path = percent_encoding::percent_decode_str(encoded_path)
            .decode_utf8()
            .map_err(|_| WebpkgError::Invalid)?;
        if !is_valid_package_path(&path) {
            return Err(WebpkgError::Invalid);
        }
        if bytes.len() as u64 > MAX_APPEND_CHUNK_BYTES {
            return Err(WebpkgError::TooLarge);
        }
        let mut inner = self.inner.lock().map_err(|_| WebpkgError::Failure)?;
        self.fail_if_stale(&mut inner, instance_id, now)?;
        Self::evict_expired(&mut inner, now);
        let RegistryInner {
            instances,
            live_bytes,
        } = &mut *inner;
        let Some(state) = instances.get_mut(instance_id) else {
            return Err(WebpkgError::InstanceMissing);
        };
        let InstanceState::Collecting {
            declared, received, ..
        } = state
        else {
            // 已 Open 的 instance 不再接受 staging：资源空间在开窗那一刻冻结。
            return Err(WebpkgError::InstanceMissing);
        };
        let Some(file) = declared.get(path.as_ref()) else {
            return Err(WebpkgError::ResourceUndeclared);
        };
        // 已收满的文件再收任何字节都是重复投递——比"偏移不对"更接近调用方的错误。
        // 先查已有条目再插：0 字节文件的首次空块 append 也满足 len==declared，
        // 顺序反了会让零长文件永远无法完成。
        if received
            .get(path.as_ref())
            .is_some_and(|s| s.bytes.len() as u64 == file.byte_length)
        {
            return Err(WebpkgError::ResourceDuplicate);
        }
        let staged = received
            .entry(path.clone().into_owned())
            .or_insert_with(|| StagedFile {
                media_type: file.media_type.clone(),
                bytes: Vec::new(),
            });
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or(WebpkgError::ResourceMismatch)?;
        if end > file.byte_length || offset != staged.bytes.len() as u64 {
            return Err(WebpkgError::ResourceMismatch);
        }
        if live_bytes.saturating_add(bytes.len() as u64) > MAX_LIVE_BYTES {
            return Err(WebpkgError::TooLarge);
        }
        staged.bytes.extend_from_slice(bytes);
        *live_bytes += bytes.len() as u64;
        Ok(AppendResourceOutcome {
            received_byte_length: staged.bytes.len() as u64,
        })
    }

    /// 收齐后开窗。窗口创建失败时 instance 一并丢弃：留着半开状态没有任何可恢复路径。
    ///
    /// `app` 只用于 `WebviewWindowBuilder` 与 Destroyed 清理——本模块因此**不**出现在
    /// `setup` 之前的依赖里，与 `export.rs` 对 `AppHandle` 的用法一致。
    pub fn open(
        &self,
        app: &AppHandle,
        instance_id: &str,
        now: Instant,
    ) -> Result<OpenInstanceOutcome, WebpkgError> {
        let mut inner = self.inner.lock().map_err(|_| WebpkgError::Failure)?;
        self.fail_if_stale(&mut inner, instance_id, now)?;
        Self::evict_expired(&mut inner, now);

        /// `open` 状态机的一步裁决：先在不持锁借用的块内判出动作，再执行——
        /// `get_mut` 的借用与 `drop(inner)`/等待不能在同一个 match 里共存。
        enum OpenStep {
            Focus(String),
            Wait,
            Take(String, String, HashMap<String, StagedFile>),
            Missing,
        }
        let (title, entry, files) = loop {
            let step = match inner.instances.get_mut(instance_id) {
                Some(InstanceState::Open {
                    label,
                    phase: OpenPhase::Serving,
                    ..
                }) => OpenStep::Focus(label.clone()),
                Some(InstanceState::Open {
                    phase: OpenPhase::Opening,
                    ..
                }) => OpenStep::Wait,
                Some(InstanceState::Collecting {
                    title,
                    entry,
                    declared,
                    received,
                    ..
                }) => {
                    // 分块 staging 后"到齐"是逐文件的 len 等式，不是条目数等式——
                    // 文件收到第一块时就已经在表里了。
                    let complete = declared.len() == received.len()
                        && declared.iter().all(|(p, d)| {
                            received
                                .get(p)
                                .is_some_and(|f| f.bytes.len() as u64 == d.byte_length)
                        });
                    if !complete {
                        return Err(WebpkgError::InstanceIncomplete);
                    }
                    OpenStep::Take(title.clone(), entry.clone(), std::mem::take(received))
                }
                None => OpenStep::Missing,
            };
            match step {
                // 已经打开：聚焦既有窗口而不是再开一个。Destroyed 清理保证
                // Serving ⇒ 窗口仍在；若竞态下窗口恰好不在，收掉这条 instance
                // 让调用方重新 staging。
                OpenStep::Focus(label) => {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.set_focus();
                        drop(inner);
                        return Ok(OpenInstanceOutcome { label });
                    }
                    Self::remove_instance(&mut inner, instance_id);
                    drop(inner);
                    return Err(WebpkgError::InstanceMissing);
                }
                // 第一次 open 正在建窗：等它出结果。窗口不存在是 `Opening` 的
                // 正常中间态而不是删除条件——若在此时按"窗口缺失"回收，第一次
                // 建窗完成后 resolver 只剩 404。
                OpenStep::Wait => {
                    inner = self
                        .open_ready
                        .wait(inner)
                        .map_err(|_| WebpkgError::Failure)?;
                }
                OpenStep::Take(taken_title, taken_entry, taken_files) => {
                    break (taken_title, taken_entry, taken_files);
                }
                OpenStep::Missing => {
                    drop(inner);
                    return Err(WebpkgError::InstanceMissing);
                }
            }
        };

        let label = label_for_instance(instance_id);
        let url = entry_url(instance_id, &entry);
        // 在放开互斥锁前把状态推进到 Opening——并发第二次 open 会走"等待建窗"分支，
        // resolver 此刻起也已经能服务资源（初始页面请求可能先于 .build() 返回）。
        if let Some(state) = inner.instances.get_mut(instance_id) {
            *state = InstanceState::Open {
                files,
                label: label.clone(),
                phase: OpenPhase::Opening,
            };
        } else {
            return Err(WebpkgError::Failure);
        }
        drop(inner);

        match build_webpkg_window(app, instance_id, &label, &title, &url) {
            Ok(()) => {
                if let Ok(mut inner) = self.inner.lock() {
                    if let Some(InstanceState::Open { phase, .. }) =
                        inner.instances.get_mut(instance_id)
                    {
                        *phase = OpenPhase::Serving;
                    }
                    self.open_ready.notify_all();
                }
                Ok(OpenInstanceOutcome { label })
            }
            Err(error) => {
                // 窗口没建成：回收 instance，字节立即释放——否则它们会以"永远不会被
                // 服务"的形态占到 TTL 结束。
                if let Ok(mut inner) = self.inner.lock() {
                    Self::remove_instance(&mut inner, instance_id);
                    self.open_ready.notify_all();
                }
                Err(error)
            }
        }
    }

    /// 移除一个 instance 并扣回其全部已收字节。
    fn remove_instance(inner: &mut RegistryInner, instance_id: &str) {
        let freed = match inner.instances.remove(instance_id) {
            Some(InstanceState::Collecting { received, .. }) => {
                received.values().map(|f| f.bytes.len() as u64).sum()
            }
            Some(InstanceState::Open { files, .. }) => {
                files.values().map(|f| f.bytes.len() as u64).sum()
            }
            None => 0,
        };
        inner.live_bytes = inner.live_bytes.saturating_sub(freed);
    }

    /// 窗口 Destroyed 时的回收点。按 label 找——这是窗口自己的身份，不需要渲染层回传。
    pub fn remove_by_label(&self, label: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        let instance_id = inner.instances.iter().find_map(|(id, state)| match state {
            InstanceState::Open { label: l, .. } if l == label => Some(id.clone()),
            _ => None,
        });
        if let Some(instance_id) = instance_id {
            Self::remove_instance(&mut inner, &instance_id);
            self.open_ready.notify_all();
        }
    }

    /// resolver 的资源查找：只在 label↔instance 钉定成立且 instance 已进入
    /// Opening/Serving 时返回文件——`Opening` 起即可服务，因为初始页面请求可能
    /// 先于 `.build()` 返回到达。
    ///
    /// `range_header` 非空时按 RFC 7233 单段字节区间服务：`HttpRange::parse` 的
    /// clamp/越界语义直接复用，不可满足与多段请求都归一成 `NotSatisfiable`（416）。
    /// 返回体只包含区间内的切片——大文件的瞬态副本由 `MAX_RESPONSE_BYTES` 封顶，
    /// 不再随文件尺寸线性放大。
    fn resolve(
        &self,
        webview_label: &str,
        uri_path: &str,
        range_header: Option<&str>,
    ) -> ResolveOutcome {
        let Some(instance_id) = webview_label.strip_prefix(WEBVIEW_LABEL_PREFIX) else {
            return ResolveOutcome::NotFound;
        };
        let Some((url_instance, path)) = parse_instance_path(uri_path) else {
            return ResolveOutcome::NotFound;
        };
        if url_instance != instance_id {
            return ResolveOutcome::NotFound;
        }
        let Ok(inner) = self.inner.lock() else {
            return ResolveOutcome::NotFound;
        };
        let Some(InstanceState::Open { files, label, .. }) = inner.instances.get(instance_id)
        else {
            return ResolveOutcome::NotFound;
        };
        if label != webview_label {
            return ResolveOutcome::NotFound;
        }
        // 借用跨不出 MutexGuard，复制 header/字节——见 StagedFileRef 上的注释。
        let Some(file) = files.get(&path) else {
            return ResolveOutcome::NotFound;
        };
        let total = file.bytes.len() as u64;
        match range_header {
            Some(header) => {
                let Ok(ranges) = http_range::HttpRange::parse(header, total) else {
                    return ResolveOutcome::NotSatisfiable { total };
                };
                // 只服务单段 Range：multipart/byteranges 的复杂度远超其在本协议里的
                // 价值，webview 的媒体栈也只发单段请求。
                if ranges.len() != 1 {
                    return ResolveOutcome::NotSatisfiable { total };
                }
                let range = ranges[0];
                // 单帧截断：请求段可以很大，一次响应最多 MAX_RESPONSE_BYTES——
                // 与 Tauri 官方 streaming 示例同一语义，调用方按 Content-Range 续读。
                let end_inclusive = (range.start + range.length - 1)
                    .min(range.start + MAX_RESPONSE_BYTES - 1)
                    .min(total - 1);
                ResolveOutcome::Found(StagedFileRef {
                    media_type: file.media_type.clone(),
                    total,
                    start: range.start,
                    bytes: file.bytes[range.start as usize..=end_inclusive as usize].to_vec(),
                })
            }
            None => ResolveOutcome::Found(StagedFileRef {
                media_type: file.media_type.clone(),
                total,
                start: 0,
                bytes: file.bytes.clone(),
            }),
        }
    }
}

/// `resolve` 的裁决。`NotFound` 覆盖**全部**拒绝路径（未知 instance / label 不匹配 /
/// 未 Open / 非法或越权路径）——对外只有一种失败，见模块文档第 3 条。
enum ResolveOutcome {
    NotFound,
    /// 资源存在但 Range 不可满足。只对已通过钉定校验的请求方可见，不构成侧信道。
    NotSatisfiable {
        total: u64,
    },
    Found(StagedFileRef),
}

/// `resolve` 的返回面。文件字节被 `Clone` 出来而不是借用：注册表锁不能跨响应生命周期
/// 持有（resolver 在 Tauri 协议线程上同步返回，借用会把锁变成请求级临界区）。Range
/// 服务时 `bytes` 只是区间内的一段切片，`total`/`start` 供 `Content-Range` 拼接。
struct StagedFileRef {
    media_type: String,
    total: u64,
    start: u64,
    bytes: Vec<u8>,
}

/// 创建受限 webview。所有 hardening 接线都聚在这一个函数里——结构门禁据此断言
/// 源码形状，而不是靠人记得"这个 webview 是不是忘了什么"。
fn build_webpkg_window(
    app: &AppHandle,
    instance_id: &str,
    label: &str,
    title: &str,
    url: &str,
) -> Result<(), WebpkgError> {
    let parsed = url::Url::parse(url).map_err(|_| WebpkgError::WindowUnavailable)?;
    let nav_instance = instance_id.to_string();
    // `External` 的 API 契约是 http/https；自定义 scheme 必须走 `CustomProtocol`——
    // 虽然当前实现在内部兼容透传，依赖"恰好能跑"会让一次上游收紧变成无提示回归。
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::CustomProtocol(parsed))
        .title(title)
        .inner_size(1024.0, 720.0)
        .resizable(true)
        // 受限渲染面的持久化边界：不与别的会话共享 profile，关闭即清。
        .incognito(true)
        // 导航钉在本 instance 命名空间：外链/他实例/about:/data:/javascript: 一律拒。
        .on_navigation(move |url| is_allowed_navigation(url, &nav_instance))
        // 包不得弹出新窗口——弹窗会是一个没有 capability、但仍携带包内容的新渲染面，
        // DESK-013 的"独立 webview"只有一个。
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
        // DESK-014：浏览器权限默认拒绝。不区分 camera/mic/geo/clipboard——一概 Deny，
        // 不存在"先放行某种低风险权限再逐项收紧"的理由。
        .on_permission_request(|_webview, _kind| tauri::webview::PermissionResponse::Deny)
        // 包不得触发写盘下载：本地文件写入不属于受限模式语义。
        .on_download(|_webview, _event| false)
        .build()
        .map_err(|_| WebpkgError::WindowUnavailable)?;

    // 窗口销毁即释放 instance 与其全部字节。这里只按 label 清——它是窗口自身的身份，
    // 不引入任何需要渲染层回传的选择器。
    let cleanup = app.clone();
    let cleanup_label = label.to_string();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            cleanup
                .state::<WebPackageInstances>()
                .remove_by_label(&cleanup_label);
        }
    });
    Ok(())
}

/// `maho-webpkg` 协议响应。返回类型与 `register_uri_scheme_protocol` 的 `T: Into<Cow>` 匹配。
///
/// 读完整 `Request` 而不是只读 URI：`Range` 头决定返回 200 全量还是 206 区间
/// （镜像 Tauri 官方 streaming 示例的 Range → 206 → 单帧截断语义）。所有授权类失败
/// 统一 404 + 同一组安全响应头，Range 不可满足单独走 416——它只对已通过钉定校验的
/// 请求方可见，见模块文档第 3 条。
pub fn resolve_webpkg_request(
    registry: &WebPackageInstances,
    webview_label: &str,
    request: &http::Request<Vec<u8>>,
) -> http::Response<std::borrow::Cow<'static, [u8]>> {
    let uri_path = request.uri().path();
    let range_header = request
        .headers()
        .get(http::header::RANGE)
        .and_then(|value| value.to_str().ok());
    match registry.resolve(webview_label, uri_path, range_header) {
        ResolveOutcome::Found(file) => {
            let mut builder = http::Response::builder();
            for (name, value) in BASE_HEADERS {
                builder = builder.header(*name, *value);
            }
            builder = builder
                .header(http::header::ACCEPT_RANGES, "bytes")
                .header(
                    http::header::CONTENT_TYPE,
                    content_type_for(&file.media_type),
                )
                .header(http::header::CONTENT_LENGTH, file.bytes.len());
            if range_header.is_some() {
                let end = file.start + file.bytes.len() as u64 - 1;
                builder = builder.status(http::StatusCode::PARTIAL_CONTENT).header(
                    http::header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", file.start, end, file.total),
                );
            } else {
                builder = builder.status(http::StatusCode::OK);
            }
            if file.media_type == "text/html" {
                builder = builder.header("Content-Security-Policy", HTML_SANDBOX_CSP);
            }
            builder
                .body(std::borrow::Cow::Owned(file.bytes))
                .unwrap_or_else(|_| not_found_response())
        }
        ResolveOutcome::NotSatisfiable { total } => {
            let mut builder =
                http::Response::builder().status(http::StatusCode::RANGE_NOT_SATISFIABLE);
            for (name, value) in BASE_HEADERS {
                builder = builder.header(*name, *value);
            }
            builder
                .header(http::header::CONTENT_RANGE, format!("bytes */{total}"))
                .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(std::borrow::Cow::Borrowed(
                    b"Range Not Satisfiable" as &[u8],
                ))
                .unwrap_or_else(|_| not_found_response())
        }
        ResolveOutcome::NotFound => not_found_response(),
    }
}

/// 每个响应（包括 404）都带的安全基线头。与 fixture 的 `responseHeaders.base` 同源。
const BASE_HEADERS: &[(&str, &str)] = &[
    ("Access-Control-Allow-Origin", "*"),
    ("Referrer-Policy", "no-referrer"),
    ("X-Content-Type-Options", "nosniff"),
];

fn not_found_response() -> http::Response<std::borrow::Cow<'static, [u8]>> {
    let mut builder = http::Response::builder().status(http::StatusCode::NOT_FOUND);
    for (name, value) in BASE_HEADERS {
        builder = builder.header(*name, *value);
    }
    builder
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(std::borrow::Cow::Borrowed(b"Not Found" as &[u8]))
        .expect("static 404 response must build")
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str =
        include_str!("../../../../packages/contracts/fixtures/desktop-web-package-instance.json");

    fn fixture() -> serde_json::Value {
        serde_json::from_str(FIXTURE).expect("shared webpkg fixture must be valid JSON")
    }

    fn declared(path: &str, media_type: &str, byte_length: u64) -> DeclaredResourceFile {
        DeclaredResourceFile {
            path: path.to_string(),
            media_type: media_type.to_string(),
            byte_length,
        }
    }

    fn begin(
        registry: &WebPackageInstances,
        entry: &str,
        files: Vec<DeclaredResourceFile>,
    ) -> Result<BeginInstanceOutcome, WebpkgError> {
        registry.begin(entry, "示例包", files, Instant::now())
    }

    /// resolver 测试的 Request 构造：`uri()` 只有 path 段参与判定，host 任意取
    /// scheme 的正则形态即可。
    fn request(path: &str, range: Option<&str>) -> http::Request<Vec<u8>> {
        let mut builder =
            http::Request::builder().uri(format!("{URI_SCHEME}://{RESOURCE_HOST}{path}"));
        if let Some(range) = range {
            builder = builder.header(http::header::RANGE, range);
        }
        builder.body(Vec::new()).expect("static request must build")
    }

    /// 把一个 Collecting instance 直接推入 Open：open() 需要真窗口，
    /// resolver 语义与窗口创建解耦单测。
    fn promote_to_open(registry: &WebPackageInstances, instance_id: &str, phase: OpenPhase) {
        let mut inner = registry.inner.lock().unwrap();
        if let Some(InstanceState::Collecting { received, .. }) =
            inner.instances.get_mut(instance_id)
        {
            let files = std::mem::take(received);
            inner.instances.insert(
                instance_id.to_string(),
                InstanceState::Open {
                    files,
                    label: label_for_instance(instance_id),
                    phase,
                },
            );
        }
    }

    #[test]
    fn 协议与命名常量与共享_fixture_一致() {
        let fixture = fixture();
        assert_eq!(URI_SCHEME, fixture["uriScheme"].as_str().unwrap());
        assert_eq!(RESOURCE_HOST, fixture["resourceHost"].as_str().unwrap());
        assert_eq!(
            WINDOWS_RESOURCE_HOST,
            fixture["windowsResourceHost"].as_str().unwrap()
        );
        assert_eq!(
            INSTANCE_URL_PREFIX,
            fixture["instanceUrlPrefix"].as_str().unwrap()
        );
        assert_eq!(
            WEBVIEW_LABEL_PREFIX,
            fixture["webviewLabelPrefix"].as_str().unwrap()
        );
        assert_eq!(
            INSTANCE_ID_HEADER,
            fixture["headers"]["instanceId"].as_str().unwrap()
        );
        assert_eq!(
            RESOURCE_PATH_HEADER,
            fixture["headers"]["resourcePath"].as_str().unwrap()
        );
        assert_eq!(
            RESOURCE_OFFSET_HEADER,
            fixture["headers"]["resourceOffset"].as_str().unwrap()
        );
        assert_eq!(
            MAX_INSTANCE_FILES as u64,
            fixture["budgets"]["maxFiles"].as_u64().unwrap()
        );
        assert_eq!(
            MAX_INSTANCE_TOTAL_BYTES,
            fixture["budgets"]["maxTotalBytes"].as_u64().unwrap()
        );
        assert_eq!(
            MAX_APPEND_CHUNK_BYTES,
            fixture["budgets"]["maxAppendChunkBytes"].as_u64().unwrap()
        );
        assert_eq!(
            MAX_RESPONSE_BYTES,
            fixture["budgets"]["maxResponseBytes"].as_u64().unwrap()
        );
        assert_eq!(
            MAX_LIVE_INSTANCES as u64,
            fixture["budgets"]["maxLiveInstances"].as_u64().unwrap()
        );
        assert_eq!(
            MAX_LIVE_BYTES,
            fixture["budgets"]["maxLiveBytes"].as_u64().unwrap()
        );
        assert_eq!(
            MAX_TITLE_LENGTH as u64,
            fixture["budgets"]["maxTitleLength"].as_u64().unwrap()
        );
        assert_eq!(
            COLLECT_TTL,
            Duration::from_secs(
                fixture["budgets"]["collectTimeoutSeconds"]
                    .as_u64()
                    .unwrap()
            )
        );
    }

    #[test]
    fn 错误码与共享_fixture_逐项一致() {
        let fixture = fixture();
        let fixture_codes: Vec<&str> = fixture["errorCodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|code| code.as_str().unwrap())
            .collect();
        let rust_codes = [
            WebpkgError::Invalid,
            WebpkgError::TooManyFiles,
            WebpkgError::TooLarge,
            WebpkgError::TooManyInstances,
            WebpkgError::InstanceMissing,
            WebpkgError::InstanceStale,
            WebpkgError::InstanceIncomplete,
            WebpkgError::ResourceUndeclared,
            WebpkgError::ResourceDuplicate,
            WebpkgError::ResourceMismatch,
            WebpkgError::WindowUnavailable,
            WebpkgError::Failure,
        ]
        .iter()
        .map(WebpkgError::code)
        .collect::<Vec<_>>();
        assert_eq!(rust_codes, fixture_codes);
    }

    #[test]
    fn portable_path_规则与_shared_fixture_一致() {
        let fixture = fixture();
        for path in fixture["validPaths"].as_array().unwrap() {
            let path = path.as_str().unwrap();
            assert!(is_valid_package_path(path), "fixture marks {path:?} valid");
        }
        for path in fixture["invalidPaths"].as_array().unwrap() {
            let path = path.as_str().unwrap();
            assert!(
                !is_valid_package_path(path),
                "fixture marks {path:?} invalid"
            );
        }
        // 超长由现场生成（fixture 不逐字携带 513 字节），与 TS 侧同一断言。
        assert!(!is_valid_package_path(&"a".repeat(513)));
        assert!(is_valid_package_path(&"a".repeat(512)));
    }

    #[test]
    fn media_type_规则与_shared_fixture_一致() {
        let fixture = fixture();
        for media_type in fixture["validMediaTypes"].as_array().unwrap() {
            let media_type = media_type.as_str().unwrap();
            assert!(
                is_valid_media_type(media_type),
                "fixture marks {media_type:?} valid"
            );
        }
        for media_type in fixture["invalidMediaTypes"].as_array().unwrap() {
            let media_type = media_type.as_str().unwrap();
            assert!(
                !is_valid_media_type(media_type),
                "fixture marks {media_type:?} invalid"
            );
        }
    }

    #[test]
    fn content_type_决策与_fixture_的_cases_一致() {
        let fixture = fixture();
        for case in fixture["responseHeaders"]["contentTypeCases"]
            .as_array()
            .unwrap()
        {
            let media_type = case["mediaType"].as_str().unwrap();
            let expected = case["contentType"].as_str().unwrap();
            assert_eq!(content_type_for(media_type), expected, "{media_type}");
        }
    }

    #[test]
    fn entry_url_与_fixture_示例一致() {
        let fixture = fixture();
        assert_eq!(
            entry_url("wpk-7", "index.html"),
            fixture["entryUrlExample"].as_str().unwrap()
        );
        // 非 ASCII 路径逐段编码，解码后仍是同一逻辑路径。
        let url = entry_url("wpk-7", "assets/背景.svg");
        assert!(url.starts_with(&format!(
            "{URI_SCHEME}://{RESOURCE_HOST}{INSTANCE_URL_PREFIX}wpk-7/"
        )));
        let path = url::Url::parse(&url).unwrap();
        assert_eq!(
            parse_instance_path(path.path()),
            Some(("wpk-7".to_string(), "assets/背景.svg".to_string()))
        );
    }

    #[test]
    fn 路径逐段编码与_encodeuricomponent_规则一致() {
        // '#' 与空格必须被编进路径而不是变成 fragment/host 分隔符——这是把
        // "逻辑路径"与"URL 结构"分开的关键。
        assert_eq!(
            encode_path_segments("notes/report#1.html"),
            "notes/report%231.html"
        );
        assert_eq!(encode_path_segments("my file.js"), "my%20file.js");
        assert_eq!(encode_path_segments("a/b"), "a/b");
    }

    #[test]
    fn 导航只允许本_instance_的两种_origin_形态() {
        let allow = |raw: &str| is_allowed_navigation(&url::Url::parse(raw).unwrap(), "wpk-7");
        assert!(allow(
            "maho-webpkg://localhost/__web-package__/instance/wpk-7/index.html"
        ));
        assert!(allow(
            "http://maho-webpkg.localhost/__web-package__/instance/wpk-7/index.html"
        ));
        // foreign instance、根路径、外部 URL、https 形态、data: 一律拒。
        for raw in [
            "maho-webpkg://localhost/__web-package__/instance/wpk-8/index.html",
            "maho-webpkg://localhost/__web-package__/instance/wpk-7",
            "maho-webpkg://localhost/",
            "http://maho-webpkg.localhost/other/index.html",
            "https://maho-webpkg.localhost/__web-package__/instance/wpk-7/index.html",
            "https://example.com/x",
            "data:text/html,<script>1</script>",
            "about:blank",
        ] {
            assert!(!allow(raw), "{raw} MUST be denied");
        }
    }

    #[test]
    fn begin_验收声明表并拒绝违例() {
        let registry = WebPackageInstances::default();
        // entry 必须是声明的 text/html。
        assert_eq!(
            begin(
                &registry,
                "index.html",
                vec![declared("index.html", "text/plain", 1)]
            )
            .unwrap_err(),
            WebpkgError::Invalid
        );
        assert_eq!(
            begin(
                &registry,
                "missing.html",
                vec![declared("index.html", "text/html", 1)]
            )
            .unwrap_err(),
            WebpkgError::Invalid
        );
        // 大小写折叠后重复。
        assert_eq!(
            begin(
                &registry,
                "index.html",
                vec![
                    declared("index.html", "text/html", 1),
                    declared("INDEX.HTML", "text/html", 1)
                ]
            )
            .unwrap_err(),
            WebpkgError::Invalid
        );
        // 非法路径/mediaType。
        assert_eq!(
            begin(&registry, "../x", vec![declared("../x", "text/html", 1)]).unwrap_err(),
            WebpkgError::Invalid
        );
        assert_eq!(
            begin(
                &registry,
                "index.html",
                vec![declared("index.html", "TEXT/HTML", 1)]
            )
            .unwrap_err(),
            WebpkgError::Invalid
        );
        // 空表。
        assert_eq!(
            begin(&registry, "index.html", vec![]).unwrap_err(),
            WebpkgError::Invalid
        );
    }

    #[test]
    fn append_核对声明长度与投递状态() {
        let registry = WebPackageInstances::default();
        let begun = begin(
            &registry,
            "index.html",
            vec![
                declared("index.html", "text/html", 5),
                declared("app.js", "application/javascript", 3),
                declared("empty.bin", "application/octet-stream", 0),
            ],
        )
        .expect("begin");

        // 越过声明长度的块。
        assert_eq!(
            registry
                .append(&begun.instance_id, "app.js", 0, b"xxxx", Instant::now())
                .unwrap_err(),
            WebpkgError::ResourceMismatch
        );
        assert_eq!(
            registry
                .append(
                    &begun.instance_id,
                    "not-declared.css",
                    0,
                    b"x",
                    Instant::now()
                )
                .unwrap_err(),
            WebpkgError::ResourceUndeclared
        );
        assert_eq!(
            registry
                .append("wpk-999", "app.js", 0, b"xxx", Instant::now())
                .unwrap_err(),
            WebpkgError::InstanceMissing
        );
        // percent-encode 的路径解码后命中声明。
        registry
            .append(
                &begun.instance_id,
                "index.html",
                0,
                b"hello",
                Instant::now(),
            )
            .expect("append entry");
        assert_eq!(
            registry
                .append(
                    &begun.instance_id,
                    "index.html",
                    0,
                    b"hello",
                    Instant::now()
                )
                .unwrap_err(),
            WebpkgError::ResourceDuplicate
        );
        // 零长文件：一次空块 append 即完成，再投按 duplicate 拒。
        registry
            .append(&begun.instance_id, "empty.bin", 0, b"", Instant::now())
            .expect("append empty");
        assert_eq!(
            registry
                .append(&begun.instance_id, "empty.bin", 0, b"", Instant::now())
                .unwrap_err(),
            WebpkgError::ResourceDuplicate
        );
    }

    #[test]
    fn append_分块按偏移连续验收() {
        let registry = WebPackageInstances::default();
        let begun = begin(
            &registry,
            "index.html",
            vec![
                declared("index.html", "text/html", 1),
                declared("video.mp4", "video/mp4", 10),
            ],
        )
        .expect("begin");

        // 偏移必须从 0 起。
        assert_eq!(
            registry
                .append(&begun.instance_id, "video.mp4", 1, b"x", Instant::now())
                .unwrap_err(),
            WebpkgError::ResourceMismatch
        );
        // 单块超过 MAX_APPEND_CHUNK_BYTES 直接拒——协议预算，不是实例预算。
        let oversized = vec![0u8; (MAX_APPEND_CHUNK_BYTES + 1) as usize];
        assert_eq!(
            registry
                .append(
                    &begun.instance_id,
                    "video.mp4",
                    0,
                    &oversized,
                    Instant::now()
                )
                .unwrap_err(),
            WebpkgError::TooLarge
        );
        let outcome = registry
            .append(&begun.instance_id, "video.mp4", 0, b"0123", Instant::now())
            .expect("chunk 0");
        assert_eq!(outcome.received_byte_length, 4);
        // 乱序/重叠/跳跃都是 mismatch——offset 必须恰好接上已收长度。
        for bad_offset in [0u64, 3, 5] {
            assert_eq!(
                registry
                    .append(
                        &begun.instance_id,
                        "video.mp4",
                        bad_offset,
                        b"xy",
                        Instant::now()
                    )
                    .unwrap_err(),
                WebpkgError::ResourceMismatch,
                "offset {bad_offset} must be rejected"
            );
        }
        // 偏移正确但末端越界。
        assert_eq!(
            registry
                .append(
                    &begun.instance_id,
                    "video.mp4",
                    4,
                    b"456789a",
                    Instant::now()
                )
                .unwrap_err(),
            WebpkgError::ResourceMismatch
        );
        let outcome = registry
            .append(
                &begun.instance_id,
                "video.mp4",
                4,
                b"456789",
                Instant::now(),
            )
            .expect("chunk 1");
        assert_eq!(outcome.received_byte_length, 10);
        // 收满之后再投一律 duplicate。
        assert_eq!(
            registry
                .append(&begun.instance_id, "video.mp4", 10, b"", Instant::now())
                .unwrap_err(),
            WebpkgError::ResourceDuplicate
        );
    }

    #[test]
    fn collecting_会话超时按_stale_回收() {
        let registry = WebPackageInstances::default();
        let t0 = Instant::now();
        let begun = registry
            .begin(
                "index.html",
                "t",
                vec![declared("index.html", "text/html", 1)],
                t0,
            )
            .expect("begin");
        let after_ttl = t0 + COLLECT_TTL + Duration::from_secs(1);
        // TTL 一过，目标会话报 stale 并当场回收——与"从未存在"的 missing 区分开。
        assert_eq!(
            registry
                .append(&begun.instance_id, "index.html", 0, b"x", after_ttl)
                .unwrap_err(),
            WebpkgError::InstanceStale
        );
        // 回收已经发生：第二次再问就是 missing，stale 不重复播报。
        assert_eq!(
            registry
                .append(&begun.instance_id, "index.html", 0, b"x", after_ttl)
                .unwrap_err(),
            WebpkgError::InstanceMissing
        );
    }

    #[test]
    fn resolver_只在_label_instance_钉定成立时服务() {
        let registry = WebPackageInstances::default();
        let begun = begin(
            &registry,
            "index.html",
            vec![
                declared("index.html", "text/html", 5),
                declared("app.js", "application/javascript", 3),
            ],
        )
        .expect("begin");
        registry
            .append(
                &begun.instance_id,
                "index.html",
                0,
                b"hello",
                Instant::now(),
            )
            .expect("append");
        registry
            .append(&begun.instance_id, "app.js", 0, b"let", Instant::now())
            .expect("append");

        promote_to_open(&registry, &begun.instance_id, OpenPhase::Serving);
        let label = label_for_instance(&begun.instance_id);
        let ok = |path: &str| resolve_webpkg_request(&registry, &label, &request(path, None));

        let response = ok(&format!(
            "{INSTANCE_URL_PREFIX}{}/index.html",
            begun.instance_id
        ));
        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(
            response.headers().get("content-security-policy").unwrap(),
            HTML_SANDBOX_CSP
        );
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .unwrap(),
            "*"
        );
        assert_eq!(response.body().as_ref(), b"hello");

        let js = ok(&format!(
            "{INSTANCE_URL_PREFIX}{}/app.js",
            begun.instance_id
        ));
        assert_eq!(js.status(), http::StatusCode::OK);
        assert!(js.headers().get("content-security-policy").is_none());
        assert_eq!(
            js.headers().get("content-type").unwrap(),
            "application/javascript; charset=utf-8"
        );
    }

    #[test]
    fn resolver_对非_webpkg_label_未知_instance_与非法路径一律_404() {
        let registry = WebPackageInstances::default();
        let begun = begin(
            &registry,
            "index.html",
            vec![declared("index.html", "text/html", 5)],
        )
        .expect("begin");
        registry
            .append(
                &begun.instance_id,
                "index.html",
                0,
                b"hello",
                Instant::now(),
            )
            .expect("append");
        promote_to_open(&registry, &begun.instance_id, OpenPhase::Serving);
        let label = label_for_instance(&begun.instance_id);
        let url_path = format!("{INSTANCE_URL_PREFIX}{}/index.html", begun.instance_id);

        for (case_label, case_path) in [
            // main-ui 也拿不到——label 钉定不认"发起方是不是可信 UI"。
            ("main-ui", url_path.as_str()),
            ("webpkg-wpk-999", url_path.as_str()),
            // 请求方 label 与 URL instance 不一致。
            (
                label.as_str(),
                "/__web-package__/instance/wpk-999/index.html",
            ),
            // 未声明文件、穿越、非法编码、非 instance 命名空间。
            (
                label.as_str(),
                &format!("{INSTANCE_URL_PREFIX}{}/missing.js", begun.instance_id),
            ),
            (
                label.as_str(),
                &format!("{INSTANCE_URL_PREFIX}{}/../index.html", begun.instance_id),
            ),
            (
                label.as_str(),
                &format!("{INSTANCE_URL_PREFIX}{}/%2e%2e/x", begun.instance_id),
            ),
            (label.as_str(), "/index.html"),
            (label.as_str(), "/__web-package__/sw.js"),
        ] {
            let response = resolve_webpkg_request(&registry, case_label, &request(case_path, None));
            assert_eq!(
                response.status(),
                http::StatusCode::NOT_FOUND,
                "{case_label} {case_path} must 404"
            );
            assert_eq!(
                response.headers().get("x-content-type-options").unwrap(),
                "nosniff"
            );
            assert_eq!(
                response
                    .headers()
                    .get("access-control-allow-origin")
                    .unwrap(),
                "*"
            );
        }
    }

    #[test]
    fn resolver_在_opening_阶段已经服务() {
        // 初始页面可能在 `.build()` 返回前发出资源请求——若 Opening 不可服务，
        // 每个包的首个文档请求都会撞 404。
        let registry = WebPackageInstances::default();
        let begun = begin(
            &registry,
            "index.html",
            vec![declared("index.html", "text/html", 5)],
        )
        .expect("begin");
        registry
            .append(
                &begun.instance_id,
                "index.html",
                0,
                b"hello",
                Instant::now(),
            )
            .expect("append");
        promote_to_open(&registry, &begun.instance_id, OpenPhase::Opening);
        let label = label_for_instance(&begun.instance_id);
        let response = resolve_webpkg_request(
            &registry,
            &label,
            &request(
                &format!("{INSTANCE_URL_PREFIX}{}/index.html", begun.instance_id),
                None,
            ),
        );
        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(response.body().as_ref(), b"hello");
    }

    #[test]
    fn resolver_支持单段_range_并按帧截断() {
        let registry = WebPackageInstances::default();
        let total = MAX_RESPONSE_BYTES + 100;
        let begun = begin(
            &registry,
            "index.html",
            vec![
                declared("index.html", "text/html", 1),
                declared("video.mp4", "video/mp4", total),
            ],
        )
        .expect("begin");
        registry
            .append(&begun.instance_id, "index.html", 0, b"x", Instant::now())
            .expect("append");
        // 分块送达一份超过单帧上限的资源。
        let video: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        for chunk in video.chunks(MAX_APPEND_CHUNK_BYTES as usize) {
            let offset = registry
                .inner
                .lock()
                .ok()
                .and_then(|inner| match inner.instances.get(&begun.instance_id) {
                    Some(InstanceState::Collecting { received, .. }) => {
                        received.get("video.mp4").map(|f| f.bytes.len() as u64)
                    }
                    _ => None,
                })
                .unwrap_or(0);
            registry
                .append(
                    &begun.instance_id,
                    "video.mp4",
                    offset,
                    chunk,
                    Instant::now(),
                )
                .expect("append chunk");
        }
        promote_to_open(&registry, &begun.instance_id, OpenPhase::Serving);
        let label = label_for_instance(&begun.instance_id);
        let path = format!("{INSTANCE_URL_PREFIX}{}/video.mp4", begun.instance_id);

        // 无 Range：200 全量 + Accept-Ranges 广告。
        let full = resolve_webpkg_request(&registry, &label, &request(&path, None));
        assert_eq!(full.status(), http::StatusCode::OK);
        assert_eq!(full.body().len() as u64, total);
        assert_eq!(full.headers().get("accept-ranges").unwrap(), "bytes");
        assert_eq!(
            full.headers().get("content-length").unwrap(),
            &total.to_string()
        );

        // 单段 Range：206 + Content-Range；请求段超过单帧上限时截断。
        let ranged = resolve_webpkg_request(&registry, &label, &request(&path, Some("bytes=0-")));
        assert_eq!(ranged.status(), http::StatusCode::PARTIAL_CONTENT);
        assert_eq!(ranged.body().len() as u64, MAX_RESPONSE_BYTES);
        assert_eq!(
            ranged.headers().get("content-range").unwrap(),
            &format!("bytes 0-{}/{}", MAX_RESPONSE_BYTES - 1, total)
        );
        assert_eq!(&ranged.body()[..], &video[..MAX_RESPONSE_BYTES as usize]);

        // 中段区间与后缀区间。
        let mid = resolve_webpkg_request(&registry, &label, &request(&path, Some("bytes=4-7")));
        assert_eq!(mid.status(), http::StatusCode::PARTIAL_CONTENT);
        assert_eq!(mid.body().as_ref(), &video[4..=7]);
        assert_eq!(
            mid.headers().get("content-range").unwrap(),
            &format!("bytes 4-7/{total}")
        );
        let suffix = resolve_webpkg_request(&registry, &label, &request(&path, Some("bytes=-10")));
        assert_eq!(suffix.status(), http::StatusCode::PARTIAL_CONTENT);
        assert_eq!(suffix.body().as_ref(), &video[total as usize - 10..]);

        // 不可满足 / 多段 / 畸形：416 + `bytes */total`。
        for bad_range in [
            &*format!("bytes={}-", total + 10),
            "bytes=0-1,4-5",
            "items=0-1",
            "bytes=abc",
        ] {
            let response =
                resolve_webpkg_request(&registry, &label, &request(&path, Some(bad_range)));
            assert_eq!(
                response.status(),
                http::StatusCode::RANGE_NOT_SATISFIABLE,
                "range {bad_range:?} must be 416"
            );
            assert_eq!(
                response.headers().get("content-range").unwrap(),
                &format!("bytes */{total}")
            );
        }
    }
}
