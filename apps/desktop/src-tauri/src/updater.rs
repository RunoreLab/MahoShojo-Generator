//! Official updater behind three application-owned commands. Renderer supplies no
//! URL, filesystem path, public key or plugin resource ID.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{ipc::Channel, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio_util::sync::CancellationToken;

use crate::{ai::RequestRegistry, arena_hosted::ArenaState, library::LocalLibrary};

const ENDPOINT: &str = "https://mahoshojo.colanns.me/desktop/updates/stable/latest.json";
const PUBLIC_KEY: &str = include_str!("../updater-public-key.pub");

#[derive(Debug, Serialize)]
pub struct UpdateError {
    code: &'static str,
    message: &'static str,
}

impl UpdateError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
    fn busy() -> Self {
        Self::new(
            "busy",
            "仍有生成、更新或本地数据操作在进行，请完成或处理后再试。",
        )
    }
    fn cancelled() -> Self {
        Self::new("cancelled", "已取消下载，当前安装未改变。")
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    current_version: String,
    available: Option<AvailableUpdate>,
}

#[derive(Debug, Serialize)]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    phase: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

enum Operation {
    Checking,
    Downloading(CancellationToken),
    Installing,
}

#[derive(Default)]
struct Inner {
    checked: Option<Update>,
    operation: Option<Operation>,
}

#[derive(Clone, Default)]
pub struct UpdateState(Arc<Mutex<Inner>>);

/// Clears only the current operation. A cancelled download may retry the same
/// checked update; failed checks clear the old candidate before making a request.
struct OperationGuard(UpdateState);
impl Drop for OperationGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0 .0.lock() {
            state.operation = None;
        }
    }
}

impl UpdateState {
    fn begin_check(&self) -> Result<OperationGuard, UpdateError> {
        let mut state = self.0.lock().map_err(|_| UpdateError::busy())?;
        if state.operation.is_some() {
            return Err(UpdateError::busy());
        }
        state.checked = None;
        state.operation = Some(Operation::Checking);
        Ok(OperationGuard(self.clone()))
    }

    fn begin_download(
        &self,
        version: &str,
    ) -> Result<(OperationGuard, Update, CancellationToken), UpdateError> {
        let mut state = self.0.lock().map_err(|_| UpdateError::busy())?;
        if state.operation.is_some() {
            return Err(UpdateError::busy());
        }
        let update = state
            .checked
            .as_ref()
            .filter(|update| update.version == version)
            .cloned()
            .ok_or_else(|| UpdateError::new("not-checked", "请重新检查更新，并确认显示的版本。"))?;
        let cancel = CancellationToken::new();
        state.operation = Some(Operation::Downloading(cancel.clone()));
        Ok((OperationGuard(self.clone()), update, cancel))
    }

    fn begin_install(&self) -> Result<(), UpdateError> {
        let mut state = self.0.lock().map_err(|_| UpdateError::busy())?;
        match &state.operation {
            Some(Operation::Downloading(cancel)) if !cancel.is_cancelled() => {
                state.operation = Some(Operation::Installing);
                Ok(())
            }
            _ => Err(UpdateError::cancelled()),
        }
    }

    pub fn cancel(&self) -> bool {
        let Ok(state) = self.0.lock() else {
            return false;
        };
        if let Some(Operation::Downloading(cancel)) = &state.operation {
            cancel.cancel();
            true
        } else {
            false
        }
    }
}

fn supported_platform() -> Result<(), UpdateError> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Ok(())
    } else {
        Err(UpdateError::new(
            "unsupported",
            "当前自动更新仅支持 Windows x64。",
        ))
    }
}

fn while_idle<T>(
    app: &tauri::AppHandle,
    action: impl FnOnce() -> Result<T, UpdateError>,
) -> Result<T, UpdateError> {
    // Try, never wait: this lock order must not strand a writer behind an AI lock.
    let library = app.state::<LocalLibrary>();
    let _maintenance = library
        .try_enter_maintenance("updater")
        .map_err(|_| UpdateError::busy())?;
    app.state::<RequestRegistry>()
        .while_idle(|| {
            app.state::<ArenaState>()
                .while_idle(action)
                .map_err(|_| UpdateError::busy())?
        })
        .map_err(|_| UpdateError::busy())?
}

