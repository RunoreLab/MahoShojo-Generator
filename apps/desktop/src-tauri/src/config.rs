//! 人工配置 `config.json` 的 native 读写（D5.1-S2，`DESK-SET-004`..`006`）。
//!
//! renderer 与手工编辑共享同一份**文件**，但分工刻意不对称：
//!
//! - **这里（native）**：路径固定为应用配置目录下的 `config.json`；读取有界
//!   （`MAX_CONFIG_FILE_BYTES`，内容只在确认不越界时驻留内存，revision 的
//!   SHA-256 分块流式计算）；写入串行化，`expectedRevision` 基于内容
//!   sha256 复核，冲突返回 `config-conflict` 而不是覆盖；落盘走同目录临时
//!   文件 → sync → 原子 replace（正常替换路径目标全程存在旧版或新版之一）。
//!   `config.json.bak` 只保留**上一个有效文件**；被替换掉的不可读文件先隔离为
//!   `config.json.invalid` 供手工打捞，不顶替真正的恢复路径——该显式恢复
//!   先把原始字节挪走，窗口内主路径可能短暂缺失但字节不丢，落位同样
//!   no-clobber，隔离期间外部重建的 `config.json` 不会被覆盖
//!   （`DESK-SET-005`）。命令面只有读/写/打开目录三条——renderer 拿不到
//!   任意文件接口。
//! - **域语义不在此**：字段登记、默认值、非法值降级与诊断定位由
//!   `contracts/desktop-config` 的 TS schema 承担（UI 与手工修改同一解析）。
//!   这里只做信封级检查：UTF-8 JSON 对象 + `version == 1`——防止把一份
//!   自己读不回的文件写进配置目录。
//!
//! 日志/错误信息不携带文件内容：用户误填的 secret 不应借诊断面泄漏
//! （`DESK-SET-004` 末段）。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 配置文件名——位于应用配置目录，路径完全由 native 决定。
const CONFIG_FILE_NAME: &str = "config.json";
/// 上一个有效文件的恢复路径（`DESK-SET-005`「上次有效文件的恢复路径」）。
const CONFIG_BACKUP_FILE_NAME: &str = "config.json.bak";
/// 被显式覆盖的不可读文件隔离位——保留用户字节供手工打捞，但不占用 `.bak`
/// 的「last known valid」语义。
const CONFIG_INVALID_FILE_NAME: &str = "config.json.invalid";
/// 与 `desktop-ipc` 契约 `MAX_DESKTOP_CONFIG_FILE_BYTES` 一致。
const MAX_CONFIG_FILE_BYTES: u64 = 64 * 1024;
/// 与 `desktop-config` 域 `DESKTOP_CONFIG_FILE_VERSION` 一致——信封级检查，
/// 不是字段语义的复制。
const CONFIG_FILE_VERSION: u64 = 1;
/// 流式读/revision 的分块大小——任何大小的文件都不整体进内存。
const READ_CHUNK_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConfigErrorCode {
    StorageUnavailable,
    ConfigConflict,
    InvalidContent,
    OpenFailed,
    InternalError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigError {
    pub code: ConfigErrorCode,
    pub message: String,
}

impl ConfigError {
    pub(crate) fn new(code: ConfigErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn storage(context: &str, error: &std::io::Error) -> Self {
        Self::new(
            ConfigErrorCode::StorageUnavailable,
            format!("{context}：{error}"),
        )
    }

    /// `app.path().app_config_dir()` 解析失败（非 io::Error，单独一个入口）。
    pub fn storage_dir_resolution_failure(error: impl std::fmt::Display) -> Self {
        Self::new(
            ConfigErrorCode::StorageUnavailable,
            format!("无法解析应用配置目录：{error}"),
        )
    }
}

/// `desktop_config_read` 的文件状态。存在但不可作为编辑基底的形态同样给出
/// revision——显式「恢复默认」要携带真实的 `expectedRevision` 才能覆盖，
/// 而不是拿「文件坏了」当放行牌。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ConfigFileState {
    Missing,
    #[serde(rename_all = "camelCase")]
    Ok {
        revision: String,
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    Oversized {
        revision: String,
        bytes: u64,
    },
    #[serde(rename_all = "camelCase")]
    InvalidUtf8 {
        revision: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReadResult {
    /// `config.json` 的绝对路径与所在目录——只由 native 回显，设置页展示用。
    pub path: String,
    pub directory: String,
    pub backup_present: bool,
    pub file: ConfigFileState,
}

/// `desktop_config_write` 的请求。`expected_revision: None` 表示「文件必须
/// 仍不存在」——读到 missing 后的首写只允许创建。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigWriteRequest {
    pub expected_revision: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWriteResult {
    pub revision: String,
}

/// 进程内写串行化。revision 复核与原子替换必须在同一把锁里完成，否则两个
/// 并发写各自通过了复核仍然互相覆盖。
#[derive(Default)]
pub struct ConfigState {
    lock: Mutex<()>,
}

impl ConfigFileState {
    /// 当前文件的内容 revision；`Missing` 没有 revision。
    fn revision(&self) -> Option<&str> {
        match self {
            ConfigFileState::Missing => None,
            ConfigFileState::Ok { revision, .. }
            | ConfigFileState::Oversized { revision, .. }
            | ConfigFileState::InvalidUtf8 { revision } => Some(revision),
        }
    }
}

fn config_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_FILE_NAME)
}

fn backup_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_BACKUP_FILE_NAME)
}

