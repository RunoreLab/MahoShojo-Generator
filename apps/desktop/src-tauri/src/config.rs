//! 人工配置 `config.json` 的 native 读写（D5.1-S2，`DESK-SET-004`..`006`）。
//!
//! renderer 与手工编辑共享同一份**文件**，但分工刻意不对称：
//!
//! - **这里（native）**：路径固定为应用配置目录下的 `config.json`；读取有界
//!   （`MAX_CONFIG_FILE_BYTES`）；写入串行化，`expectedRevision` 基于内容
//!   sha256 复核，冲突返回 `config-conflict` 而不是覆盖；落盘走同目录临时
//!   文件 → sync → rename，替换前把上一份文件挪为 `config.json.bak` 作为
//!   恢复路径（`DESK-SET-005`）。命令面只有读/写/打开目录三条——renderer
//!   拿不到任意文件接口。
//! - **域语义不在此**：字段登记、默认值、非法值降级与诊断定位由
//!   `contracts/desktop-config` 的 TS schema 承担（UI 与手工修改同一解析）。
//!   这里只做信封级检查：UTF-8 JSON 对象 + `version == 1`——防止把一份
//!   自己读不回的文件写进配置目录。
//!
//! 日志/错误信息不携带文件内容：用户误填的 secret 不应借诊断面泄漏
//! （`DESK-SET-004` 末段）。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 配置文件名——位于应用配置目录，路径完全由 native 决定。
const CONFIG_FILE_NAME: &str = "config.json";
/// 上次落盘内容的恢复路径（`DESK-SET-005`「上次有效文件的恢复路径」）。
const CONFIG_BACKUP_FILE_NAME: &str = "config.json.bak";
/// 与 `desktop-ipc` 契约 `MAX_DESKTOP_CONFIG_FILE_BYTES` 一致。
const MAX_CONFIG_FILE_BYTES: u64 = 64 * 1024;
/// 与 `desktop-config` 域 `DESKTOP_CONFIG_FILE_VERSION` 一致——信封级检查，
/// 不是字段语义的复制。
const CONFIG_FILE_VERSION: u64 = 1;

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
    fn new(code: ConfigErrorCode, message: impl Into<String>) -> Self {
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

fn config_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_FILE_NAME)
}

fn backup_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_BACKUP_FILE_NAME)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("sha256:{hex}")
}

fn read_file_state(target: &Path) -> Result<ConfigFileState, ConfigError> {
    let bytes = match fs::read(target) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ConfigFileState::Missing);
        }
        Err(error) => return Err(ConfigError::storage("读取配置文件失败", &error)),
    };
    let revision = sha256_hex(&bytes);
    if bytes.len() as u64 > MAX_CONFIG_FILE_BYTES {
        return Ok(ConfigFileState::Oversized {
            revision,
            bytes: bytes.len() as u64,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(ConfigFileState::Ok { revision, content }),
        Err(_) => Ok(ConfigFileState::InvalidUtf8 { revision }),
    }
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
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|_| ConfigError::new(ConfigErrorCode::InvalidContent, "配置内容不是合法 JSON"))?;
    let is_valid = value
        .as_object()
        .map(|object| object.get("version") == Some(&serde_json::json!(CONFIG_FILE_VERSION)))
        .unwrap_or(false);
    if !is_valid {
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
    // 与写同一把锁：读不能落在「旧文件已挪走、新文件未落位」的中间态上。
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

/// `desktop_config_write`：复核 revision 后的原子替换。
///
/// 顺序是「临时文件写完 sync → 旧文件挪 .bak → rename 落位」：崩溃窗口里
/// `config.json` 最坏是缺失，`.bak` 仍握着上一份内容——恢复路径永远不依赖
/// 「写了一半的目标文件」。
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

    // 替换前复核：renderer 声称「我基于这份内容修改」。落盘内容与声明不符
    // （手工编辑过、另一个写者先落了）→ 冲突，保留双方，由 UI 提示重载。
    let current_revision = match fs::read(&target) {
        Ok(bytes) => Some(sha256_hex(&bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(ConfigError::storage("读取配置文件失败", &error)),
    };
    if current_revision != request.expected_revision {
        return Err(ConfigError::new(
            ConfigErrorCode::ConfigConflict,
            "配置文件已被外部修改；请重新加载后重试",
        ));
    }

    fs::create_dir_all(dir).map_err(|error| ConfigError::storage("创建配置目录失败", &error))?;

    let mut temp = tempfile::NamedTempFile::new_in(dir)
        .map_err(|error| ConfigError::storage("创建配置临时文件失败", &error))?;
    temp.write_all(request.content.as_bytes())
        .map_err(|error| ConfigError::storage("写入配置临时文件失败", &error))?;
    temp.as_file()
        .sync_all()
        .map_err(|error| ConfigError::storage("同步配置临时文件失败", &error))?;

    // 旧文件先让位给 .bak（覆盖旧 bak）。此刻起目标缺失是短暂的，
    // persist 失败会尽量把它挪回来。
    if target.exists() {
        fs::rename(&target, &backup)
            .map_err(|error| ConfigError::storage("备份既有配置失败", &error))?;
    }
    let persist_result = temp.persist(&target);
    if let Err(error) = persist_result {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        return Err(ConfigError::new(
            ConfigErrorCode::StorageUnavailable,
            format!("配置落盘失败：{}", error.error),
        ));
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

        fs::write(config_path(dir.path()), &[0xff, 0xfe, 0x00]).unwrap();
        match read_config(dir.path(), &state()).unwrap().file {
            ConfigFileState::InvalidUtf8 { revision } => {
                assert!(revision.starts_with("sha256:"));
            }
            other => panic!("expected invalid-utf8, got {other:?}"),
        }
    }
}