pub async fn check(app: tauri::AppHandle, state: UpdateState) -> Result<CheckResult, UpdateError> {
    supported_platform()?;
    let _operation = state.begin_check()?;
    let failed = || {
        UpdateError::new(
            "check-failed",
            "暂时无法检查更新，请稍后重试或访问官方下载页。",
        )
    };
    let updater = app
        .updater_builder()
        .endpoints(vec![ENDPOINT.parse().map_err(|_| failed())?])
        .map_err(|_| failed())?
        .pubkey(PUBLIC_KEY.trim())
        .version_comparator(|current, release| {
            release.version > current && release.version.pre.is_empty()
        })
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| failed())?;
    let mut checked = updater.check().await.map_err(|_| failed())?;
    if let Some(update) = &mut checked {
        if update.download_url.scheme() != "https" {
            return Err(failed());
        }
        // The check is short, but large downloads have no total deadline; the user
        // can cancel them without modifying the current installation.
        update.timeout = None;
    }
    let available = checked.as_ref().map(|update| AvailableUpdate {
        version: update.version.clone(),
        notes: update.body.clone(),
    });
    state.0.lock().map_err(|_| UpdateError::busy())?.checked = checked;
    Ok(CheckResult {
        current_version: app.package_info().version.to_string(),
        available,
    })
}