fn invalid_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_INVALID_FILE_NAME)
}

fn sha256_hex_digest(hasher: Sha256) -> String {
    let mut hex = String::with_capacity(64);
    for byte in hasher.finalize() {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("sha256:{hex}")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    sha256_hex_digest(hasher)
}

/// 单次遍历的产物：分块流式 SHA-256 + 有界前缀字节。
/// `prefix` 只在总字节数不越界时等于完整内容——越界后停止累积，
/// 文件再大也只有一个栈缓冲 + 至多 64 KiB 的前缀驻留内存。
struct ScannedBytes {
    total: u64,
    prefix: Vec<u8>,
    revision: String,
}

fn scan_bytes(mut reader: impl Read) -> Result<ScannedBytes, std::io::Error> {
    let mut hasher = Sha256::new();
    let mut prefix = Vec::new();
    let mut total: u64 = 0;
    let mut buffer = [0u8; READ_CHUNK_BYTES];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total += read as u64;
        if total <= MAX_CONFIG_FILE_BYTES {
            prefix.extend_from_slice(&buffer[..read]);
        }
    }
    Ok(ScannedBytes {
        total,
        prefix,
        revision: sha256_hex_digest(hasher),
    })
}

/// 真正先验的有界读：`File::open` 后分块扫描——打开失败只有 `NotFound`
/// 算 `Missing`；文件在打开后被外部拉大也逃不出上限（上限按实际读到的
/// 字节数收口，不信 `metadata` 的快照）。
fn read_file_state(target: &Path) -> Result<ConfigFileState, ConfigError> {
    let file = match fs::File::open(target) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ConfigFileState::Missing);
        }
        Err(error) => return Err(ConfigError::storage("读取配置文件失败", &error)),
    };
    let scanned =
        scan_bytes(file).map_err(|error| ConfigError::storage("读取配置文件失败", &error))?;
    if scanned.total > MAX_CONFIG_FILE_BYTES {
        return Ok(ConfigFileState::Oversized {
            revision: scanned.revision,
            bytes: scanned.total,
        });
    }
    match String::from_utf8(scanned.prefix) {
        Ok(content) => Ok(ConfigFileState::Ok {
            revision: scanned.revision,
            content,
        }),
        Err(_) => Ok(ConfigFileState::InvalidUtf8 {
            revision: scanned.revision,
        }),
    }
}

/// 「这份内容能否作为 `.bak`（last known valid）」的布尔判定——与写入的
/// 信封口径一致：有界 JSON 对象 + `version == 1`。`Ok` 状态只保证有界
/// UTF-8，`{broken`、`{"version":2}` 这类文件不满足，不能被备份成
/// 「上次有效文件」。
fn envelope_satisfied(content: &str) -> bool {
    if content.len() as u64 > MAX_CONFIG_FILE_BYTES {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return false;
    };
    value
        .as_object()
        .map(|object| object.get("version") == Some(&serde_json::json!(CONFIG_FILE_VERSION)))
        .unwrap_or(false)
}

