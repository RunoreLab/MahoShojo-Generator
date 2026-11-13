//! 固定可信主窗口的显示偏好；不接受任意窗口标识。

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomResponse {
    pub zoom_percent: u16,
}

pub fn validate(caller: &str, zoom_percent: u16) -> Result<(), String> {
    if caller != "main-ui" {
        return Err("仅主窗口可调整页面缩放".into());
    }
    if ![80, 90, 100, 110, 125, 150, 175, 200].contains(&zoom_percent) {
        return Err("不支持的页面缩放档位".into());
    }
    Ok(())
}

/// 在平台线程完成操作并读回后才回执；Tauri 的通用 set_zoom 只确认派发。
pub async fn apply(webview: &tauri::Webview, zoom_percent: u16) -> Result<ZoomResponse, String> {
    validate(webview.label(), zoom_percent)?;
    #[cfg(windows)]
    {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };

        let (sender, receiver) = tokio::sync::oneshot::channel();
        let canceled = Arc::new(AtomicBool::new(false));
        let callback_canceled = canceled.clone();
        webview
            .with_webview(move |platform| {
                // 超时后还未进入平台线程的旧操作不得产生迟到副作用。
                // 已进入的同步 COM 操作与后继回调都由同一平台线程串行执行。
                if callback_canceled.load(Ordering::Acquire) || sender.is_closed() {
                    return;
                }
                let result = (|| {
                    let factor = f64::from(zoom_percent) / 100.0;
                    let controller = platform.controller();
                    // SAFETY: Tauri 在持有该 WebView 的平台线程上执行本回调。
                    unsafe {
                        controller
                            .SetZoomFactor(factor)
                            .map_err(|_| "无法应用主窗口页面缩放".to_owned())?;
                        let mut actual = 0.0;
                        controller
                            .ZoomFactor(&mut actual)
                            .map_err(|_| "无法确认主窗口页面缩放".to_owned())?;
                        if (actual - factor).abs() > 0.000_001 {
                            return Err("主窗口缩放回读与请求不一致".to_owned());
                        }
                    }
                    Ok(ZoomResponse { zoom_percent })
                })();
                let _ = sender.send(result);
            })
            .map_err(|_| "无法安排主窗口页面缩放".to_owned())?;
        match tokio::time::timeout(std::time::Duration::from_secs(2), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("主窗口页面缩放确认通道已关闭".to_owned()),
            Err(_) => {
                canceled.store(true, Ordering::Release);
                Err("主窗口页面缩放确认超时；当前倍率尚未确认，请重新应用".to_owned())
            }
        }
    }
    #[cfg(not(windows))]
    {
        Err("此平台尚未开放可确认的主窗口页面缩放".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_is_bounded_and_only_available_to_main_ui() {
        for percent in [80, 90, 100, 110, 125, 150, 175, 200] {
            assert!(validate("main-ui", percent).is_ok());
            assert!(validate("webpkg-untrusted", percent).is_err());
        }
        for percent in [0, 79, 81, 201, u16::MAX] {
            assert!(validate("main-ui", percent).is_err());
        }
    }
}
