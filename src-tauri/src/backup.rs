//! 문서 폴더 백업: 문서\NovaCalendar\ 안에 일정을 저장한다. (예전 이름 문서\WidgetCalendar\ 는 처음 쓸 때 옮긴다)
//!
//! - calendar-backup.json : 최신 백업(복원에 사용) — '내 캘린더' 일정, 완료 표시, 설정(비밀번호·키 없음)
//! - calendar.ics         : 다른 캘린더 앱으로 옮길 수 있는 표준 파일
//! - backup-YYYY-MM-DD.json : 날짜별 사본(최근 14일)

use crate::store::{now_ms, write_json, write_text, Event, Settings, Store};
use crate::sync::ical;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const FOLDER: &str = "NovaCalendar";
/// 이름을 바꾸기 전(Widget Calendar)의 백업 폴더
const OLD_FOLDER: &str = "WidgetCalendar";
const KEEP_DAYS: usize = 14;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    version: u32,
    exported_at: i64,
    /// '내 캘린더' 일정(외부 캘린더 일정은 다시 동기화하면 되므로 넣지 않는다. 예전 백업에는 들어 있을 수 있음)
    events: Vec<Event>,
    /// 완료 체크("일정ID@날짜")
    #[serde(default)]
    done: Vec<String>,
    /// 설정(테마·글꼴·표시 방식 등). 비밀번호·키는 설정에 없다.
    #[serde(default)]
    settings: Option<Settings>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub dir: String,
    pub last_backup: Option<i64>,
    pub enabled: bool,
    pub has_accounts: bool,
}

pub fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| format!("문서 폴더를 찾을 수 없습니다: {e}"))?;
    let new = docs.join(FOLDER);
    let old = docs.join(OLD_FOLDER);
    // 예전 백업 폴더만 있으면 새 이름으로 옮겨 백업과 스냅숏을 그대로 이어서 쓴다.
    if !new.exists() && old.exists() {
        let _ = std::fs::rename(&old, &new);
    }
    Ok(new)
}

/// 백업을 만든다. force=false면 "동기화 계정이 없고 자동 백업을 켠 경우"에만 실행한다.
/// 만든 폴더 경로를 돌려주고, 건너뛰면 None.
pub fn run(app: &AppHandle, force: bool) -> Result<Option<PathBuf>, String> {
    let store = app.state::<Store>();
    if !force {
        let s = store.settings();
        // 동기화 계정이 있어도 '내 캘린더' 일정·완료 표시·설정은 이 PC에만 있으므로 백업한다.
        if !s.backup_enabled {
            return Ok(None);
        }
    }
    let dir = dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("백업 폴더를 만들 수 없습니다: {e}"))?;

    let events = store.events();
    let mine: Vec<Event> = events.iter().filter(|e| e.calendar_id == "local").cloned().collect();
    let file = BackupFile { version: 2, exported_at: now_ms(), events: mine, done: store.done_keys(), settings: Some(store.settings()) };
    write_json(&dir.join("calendar-backup.json"), &file)?;
    // 다른 캘린더 앱으로 옮길 수 있게 ICS에는 보이는 일정 전체를 담는다.
    write_text(&dir.join("calendar.ics"), &ical::export_calendar(&events))?;

    // 날짜별 사본 + 오래된 사본 정리
    let day = chrono::Local::now().format("%Y-%m-%d");
    write_json(&dir.join(format!("backup-{day}.json")), &file)?;
    let mut snaps: Vec<String> = fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| n.starts_with("backup-") && n.ends_with(".json"))
                .collect()
        })
        .unwrap_or_default();
    snaps.sort();
    if snaps.len() > KEEP_DAYS {
        for old in &snaps[..snaps.len() - KEEP_DAYS] {
            let _ = fs::remove_file(dir.join(old));
        }
    }
    Ok(Some(dir))
}

pub fn info(app: &AppHandle) -> Result<BackupInfo, String> {
    let store = app.state::<Store>();
    let dir = dir(app)?;
    let last = fs::metadata(dir.join("calendar-backup.json"))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    Ok(BackupInfo {
        dir: dir.to_string_lossy().to_string(),
        last_backup: last,
        enabled: store.settings().backup_enabled,
        has_accounts: !store.accounts().is_empty(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub events: usize,
    pub done: usize,
    pub settings: bool,
}

/// 백업을 현재와 합친다: 일정(같은 일정이면 더 최근에 고친 쪽), 완료 표시(합침), 설정(with_settings일 때만 덮어씀).
pub fn restore(app: &AppHandle, with_settings: bool) -> Result<RestoreResult, String> {
    let path = dir(app)?.join("calendar-backup.json");
    let text = fs::read_to_string(&path).map_err(|_| "백업 파일이 없습니다. 먼저 백업을 만들어 주세요.".to_string())?;
    let file: BackupFile = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| "백업 파일이 손상되었습니다.".to_string())?;
    let store = app.state::<Store>();
    // 예전 백업에 외부 캘린더 일정이 들어 있어도, 연결되지 않은 계정의 일정은 넣지 않는다.
    let accounts: Vec<String> = store.accounts().into_iter().map(|a| a.id).collect();
    let events: Vec<Event> = file.events.into_iter().filter(|e| e.calendar_id == "local" || accounts.contains(&e.calendar_id)).collect();
    let n = store.merge_events(events)?;
    let have = store.done_keys();
    let new_done: Vec<String> = file.done.into_iter().filter(|k| !have.contains(k)).collect();
    if !new_done.is_empty() {
        store.set_done_many(&new_done, true)?;
    }
    let mut set = false;
    if with_settings {
        if let Some(s) = file.settings {
            store.set_settings(s)?;
            set = true;
        }
    }
    Ok(RestoreResult { events: n, done: new_done.len(), settings: set })
}

pub fn open_folder(app: &AppHandle) -> Result<(), String> {
    let dir = dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let r = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(not(windows))]
    let r = std::process::Command::new("xdg-open").arg(&dir).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}