/// 信封级检查：有界字节 + UTF-8 JSON 对象 + `version == 1`。
/// 字段级域语义归 `contracts/desktop-config`——这里不复读它的规则。
fn validate_envelope(content: &str) -> Result<(), ConfigError> {
    if content.len() as u64 > MAX_CONFIG_FILE_BYTES {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidContent,
            "配置内容超出大小上限",
        ));
    }
    if serde_json::from_str::<serde_json::Value>(content).is_err() {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidContent,
            "配置内容不是合法 JSON",
        ));
    }
    if !envelope_satisfied(content) {
        return Err(ConfigError::new(
            ConfigErrorCode::InvalidContent,
            format!("配置内容必须是顶层带 version: {CONFIG_FILE_VERSION} 的 JSON 对象"),
        ));
    }
    Ok(())
}

/// `desktop_config_read`：固定路径的有界读取。`Missing` 不是一种错误——
/// 缺文件用内置默认是正常形态（`DESK-SET-004`）。
pub fn read_config(dir: &Path, state: &ConfigState) -> Result<ConfigReadResult, ConfigError> {
    // 与写同一把锁：主路径的 persist 是原子替换，但「无效文件挪 .invalid
    // 再落位」之间目标会短暂缺失——进程内的读不落在那个窗口上。
    let _guard = state
        .lock
        .lock()
        .map_err(|_| ConfigError::new(ConfigErrorCode::InternalError, "配置锁已损坏"))?;
    let target = config_path(dir);
    Ok(ConfigReadResult {
        path: target.to_string_lossy().into_owned(),
        directory: dir.to_string_lossy().into_owned(),
        backup_present: backup_path(dir).is_file(),
        file: read_file_state(&target)?,
    })
}

/// 同目录临时文件 + `sync` + `persist` 的原子替换。`persist` 在 Windows 走
/// `MoveFileExW|REPLACE_EXISTING`、在 Unix 走 `rename(2)`——目标路径全程
/// 存在旧版或新版之一，没有「先挪走旧文件」的缺失窗口。
fn persist_atomically(
    temp: tempfile::NamedTempFile,
    target: &Path,
    context: &str,
) -> Result<(), ConfigError> {
    temp.persist(target).map_err(|persist| {
        ConfigError::new(
            ConfigErrorCode::StorageUnavailable,
            format!("{context}：{}", persist.error),
        )
    })?;
    Ok(())
}

/// 同一条原子落位路径的 no-clobber 变体：目标必须仍不存在。`AlreadyExists`
/// 说明磁盘在复核之后被外部写者推进——与 revision 复核同一语义，按
/// `config-conflict` 交还给 UI 重载，而不是静默覆盖外部新版本。
fn persist_new_atomically(
    temp: tempfile::NamedTempFile,
    target: &Path,
    context: &str,
) -> Result<(), ConfigError> {
    temp.persist_noclobber(target).map_err(|persist| {
        if persist.error.kind() == std::io::ErrorKind::AlreadyExists {
            ConfigError::new(
                ConfigErrorCode::ConfigConflict,
                "配置文件已被外部修改；请重新加载后重试",
            )
        } else {
            ConfigError::new(
                ConfigErrorCode::StorageUnavailable,
                format!("{context}：{}", persist.error),
            )
        }
    })?;
    Ok(())
}

/// 把 `bytes` 经同一条 temp+sync+persist 原子路径写到 `target`（`.bak` 用）。
fn write_file_atomically(target: &Path, bytes: &[u8]) -> Result<(), ConfigError> {
    let dir = target
        .parent()
        .ok_or_else(|| ConfigError::new(ConfigErrorCode::InternalError, "配置路径没有父目录"))?;
    let mut temp = tempfile::NamedTempFile::new_in(dir)
        .map_err(|error| ConfigError::storage("创建配置备份临时文件失败", &error))?;
    temp.write_all(bytes)
        .map_err(|error| ConfigError::storage("写入配置备份失败", &error))?;
    temp.as_file()
        .sync_all()
        .map_err(|error| ConfigError::storage("同步配置备份失败", &error))?;
    persist_atomically(temp, target, "备份既有配置失败")
}