pub async fn install(
    app: tauri::AppHandle,
    state: UpdateState,
    version: String,
    on_event: Channel<Progress>,
) -> Result<(), UpdateError> {
    supported_platform()?;
    let (operation, update, cancel) = state.begin_download(&version)?;
    while_idle(&app, || Ok(()))?;
    on_event
        .send(Progress {
            phase: "downloading",
            downloaded_bytes: 0,
            total_bytes: None,
        })
        .map_err(|_| UpdateError::cancelled())?;
    let mut downloaded = 0u64;
    let mut total = None;
    let bytes = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(UpdateError::cancelled()),
        result = update.download(|length, content_length| {
            downloaded = downloaded.saturating_add(length as u64);
            total = content_length;
            if on_event.send(Progress { phase: "downloading", downloaded_bytes: downloaded, total_bytes: total }).is_err() {
                cancel.cancel();
            }
        }, || {}) => result.map_err(|_| UpdateError::new("download-failed", "下载或签名验证失败，当前安装未改变，请重试。"))?,
    };
    // download() has authenticated the artifact and signed version. The final
    // non-waiting maintenance lease excludes writers/backup/restore until handoff.
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        while_idle(&app, || {
            state.begin_install()?;
            on_event
                .send(Progress {
                    phase: "installing",
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                })
                .map_err(|_| UpdateError::cancelled())?;
            update.install(bytes).map_err(|_| {
                UpdateError::new(
                    "install-failed",
                    "未能启动更新安装程序，请重试或手动下载官方安装包。",
                )
            })
        })
    })
    .await
    .map_err(|_| UpdateError::new("install-failed", "更新安装任务未完成，请重试。"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    // Public signature of harmless text, never a private key or runnable installer.
    const PROBE: &[u8] = b"MahoShojo updater signing probe. Not an installer.\r\n";
    const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRVmFGbEx0Q21HUmNaaS82ZE1SOU1vbUFYM3BmYS9ZNFVFbHQyRlduQVN4ekJSeTJLd3ZOSEZhZDNiZGljUVFtblp3eDFEanViM2U2VnIzVTdYNDF6Z21KL2k2TnhDUmdnPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzMDIzNzQ0CWZpbGU6dXBkYXRlci1zaWduaW5nLXByb2JlLnR4dAl2ZXJzaW9uOjAuMS4wCkpvbFd2UzBCbCsvelBSVk9ReitUcGRLaXUwVVlmYUQ0b2Y5SXp5eVA0MFVvSy9HU21UZ29SdzRsNS8yQjZ5cUlENU45VmpKSk16ZXpPZFZWSUZKUUJRPT0K";

    #[test]
    fn official_verifier_rejects_corruption_and_manifest_version_substitution() {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(tauri::generate_context!())
            .unwrap();
        let updater = app
            .updater_builder()
            .pubkey(PUBLIC_KEY.trim())
            .version_comparator(|_, _| true)
            .build()
            .unwrap();
        let manifest = |version: &str| {
            serde_json::json!({
                "version": version, "url": "https://example.invalid/setup.exe", "signature": SIGNATURE
            })
        };
        let update = updater.restore_update(manifest("0.1.0")).unwrap().unwrap();
        update.verify(PROBE).unwrap();
        let mut corrupt = PROBE.to_vec();
        corrupt[0] ^= 1;
        assert!(update.verify(&corrupt).is_err());
        let substituted = updater.restore_update(manifest("0.1.1")).unwrap().unwrap();
        assert!(substituted.verify(PROBE).is_err());

        let state = UpdateState::default();
        state.0.lock().unwrap().checked = Some(update);
        assert_eq!(
            state.begin_download("9.9.9").err().unwrap().code,
            "not-checked"
        );
        let (operation, _, cancel) = state.begin_download("0.1.0").unwrap();
        assert!(state.cancel());
        assert!(cancel.is_cancelled());
        drop(operation);
        assert!(
            state.begin_download("0.1.0").is_ok(),
            "cancelled candidates remain retryable"
        );
        let _check = state.begin_check().unwrap();
        assert!(
            state.0.lock().unwrap().checked.is_none(),
            "a new failed check must not expose a stale candidate"
        );
    }

    #[test]
    fn direct_generation_must_finish_before_installer_callback_runs() {
        let registry = RequestRegistry::default();
        registry.register("updater-test").unwrap();
        assert!(registry
            .while_idle(|| panic!("must not install during generation"))
            .is_err());
        registry.finish("updater-test");
        assert_eq!(registry.while_idle(|| "installer").unwrap(), "installer");
    }

    #[test]
    fn updater_maintenance_refuses_writes_backup_and_restore_then_reopens() {
        let gate = crate::maintenance::MaintenanceGate::shared();
        let writer = gate.enter_write().unwrap();
        assert!(gate.try_enter_maintenance("updater").is_err());
        drop(writer);
        for label in ["backup", "restore"] {
            let maintenance = gate.enter_maintenance(label).unwrap();
            assert!(gate.try_enter_maintenance("updater").is_err());
            drop(maintenance);
        }
        let updater = gate.try_enter_maintenance("updater").unwrap();
        assert!(gate.enter_write().is_err());
        drop(updater);
        assert!(gate.enter_write().is_ok());
    }

    #[test]
    fn checking_is_exclusive_and_released_on_error() {
        let state = UpdateState::default();
        let operation = state.begin_check().unwrap();
        assert_eq!(state.begin_check().err().unwrap().code, "busy");
        assert!(!state.cancel());
        drop(operation);
        assert!(state.begin_check().is_ok());
    }

    #[test]
    fn install_requires_a_checked_candidate() {
        let state = UpdateState::default();
        assert_eq!(
            state.begin_download("0.2.0").err().unwrap().code,
            "not-checked"
        );
    }

    #[test]
    fn cancellation_wins_before_install_but_not_after_handoff() {
        let state = UpdateState::default();
        state.0.lock().unwrap().operation = Some(Operation::Downloading(CancellationToken::new()));
        assert!(state.cancel());
        assert_eq!(state.begin_install().unwrap_err().code, "cancelled");
        state.0.lock().unwrap().operation = Some(Operation::Downloading(CancellationToken::new()));
        state.begin_install().unwrap();
        assert!(!state.cancel());
    }

    #[test]
    fn projections_never_include_urls_paths_or_keys() {
        let result = CheckResult {
            current_version: "0.1.0".into(),
            available: Some(AvailableUpdate {
                version: "0.1.1".into(),
                notes: Some("修复".into()),
            }),
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({ "currentVersion": "0.1.0", "available": { "version": "0.1.1", "notes": "修复" } })
        );
        assert_eq!(
            serde_json::to_value(Progress {
                phase: "downloading",
                downloaded_bytes: 123,
                total_bytes: None
            })
            .unwrap(),
            serde_json::json!({ "phase": "downloading", "downloadedBytes": 123, "totalBytes": null })
        );
    }
}
