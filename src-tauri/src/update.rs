//! 사내 배포용 자동 업데이트.
//!
//! 관리자가 공유 폴더(\\server\share\NovaCalendar) 또는 웹 주소(https://…/NovaCalendar)에
//! 새 설치 파일과 latest.json 을 올려 두면, 각 PC가 켤 때와 6시간마다 확인한다.
//!
//! latest.json: { "version": "1.12.0", "file": "NovaCalendar-Setup-1.12.0.exe", "sha256": "…", "notes": "…" }
//!
//! 설치: 설치 파일을 임시 폴더로 받아 SHA-256 이 latest.json 과 같을 때만, 위젯을 끄고
//! 조용히(/S) 설치한 뒤 다시 켠다.

use crate::store::Store;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Manifest {
    pub version: String,
    pub file: String,
    pub sha256: String,
    pub notes: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub current: String,
    pub latest: Option<Manifest>,
    pub newer: bool,
}

/// 기본 업데이트 위치(설정에서 비워 두면 이 위치를 쓴다)
pub const DEFAULT_SOURCE: &str = r"\\DESKTOP-2KBH0F7\NovaCalendarUpdateServer";

/// 실제로 확인할 위치: 비어 있으면 기본 위치
pub fn effective_source(s: &str) -> String {
    let t = s.trim();
    if t.is_empty() { DEFAULT_SOURCE.to_string() } else { t.to_string() }
}

/// 이미 알린 버전(같은 버전을 6시간마다 다시 알리지 않는다)
static NOTIFIED: Mutex<String> = Mutex::new(String::new());

fn is_url(s: &str) -> bool {
    let l = s.to_ascii_lowercase();
    l.starts_with("https://") || l.starts_with("http://")
}

fn join(source: &str, name: &str) -> String {
    let base = source.trim().trim_end_matches(['/', '\\']);
    if is_url(base) { format!("{base}/{name}") } else { format!("{base}\\{name}") }
}

/// "1.11.1" → [1, 11, 1]
fn parse_ver(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches(['v', 'V']).split(['.', '-', '+']).take(3).map(|x| x.parse().unwrap_or(0)).collect()
}

pub fn newer_than(latest: &str, current: &str) -> bool {
    let (a, b) = (parse_ver(latest), parse_ver(current));
    for i in 0..3 {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

async fn read_bytes(path: &str) -> Result<Vec<u8>, String> {
    if is_url(path) {
        let client = crate::sync::http_client(false)?;
        let res = client.get(path).send().await.map_err(|e| format!("업데이트 위치에 연결할 수 없습니다: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("업데이트 위치에서 파일을 받지 못했습니다 (HTTP {}): {path}", res.status().as_u16()));
        }
        res.bytes().await.map(|b| b.to_vec()).map_err(|e| format!("파일을 받는 중 끊겼습니다: {e}"))
    } else {
        let p = path.to_string();
        tauri::async_runtime::spawn_blocking(move || std::fs::read(&p).map_err(|e| format!("업데이트 위치의 파일을 읽을 수 없습니다: {p} ({e})")))
            .await
            .map_err(|e| e.to_string())?
    }
}

pub async fn read_manifest(source: &str) -> Result<Manifest, String> {
    if source.trim().is_empty() {
        return Err("업데이트 위치가 설정되어 있지 않습니다.".into());
    }
    let bytes = read_bytes(&join(source, "latest.json")).await?;
    let text = String::from_utf8_lossy(&bytes);
    // PowerShell이 붙이는 BOM 은 떼고 읽는다
    let m: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("latest.json 형식이 올바르지 않습니다: {e}"))?;
    if m.version.trim().is_empty() || m.file.trim().is_empty() || m.sha256.trim().len() != 64 {
        return Err("latest.json 에 version, file, sha256(64자)이 모두 있어야 합니다.".into());
    }
    if m.file.contains(['/', '\\']) || !m.file.to_ascii_lowercase().ends_with(".exe") {
        return Err("latest.json 의 file 은 같은 위치에 있는 .exe 파일 이름이어야 합니다.".into());
    }
    Ok(m)
}

pub async fn check(app: &AppHandle, source: Option<String>) -> Result<CheckResult, String> {
    let current = app.package_info().version.to_string();
    let src = effective_source(&source.unwrap_or_else(|| app.state::<Store>().settings().update_source));
    let m = read_manifest(&src).await?;
    let newer = newer_than(&m.version, &current);
    Ok(CheckResult { current, latest: Some(m), newer })
}

/// 받아서 확인한 뒤 설치를 시작하고 앱을 끝낸다.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let src = effective_source(&app.state::<Store>().settings().update_source);
    let m = read_manifest(&src).await?;
    let current = app.package_info().version.to_string();
    if !newer_than(&m.version, &current) {
        return Err(format!("이미 최신 버전입니다 ({current})."));
    }
    let data = read_bytes(&join(&src, &m.file)).await?;
    let hash: String = Sha256::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
    if !hash.eq_ignore_ascii_case(m.sha256.trim()) {
        return Err("받은 설치 파일이 latest.json 의 SHA-256 과 다릅니다. 파일이 바뀌었거나 덜 복사되었을 수 있어 설치하지 않았습니다.".into());
    }
    let dir: PathBuf = std::env::temp_dir().join("NovaCalendar-update");
    std::fs::create_dir_all(&dir).map_err(|e| format!("임시 폴더를 만들 수 없습니다: {e}"))?;
    let setup = dir.join(&m.file);
    std::fs::write(&setup, &data).map_err(|e| format!("설치 파일을 저장할 수 없습니다: {e}"))?;
    run_installer(&setup)?;
    // 설치 프로그램이 파일을 바꿀 수 있게 앱을 끝낸다(설치 뒤 다시 켜진다).
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        h.exit(0);
    });
    Ok(())
}