/// 无效文件已隔离到 `invalid` 之后把新内容落位到 `target`。
///
/// 隔离窗口里外部写者可能已重建 `config.json`——落位必须 no-clobber：
/// `AlreadyExists` 说明磁盘已前进，外部新版本与隔离的原始字节都保留，
/// 按 `config-conflict` 交还（绝不在此把 `.invalid` 盖回主路径）；其余
/// 存储失败且 target 仍缺失时，才把 `.invalid` 尽量挪回——字节不丢。
fn place_after_quarantine(
    temp: tempfile::NamedTempFile,
    target: &Path,
    invalid: &Path,
) -> Result<(), ConfigError> {
    match temp.persist_noclobber(target) {
        Ok(_) => Ok(()),
        Err(persist) if persist.error.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(ConfigError::new(
                ConfigErrorCode::ConfigConflict,
                "配置文件已被外部修改；请重新加载后重试",
            ))
        }
        Err(persist) => {
            let _ = fs::rename(invalid, target);
            Err(ConfigError::new(
                ConfigErrorCode::StorageUnavailable,
                format!("配置落盘失败：{}", persist.error),
            ))
        }
    }
}

/// `desktop_config_write`：复核 revision 后的原子替换。
///
/// 顺序是「临时文件写完 sync → 按当前文件形态分流 → `persist` 原子落位」：
///
/// - 文件缺失 → `persist_noclobber` 原子创建，`expectedRevision: null`
///   的「必须仍不存在」靠 no-clobber 语义闭合，不靠 check-then-create；
/// - 当前文件过同一信封检查 → 先原子把它写成 `.bak`（last known valid），
///   再替换目标；
/// - 当前文件不可作为有效文件（fatal/invalid-utf8/oversized）→ 挪到
///   `.invalid` 隔离位保留用户字节，绝不顶替 `.bak`。
///
/// 崩溃语义：正常替换是 `persist` 单步 old-or-new——进程崩溃不会留下
/// 半写的主文件；坏文件显式恢复先把原始字节隔离到 `.invalid`，该窗口
/// 主路径可能短暂缺失但原始字节不丢。临时文件已 `sync_all`，但未做
/// 父目录 fsync——不宣称对突然掉电具备完整 durable transaction 保证。
pub fn write_config(
    dir: &Path,
    state: &ConfigState,
    request: ConfigWriteRequest,
) -> Result<ConfigWriteResult, ConfigError> {
    validate_envelope(&request.content)?;

    let _guard = state
        .lock
        .lock()
        .map_err(|_| ConfigError::new(ConfigErrorCode::InternalError, "配置锁已损坏"))?;

    let target = config_path(dir);
    let backup = backup_path(dir);

    // 替换前复核：renderer 声称「我基于这份内容修改」。复核读同一条有界
    // 流式路径——超大文件也只是一次流式扫描，不进内存。
    let current = read_file_state(&target)?;
    if current.revision() != request.expected_revision.as_deref() {
        return Err(ConfigError::new(
            ConfigErrorCode::ConfigConflict,
            "配置文件已被外部修改；请重新加载后重试",
        ));
    }

    fs::create_dir_all(dir).map_err(|error| ConfigError::storage("创建配置目录失败", &error))?;

    // 新内容先完整落到同目录临时文件——这之后的任何失败都还没碰目标文件。
    let mut temp = tempfile::NamedTempFile::new_in(dir)
        .map_err(|error| ConfigError::storage("创建配置临时文件失败", &error))?;
    temp.write_all(request.content.as_bytes())
        .map_err(|error| ConfigError::storage("写入配置临时文件失败", &error))?;
    temp.as_file()
        .sync_all()
        .map_err(|error| ConfigError::storage("同步配置临时文件失败", &error))?;

    match &current {
        ConfigFileState::Missing => {
            // check-then-create 的窗口由 no-clobber 原子语义闭合：期间被
            // 外部建出的文件按冲突交还，而不是被静默覆盖。
            persist_new_atomically(temp, &target, "配置落盘失败")?;
        }
        ConfigFileState::Ok { content, .. } if envelope_satisfied(content) => {
            // `.bak` = last known valid：先原子更新备份再替换目标。persist
            // 失败时 .bak 与目标同为旧内容，一致可回滚。
            write_file_atomically(&backup, content.as_bytes())?;
            persist_atomically(temp, &target, "配置落盘失败")?;
        }
        _ => {
            // 当前文件不可作为「上次有效」：挪去 `.invalid` 隔离位（rename
            // 是 O(1)，超大损坏文件也不复制），保留字节供手工打捞。此刻起
            // 目标缺失是短暂的——但它本来就不可读。
            // Windows 的 rename 不覆盖既有目标：先删掉旧隔离文件再挪。
            let invalid = invalid_path(dir);
            if invalid.exists() {
                fs::remove_file(&invalid)
                    .map_err(|error| ConfigError::storage("清理既有隔离文件失败", &error))?;
            }
            fs::rename(&target, &invalid)
                .map_err(|error| ConfigError::storage("隔离无效配置文件失败", &error))?;
            place_after_quarantine(temp, &target, &invalid)?;
        }
    }

    Ok(ConfigWriteResult {
        revision: sha256_hex(request.content.as_bytes()),
    })
}