#[cfg(windows)]
fn run_installer(setup: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // 2초 기다렸다가(앱이 끝나도록) 조용히 설치하고, 끝나면 다시 켠다.
    let script = format!(
        "timeout /t 2 /nobreak >nul & \"{}\" /S & start \"\" \"{}\"",
        setup.display(),
        exe.display()
    );
    std::process::Command::new("cmd")
        .raw_arg("/C")
        .raw_arg(format!("\"{script}\""))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("설치 프로그램을 실행할 수 없습니다: {e}"))
}

#[cfg(not(windows))]
fn run_installer(_setup: &std::path::Path) -> Result<(), String> {
    Err("업데이트 설치는 윈도우에서만 됩니다.".into())
}

/// 켤 때(30초 뒤)와 6시간마다 확인하고, 새 버전이면 알림을 띄우고 화면에 알린다.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            let s = app.state::<Store>().settings();
            if s.update_auto {
                if let Ok(r) = check(&app, None).await {
                    if r.newer {
                        let m = r.latest.clone().unwrap_or_default();
                        let _ = app.emit("update-available", &r);
                        let first = {
                            let mut n = NOTIFIED.lock().unwrap();
                            let first = *n != m.version;
                            *n = m.version.clone();
                            first
                        };
                        if first {
                            crate::reminder::notify(&app, "NovaCalendar 새 버전", &format!("{} 버전이 있습니다. 메뉴의 [업데이트 설치]나 설정 → 업데이트에서 설치하세요.", m.version));
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compares_versions() {
        assert!(newer_than("1.12.0", "1.11.1"));
        assert!(newer_than("2.0.0", "1.99.9"));
        assert!(newer_than("1.11.10", "1.11.9"));
        assert!(!newer_than("1.11.1", "1.11.1"));
        assert!(!newer_than("1.9.0", "1.11.0"));
        assert_eq!(join("\\\\srv\\share\\Nova\\", "latest.json"), "\\\\srv\\share\\Nova\\latest.json");
        assert_eq!(join("https://x.co/nova/", "latest.json"), "https://x.co/nova/latest.json");
        assert_eq!(effective_source("  "), DEFAULT_SOURCE);
        assert_eq!(join(DEFAULT_SOURCE, "latest.json"), r"\\DESKTOP-2KBH0F7\NovaCalendarUpdateServer\latest.json");
    }
}