/// `desktop_config_open_directory`：打开固定的配置目录（必要时先创建）。
/// 只暴露「打开这一个目录」，不开放任意路径。
pub fn open_directory(dir: &Path) -> Result<(), ConfigError> {
    fs::create_dir_all(dir).map_err(|error| ConfigError::storage("创建配置目录失败", &error))?;
    open::that(dir).map_err(|error| {
        ConfigError::new(
            ConfigErrorCode::OpenFailed,
            format!("打开配置目录失败：{error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> ConfigState {
        ConfigState::default()
    }

    fn write(
        dir: &Path,
        expected: Option<String>,
        content: &str,
    ) -> Result<ConfigWriteResult, ConfigError> {
        write_config(
            dir,
            &ConfigState::default(),
            ConfigWriteRequest {
                expected_revision: expected,
                content: content.to_string(),
            },
        )
    }

    #[test]
    fn missing_file_reads_as_missing() {
        let dir = tempfile::tempdir().unwrap();
        let result = read_config(dir.path(), &state()).unwrap();
        assert!(matches!(result.file, ConfigFileState::Missing));
        assert!(result.path.ends_with(CONFIG_FILE_NAME));
        assert!(!result.backup_present);
    }

    #[test]
    fn write_then_read_roundtrips_with_content_revision() {
        let dir = tempfile::tempdir().unwrap();
        let content = "{\"version\":1,\"announcements\":{\"checkPolicy\":\"manual\"}}";
        let written = write(dir.path(), None, content).unwrap();
        assert_eq!(written.revision, sha256_hex(content.as_bytes()));

        let result = read_config(dir.path(), &state()).unwrap();
        match result.file {
            ConfigFileState::Ok {
                revision,
                content: read,
            } => {
                assert_eq!(revision, written.revision);
                assert_eq!(read, content);
            }
            other => panic!("expected ok file, got {other:?}"),
        }
    }

    #[test]
    fn write_conflicts_when_disk_moved_since_read() {
        let dir = tempfile::tempdir().unwrap();
        let first = write(dir.path(), None, "{\"version\":1}").unwrap();
        // 基于 first.revision 的写者 A 与外部写者 B：B 先落盘，A 必须冲突，
        // 旧内容（B 的）不能被 A 静默覆盖。
        write(
            dir.path(),
            Some(first.revision.clone()),
            "{\"version\":1,\"x\":2}",
        )
        .unwrap();
        let stale = write(dir.path(), Some(first.revision), "{\"version\":1,\"x\":3}").unwrap_err();
        assert_eq!(stale.code, ConfigErrorCode::ConfigConflict);
        assert_eq!(
            fs::read_to_string(config_path(dir.path())).unwrap(),
            "{\"version\":1,\"x\":2}"
        );
    }

    #[test]
    fn missing_then_externally_created_conflicts_instead_of_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(config_path(dir.path()), "{\"version\":1,\"hand\":true}").unwrap();
        let error = write(dir.path(), None, "{\"version\":1}").unwrap_err();
        assert_eq!(error.code, ConfigErrorCode::ConfigConflict);
        assert!(fs::read_to_string(config_path(dir.path()))
            .unwrap()
            .contains("\"hand\""));
    }

    #[test]
    fn replaces_previous_file_and_keeps_bak() {
        let dir = tempfile::tempdir().unwrap();
        let first = write(dir.path(), None, "{\"version\":1}").unwrap();
        write(dir.path(), Some(first.revision), "{\"version\":1,\"x\":9}").unwrap();

        assert_eq!(
            fs::read_to_string(backup_path(dir.path())).unwrap(),
            "{\"version\":1}"
        );
        assert_eq!(
            fs::read_to_string(config_path(dir.path())).unwrap(),
            "{\"version\":1,\"x\":9}"
        );
        assert!(read_config(dir.path(), &state()).unwrap().backup_present);
    }

    #[test]
    fn replacing_a_broken_file_quarantines_it_instead_of_clobbering_valid_bak() {
        let dir = tempfile::tempdir().unwrap();
        let first = write(dir.path(), None, "{\"version\":1}").unwrap();
        let second = write(dir.path(), Some(first.revision), "{\"version\":1,\"x\":9}").unwrap();
        assert_eq!(
            fs::read_to_string(backup_path(dir.path())).unwrap(),
            "{\"version\":1}"
        );

        // 当前文件坏掉（合法 UTF-8 但不是信封）——基于旧 revision 的写先
        // 冲突；用真实 revision 显式恢复默认后，`.bak` 仍是上一个有效文件，
        // 坏文件隔离到 `.invalid` 供打捞。
        fs::write(config_path(dir.path()), "{broken").unwrap();
        let stale = write(
            dir.path(),
            Some(second.revision),
            "{\"version\":1,\"reset\":true}",
        )
        .unwrap_err();
        assert_eq!(stale.code, ConfigErrorCode::ConfigConflict);
        let broken_revision = match read_config(dir.path(), &state()).unwrap().file {
            ConfigFileState::Ok { revision, .. } => revision,
            other => panic!("expected ok-but-invalid file, got {other:?}"),
        };
        write(
            dir.path(),
            Some(broken_revision),
            "{\"version\":1,\"reset\":true}",
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(config_path(dir.path())).unwrap(),
            "{\"version\":1,\"reset\":true}"
        );
        assert_eq!(
            fs::read_to_string(backup_path(dir.path())).unwrap(),
            "{\"version\":1}"
        );
        assert_eq!(
            fs::read_to_string(invalid_path(dir.path())).unwrap(),
            "{broken"
        );

        // 再次被无效文件顶替时，隔离位也随之更新（Windows 语义：rename
        // 不覆盖目标，先清再挪——这里钉住的是行为而不是实现）。
        fs::write(config_path(dir.path()), "{\"version\":2}").unwrap();
        let future_revision = match read_config(dir.path(), &state()).unwrap().file {
            ConfigFileState::Ok { revision, .. } => revision,
            other => panic!("expected ok file, got {other:?}"),
        };
        write(dir.path(), Some(future_revision), "{\"version\":1}").unwrap();
        assert_eq!(
            fs::read_to_string(invalid_path(dir.path())).unwrap(),
            "{\"version\":2}"
        );
        assert_eq!(
            fs::read_to_string(backup_path(dir.path())).unwrap(),
            "{\"version\":1}"
        );
    }

    #[test]
    fn placing_after_quarantine_never_clobbers_an_externally_recreated_target() {
        let dir = tempfile::tempdir().unwrap();
        // 无效文件已挪去 `.invalid`，隔离窗口里外部写者重建了 config.json：
        // 落位必须按冲突让位——外部新版本不被覆盖，隔离的原始字节也不丢
        // （不在这里把 `.invalid` 盖回主路径）。
        fs::write(config_path(dir.path()), "{\"version\":1,\"external\":true}").unwrap();
        fs::write(invalid_path(dir.path()), "{broken").unwrap();
        let mut temp = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        temp.write_all(b"{\"version\":1,\"ours\":true}").unwrap();

        let error =
            place_after_quarantine(temp, &config_path(dir.path()), &invalid_path(dir.path()))
                .unwrap_err();

        assert_eq!(error.code, ConfigErrorCode::ConfigConflict);
        assert_eq!(
            fs::read_to_string(config_path(dir.path())).unwrap(),
            "{\"version\":1,\"external\":true}"
        );
        assert_eq!(
            fs::read_to_string(invalid_path(dir.path())).unwrap(),
            "{broken"
        );
    }

    #[test]
    fn placing_after_quarantine_lands_normally_when_target_stays_absent() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(invalid_path(dir.path()), "{broken").unwrap();
        let mut temp = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        temp.write_all(b"{\"version\":1}").unwrap();

        place_after_quarantine(temp, &config_path(dir.path()), &invalid_path(dir.path())).unwrap();

        assert_eq!(
            fs::read_to_string(config_path(dir.path())).unwrap(),
            "{\"version\":1}"
        );
        // 落位成功后隔离位保留——原始字节由用户手工处置，不被清掉。
        assert_eq!(
            fs::read_to_string(invalid_path(dir.path())).unwrap(),
            "{broken"
        );
    }

    #[test]
    fn scan_bytes_bounds_prefix_and_hashes_everything() {
        let payload = vec![b'x'; (MAX_CONFIG_FILE_BYTES * 3) as usize];
        let scanned = scan_bytes(std::io::Cursor::new(&payload)).unwrap();
        assert_eq!(scanned.total, MAX_CONFIG_FILE_BYTES * 3);
        // 前缀至多 64 KiB——文件再大也只驻留有界内容。
        assert_eq!(scanned.prefix.len() as u64, MAX_CONFIG_FILE_BYTES);
        assert_eq!(scanned.revision, sha256_hex(&payload));

        let small = b"{\"version\":1}".to_vec();
        let scanned = scan_bytes(std::io::Cursor::new(&small)).unwrap();
        assert_eq!(scanned.total, small.len() as u64);
        assert_eq!(scanned.prefix, small);
    }

    #[test]
    fn rejects_invalid_envelopes_without_touching_disk() {
        let dir = tempfile::tempdir().unwrap();
        for content in [
            "not json",
            "[]",
            "{\"version\":2}",
            "{\"x\":1}",
            &"x".repeat(MAX_CONFIG_FILE_BYTES as usize + 1),
        ] {
            let error = write(dir.path(), None, content).unwrap_err();
            assert_eq!(error.code, ConfigErrorCode::InvalidContent, "{content:?}");
            assert!(!config_path(dir.path()).exists());
        }
    }

    #[test]
    fn oversized_and_non_utf8_files_report_revision_for_explicit_reset() {
        let dir = tempfile::tempdir().unwrap();
        let oversized = vec![b'a'; (MAX_CONFIG_FILE_BYTES + 1) as usize];
        fs::write(config_path(dir.path()), &oversized).unwrap();
        match read_config(dir.path(), &state()).unwrap().file {
            ConfigFileState::Oversized { revision, bytes } => {
                assert_eq!(bytes, MAX_CONFIG_FILE_BYTES + 1);
                // 携带真实 revision 的显式恢复默认允许覆盖——不是凭空放行。
                write(dir.path(), Some(revision), "{\"version\":1}").unwrap();
            }
            other => panic!("expected oversized, got {other:?}"),
        }
        // 无效文件不是「上次有效」：隔离到 .invalid，不产生 .bak。
        assert_eq!(fs::read(invalid_path(dir.path())).unwrap(), oversized);
        assert!(!backup_path(dir.path()).exists());

        fs::write(config_path(dir.path()), [0xff, 0xfe, 0x00]).unwrap();
        match read_config(dir.path(), &state()).unwrap().file {
            ConfigFileState::InvalidUtf8 { revision } => {
                assert!(revision.starts_with("sha256:"));
            }
            other => panic!("expected invalid-utf8, got {other:?}"),
        }
    }
}
