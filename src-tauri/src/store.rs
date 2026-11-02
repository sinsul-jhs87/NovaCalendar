use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

/// 일정 한 건. 프런트엔드와 camelCase JSON으로 주고받는다.
///
/// 날짜는 "YYYY-MM-DD", 시간은 "HH:MM"(로컬 시간) 문자열로 저장한다.
/// 문자열 비교만으로 날짜 범위 판단이 되고, 시간대 변환 오류가 생기지 않는다.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start_date: String,
    pub end_date: String,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default)]
    pub memo: String,
    #[serde(default)]
    pub color: String,
    /// 알림: 시작 시각 기준 "몇 분 전" 목록. 0은 정시. 종일 일정은 당일 09:00이 시작 시각.
    #[serde(default)]
    pub reminders: Vec<i32>,
    /// 소속 캘린더. 로컬은 "local", 동기화 계정은 계정 ID.
    #[serde(default = "local_id")]
    pub calendar_id: String,
    /// 외부 캘린더에서의 원본 ID.
    #[serde(default)]
    pub remote_id: Option<String>,
    #[serde(default)]
    pub updated_at: i64,
    /// 삭제 표시. 서버에 삭제를 전달하기 전까지 남겨 둔다.
    #[serde(default)]
    pub deleted: bool,
    /// 읽기 전용(ICS 구독, 반복 일정에서 펼친 항목 등). 수정·삭제 불가.
    #[serde(default)]
    pub read_only: bool,
    /// 서버에 아직 반영하지 못한 로컬 변경이 있음.
    #[serde(default)]
    pub dirty: bool,
    /// 반복 규칙. '내 캘린더'(로컬) 일정에서만 쓴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<Repeat>,
}

/// 반복 규칙
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Repeat {
    /// "daily" | "weekly" | "monthly" | "yearly"
    pub freq: String,
    /// 몇 번째마다(1 = 매번)
    pub interval: u32,
    /// 마지막 날짜(포함). 없으면 계속 반복.
    pub until: Option<String>,
}

pub fn local_id() -> String {
    "local".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 위젯 배경 불투명도 0.2 ~ 1.0
    pub opacity: f64,
    /// "month": 현재 달 기준 / "rolling": 오늘 기준 위아래 2주
    pub month_mode: String,
    /// 0: 일요일 시작, 1: 월요일 시작
    pub week_start: u8,
    /// "day" | "week" | "month"
    pub view: String,
    /// 자동 동기화 주기(분). 0이면 끔.
    pub sync_minutes: u32,
    /// 동기화 계정이 없을 때 문서 폴더에 자동 백업
    pub backup_enabled: bool,
    pub notify_enabled: bool,
    /// "popup": 화면 오른쪽 위 팝업 창 / "windows": 윈도우 기본 알림
    pub notify_style: String,
    /// 테마 ID (THEME_IDS 중 하나)
    pub theme: String,
    /// 공휴일(쉬는 날) 표시
    pub show_holidays: bool,
    /// 기념일·24절기 표시
    pub show_special: bool,
    /// 음력(윤달 포함) 표시
    pub show_lunar: bool,
    /// 오늘 일정 패널(오늘/다가오는 일정/카드 줄) 표시
    pub show_panel: bool,
    /// 글자 크기 배율 0.8 ~ 1.6
    pub font_scale: f64,
    /// 글꼴 이름. 비어 있으면 기본 글꼴.
    pub font_family: String,
    /// 칸·일정 바탕 진하기 0 ~ 1 (0이면 바탕 없이 한 면으로 보임)
    pub surface: f64,
    /// 완료한 일정 표시: "strike-dim"(기본) | "strike" | "dim" | "check" | "hide"
    pub done_style: String,
    /// 오늘의 일정 표시. 비어 있으면(null) 테마 기본값(오늘 패널이 있는 테마만 켜짐)
    pub show_today: Option<bool>,
    /// 다가오는 일정 표시. 비어 있으면(null) 테마 기본값(다가오는 일정·카드 줄이 있는 테마만 켜짐)
    pub show_upcoming: Option<bool>,
    /// 옆 패널(오늘의 일정·다가오는 일정) 폭(px). 0이면 기본 폭.
    pub panel_width: f64,
    /// 묶음별 글꼴(비어 있으면 기본 글꼴)과 크기(px, 0이면 기본)
    /// 시스템 글자 / 달력 날짜 / 달력 일정 / 다가오는 일정
    pub ui_font: String,
    pub ui_size: f64,
    pub num_font: String,
    pub num_size: f64,
    pub ev_font: String,
    pub ev_size: f64,
    pub panel_font: String,
    pub panel_size: f64,
    /// 업데이트 위치(공유 폴더 또는 https 주소). 비어 있으면 기본 위치(update::DEFAULT_SOURCE)를 쓴다.
    pub update_source: String,
    /// 켤 때·6시간마다 자동으로 확인
    pub update_auto: bool,
}

pub const THEME_IDS: [&str; 30] = [
    "midnight",
    "maple",
    "forest",
    "lavender",
    "graphite",
    "aurora",
    "hanji",
    "ocean",
    "sakura",
    "apple",
    "snow",
    "concrete",
    "wine",
    "peach",
    "sage",
    "sepia",
    "neon",
    "dancheong",
    "cobalt",
    "glacier",
    "ash",
    "slatemid",
    "fog",
    "caramel",
    "taupe",
    "pop",
    "blueprint",
    "candy",
    "lemonade",
    "lagoon",
];

impl Default for Settings {
    fn default() -> Self {
        Self {
            opacity: 0.85,
            month_mode: "month".to_string(),
            week_start: 0,
            view: "month".to_string(),
            sync_minutes: 15,
            backup_enabled: true,
            notify_enabled: true,
            notify_style: "popup".to_string(),
            theme: "midnight".to_string(),
            show_holidays: true,
            show_special: true,
            show_lunar: true,
            show_panel: true,
            font_scale: 1.0,
            font_family: String::new(),
            surface: 0.5,
            done_style: "strike-dim".into(),
            show_today: None,
            show_upcoming: None,
            panel_width: 0.0,
            ui_font: String::new(),
            ui_size: 0.0,
            num_font: String::new(),
            num_size: 0.0,
            ev_font: String::new(),
            ev_size: 0.0,
            panel_font: String::new(),
            panel_size: 0.0,
            update_source: String::new(),
            update_auto: true,
        }
    }
}

/// 동기화 계정. 비밀번호·토큰이 들어 있으므로 프런트엔드에는 AccountInfo만 보낸다.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub id: String,
    /// "google" | "caldav" | "ics" | "flow"
    pub kind: String,
    pub name: String,
    pub color: String,
    /// caldav: 서버 주소 / ics: 구독 주소 또는 파일 경로
    pub url: String,
    pub username: String,
    pub password: String,
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: String,
    /// caldav: 찾아낸 캘린더 주소들(첫 번째가 새 일정의 저장 위치)
    pub calendars: Vec<String>,
    pub last_sync: i64,
    pub last_error: String,
    pub enabled: bool,
    /// (1.6.0에서 쓰던 값, 지금은 쓰지 않음) 읽기만 하고 다시 저장하지 않는다.
    #[serde(skip_serializing)]
    pub use_account_color: bool,
    /// 켜면 외부 일정을 원래 정해진 색(플로우·Google의 일정 색)으로 표시한다. 기본은 꺼짐 = 계정 색으로 표시.
    pub keep_event_color: bool,
}

impl Account {
    pub fn read_only(&self) -> bool {
        matches!(self.kind.as_str(), "ics" | "flow")
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub color: String,
    pub detail: String,
    pub last_sync: i64,
    pub last_error: String,
    pub read_only: bool,
    pub keep_event_color: bool,
}

impl From<&Account> for AccountInfo {
    fn from(a: &Account) -> Self {
        let detail = match a.kind.as_str() {
            "google" => "Google 캘린더".to_string(),
            "caldav" => format!("{} · {}", a.username, a.url),
            "flow" => if a.calendars.is_empty() { "플로우 · 모든 캘린더 (읽기 전용)".to_string() } else { format!("플로우 · 캘린더 {}개 (읽기 전용)", a.calendars.len()) },
            _ => a.url.clone(),
        };
        Self {
            id: a.id.clone(),
            kind: a.kind.clone(),
            name: a.name.clone(),
            color: a.color.clone(),
            detail,
            last_sync: a.last_sync,
            last_error: a.last_error.clone(),
            read_only: a.read_only(),
            keep_event_color: a.keep_event_color,
        }
    }
}

pub struct Store {
    dir: PathBuf,
    events: Mutex<Vec<Event>>,
    settings: Mutex<Settings>,
    accounts: Mutex<Vec<Account>>,
    fired: Mutex<Vec<String>>,
    /// 완료로 체크한 일정: "일정ID@시작날짜"(반복 일정은 날짜마다 따로). 외부 일정도 동기화와 상관없이 유지된다.
    done: Mutex<Vec<String>>,
}

impl Store {
    pub fn load(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let events: Vec<Event> = read_json(&dir.join("events.json")).unwrap_or_default();
        let settings: Settings = read_json(&dir.join("settings.json")).unwrap_or_default();
        let raw: Vec<Account> = read_json(&dir.join("accounts.json")).unwrap_or_default();
        // 예전 버전이 평문으로 저장해 둔 비밀값이 있으면, 읽은 뒤 암호화해서 다시 저장한다.
        let had_plain = raw.iter().any(|a| {
            [&a.password, &a.client_secret, &a.refresh_token]
                .iter()
                .any(|v| !v.is_empty() && !v.starts_with(crate::secret::PREFIX))
        });
        let accounts: Vec<Account> = raw.into_iter().map(reveal_account).collect();
        if had_plain {
            let _ = write_accounts_file(&dir, &accounts);
        }
        let fired: Vec<String> = read_json(&dir.join("fired.json")).unwrap_or_default();
        let done: Vec<String> = read_json(&dir.join("done.json")).unwrap_or_default();
        Self {
            dir,
            events: Mutex::new(events),
            settings: Mutex::new(settings),
            accounts: Mutex::new(accounts),
            fired: Mutex::new(fired),
            done: Mutex::new(done),
        }
    }

    /// 데이터 폴더(%APPDATA%\com.widgetcalendar.app)
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn events_path(&self) -> PathBuf {
        self.dir.join("events.json")
    }

    // ───────── 일정 ─────────

    /// 삭제 표시가 없는 일정만 돌려준다.
    pub fn events(&self) -> Vec<Event> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| !e.deleted)
            .cloned()
            .collect()
    }

    /// 삭제 표시까지 포함한 전체(동기화용).
    pub fn raw_events(&self) -> Vec<Event> {
        self.events.lock().unwrap().clone()
    }

    /// 다른 캘린더의 백업에서 가져온 일정들을 '내 캘린더'에 한 번에 넣는다.
    /// 제목·시작일·종료일이 같은 일정이 이미 있으면 건너뛴다(같은 파일을 두 번 가져와도 중복되지 않음).
    /// 돌려주는 값: (추가한 수, 건너뛴 수)
    pub fn import_events(&self, list: Vec<Event>) -> Result<(usize, usize), String> {
        let mut events = self.events.lock().unwrap();
        let (mut added, mut skipped) = (0usize, 0usize);
        for mut ev in list {
            ev.title = ev.title.trim().to_string();
            let valid = chrono::NaiveDate::parse_from_str(&ev.start_date, "%Y-%m-%d").is_ok();
            if ev.title.is_empty() || !valid {
                skipped += 1;
                continue;
            }
            if chrono::NaiveDate::parse_from_str(&ev.end_date, "%Y-%m-%d").is_err() || ev.end_date < ev.start_date {
                ev.end_date = ev.start_date.clone();
            }
            let dup = events.iter().any(|e| {
                !e.deleted && e.calendar_id == "local" && e.title == ev.title && e.start_date == ev.start_date && e.end_date == ev.end_date
            });
            if dup {
                skipped += 1;
                continue;
            }
            if ev.id.trim().is_empty() || events.iter().any(|e| e.id == ev.id) {
                ev.id = format!("imp-{}", uuid::Uuid::new_v4().simple());
            }
            ev.calendar_id = local_id();
            ev.remote_id = None;
            ev.read_only = false;
            ev.dirty = false;
            ev.deleted = false;
            ev.updated_at = now_ms();
            events.push(ev);
            added += 1;
        }
        if added > 0 {
            write_json(&self.events_path(), &*events)?;
        }
        Ok((added, skipped))
    }

    /// 사용자가 만든·고친 일정을 저장한다. 서버에서 온 필드(remoteId 등)는 클라이언트 값을 믿지 않는다.
    pub fn upsert(&self, mut ev: Event) -> Result<(), String> {
        ev.title = ev.title.trim().to_string();
        if ev.id.is_empty() || ev.title.is_empty() {
            return Err("id와 제목은 비워둘 수 없습니다.".into());
        }
        if ev.end_date < ev.start_date {
            ev.end_date = ev.start_date.clone();
        }
        if ev.calendar_id.trim().is_empty() {
            ev.calendar_id = local_id();
        }
        ev.deleted = false;
        ev.updated_at = now_ms();
        // 반복 규칙 정리: 모르는 주기는 없애고, 간격은 1~99, 종료일은 올바른 날짜이면서 시작일 이후여야 한다.
        let sd = ev.start_date.clone();
        let keep = match ev.repeat.as_mut() {
            Some(r) => {
                r.interval = r.interval.clamp(1, 99);
                if let Some(u) = r.until.clone() {
                    if chrono::NaiveDate::parse_from_str(&u, "%Y-%m-%d").is_err() || u < sd {
                        r.until = None;
                    }
                }
                ["daily", "weekly", "monthly", "yearly"].contains(&r.freq.as_str())
            }
            None => true,
        };
        if !keep {
            ev.repeat = None;
        }

        let mut list = self.events.lock().unwrap();
        match list.iter_mut().find(|e| e.id == ev.id) {
            Some(slot) => {
                if slot.read_only {
                    return Err("읽기 전용 일정은 수정할 수 없습니다.".into());
                }
                ev.remote_id = slot.remote_id.clone();
                ev.calendar_id = slot.calendar_id.clone();
                ev.read_only = false;
                ev.dirty = ev.calendar_id != "local";
                if ev.calendar_id != "local" {
                    ev.repeat = None; // 반복 일정은 '내 캘린더'에서만 지원
                }
                *slot = ev;
            }
            None => {
                ev.remote_id = None;
                ev.read_only = false;
                ev.dirty = ev.calendar_id != "local";
                if ev.calendar_id != "local" {
                    ev.repeat = None; // 반복 일정은 '내 캘린더'에서만 지원
                }
                list.push(ev);
            }
        }
        write_json(&self.events_path(), &*list)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut list = self.events.lock().unwrap();
        let Some(pos) = list.iter().position(|e| e.id == id) else {
            return Ok(());
        };
        if list[pos].read_only {
            return Err("읽기 전용 일정은 삭제할 수 없습니다.".into());
        }
        // 서버에 올라간 적이 있는 일정만 삭제 표시를 남기고, 나머지는 바로 지운다.
        if list[pos].calendar_id != "local" && list[pos].remote_id.is_some() {
            let e = &mut list[pos];
            e.deleted = true;
            e.dirty = true;
            e.updated_at = now_ms();
        } else {
            list.remove(pos);
        }
        write_json(&self.events_path(), &*list)
    }

    /// 동기화 엔진이 목록을 직접 고칠 때 쓴다. 잠금은 이 호출 동안만 잡는다.
    pub fn mutate_events<R>(&self, f: impl FnOnce(&mut Vec<Event>) -> R) -> Result<R, String> {
        let mut list = self.events.lock().unwrap();
        let r = f(&mut list);
        write_json(&self.events_path(), &*list)?;
        Ok(r)
    }

    /// 백업에서 복원: id가 같으면 수정 시각이 더 새로운 쪽을 남긴다.
    pub fn merge_events(&self, incoming: Vec<Event>) -> Result<usize, String> {
        self.mutate_events(|list| {
            let mut changed = 0;
            for mut ev in incoming {
                if ev.id.is_empty() || ev.title.trim().is_empty() {
                    continue;
                }
                ev.deleted = false;
                match list.iter_mut().find(|e| e.id == ev.id) {
                    Some(slot) if slot.updated_at >= ev.updated_at && !slot.deleted => {}
                    Some(slot) => {
                        *slot = ev;
                        changed += 1;
                    }
                    None => {
                        list.push(ev);
                        changed += 1;
                    }
                }
            }
            changed
        })
    }

    // ───────── 설정 ─────────

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_settings(&self, mut s: Settings) -> Result<Settings, String> {
        s.opacity = s.opacity.clamp(0.2, 1.0);
        if s.month_mode != "month" && s.month_mode != "rolling" {
            s.month_mode = "month".into();
        }
        if !["day", "week", "month"].contains(&s.view.as_str()) {
            s.view = "month".into();
        }
        s.week_start = s.week_start.min(1);
        s.sync_minutes = s.sync_minutes.min(1440);
        if s.notify_style != "popup" && s.notify_style != "windows" {
            s.notify_style = "popup".into();
        }
        if !THEME_IDS.contains(&s.theme.as_str()) {
            s.theme = "midnight".into();
        }
        s.font_scale = if s.font_scale.is_finite() { s.font_scale.clamp(0.8, 1.6) } else { 1.0 };
        s.surface = if s.surface.is_finite() { s.surface.clamp(0.0, 1.0) } else { 0.5 };
        // 글꼴 이름은 CSS에 들어가므로 글자·숫자·공백·-_., 만 남기고 60자로 자른다.
        s.font_family = s
            .font_family
            .chars()
            .filter(|c| c.is_alphanumeric() || " -_.,".contains(*c))
            .collect::<String>()
            .trim()
            .chars()
            .take(60)
            .collect();
        let mut cur = self.settings.lock().unwrap();
        *cur = s.clone();
        write_json(&self.dir.join("settings.json"), &*cur)?;
        Ok(s)
    }

    // ───────── 계정 ─────────

    pub fn accounts(&self) -> Vec<Account> {
        self.accounts.lock().unwrap().clone()
    }

    pub fn account(&self, id: &str) -> Option<Account> {
        self.accounts.lock().unwrap().iter().find(|a| a.id == id).cloned()
    }

    pub fn add_account(&self, acc: Account) -> Result<(), String> {
        let mut list = self.accounts.lock().unwrap();
        list.push(acc);
        write_accounts_file(&self.dir, &list)
    }

    pub fn update_account(&self, id: &str, f: impl FnOnce(&mut Account)) -> Result<(), String> {
        let mut list = self.accounts.lock().unwrap();
        if let Some(a) = list.iter_mut().find(|a| a.id == id) {
            f(a);
        }
        write_accounts_file(&self.dir, &list)
    }

    /// 계정을 지우고, 그 계정에서 가져온 일정도 이 PC에서 지운다(서버 데이터는 건드리지 않음).
    pub fn remove_account(&self, id: &str) -> Result<(), String> {
        {
            let mut list = self.accounts.lock().unwrap();
            list.retain(|a| a.id != id);
            write_accounts_file(&self.dir, &list)?;
        }
        self.mutate_events(|list| list.retain(|e| e.calendar_id != id))
    }

    // ───────── 알림 기록 ─────────

    /// 처음 기록하는 키면 true. 앱을 다시 켜도 같은 알림이 반복되지 않도록 파일에 남긴다.
    /// 완료로 체크한 일정 키 목록
    pub fn done_keys(&self) -> Vec<String> {
        self.done.lock().unwrap().clone()
    }

    pub fn is_done(&self, key: &str) -> bool {
        self.done.lock().unwrap().iter().any(|k| k == key)
    }

    /// 완료 체크를 켜거나 끈다. 오래된 체크가 끝없이 쌓이지 않게 최근 5000개만 둔다.
    pub fn set_done(&self, key: &str, on: bool) -> Result<(), String> {
        let mut list = self.done.lock().unwrap();
        list.retain(|k| k != key);
        if on {
            list.push(key.to_string());
        }
        let n = list.len();
        if n > 5000 {
            list.drain(..n - 5000);
        }
        write_json(&self.dir.join("done.json"), &*list)
    }

    /// 여러 일정의 완료 체크를 한 번에 켜거나 끈다(날짜 팝업의 '전체 완료').
    pub fn set_done_many(&self, keys: &[String], on: bool) -> Result<(), String> {
        let mut list = self.done.lock().unwrap();
        list.retain(|k| !keys.contains(k));
        if on {
            list.extend(keys.iter().cloned());
        }
        let n = list.len();
        if n > 5000 {
            list.drain(..n - 5000);
        }
        write_json(&self.dir.join("done.json"), &*list)
    }

    pub fn mark_fired(&self, key: &str) -> bool {
        let mut list = self.fired.lock().unwrap();
        if list.iter().any(|k| k == key) {
            return false;
        }
        list.push(key.to_string());
        if list.len() > 3000 {
            let cut = list.len() - 3000;
            list.drain(0..cut);
        }
        let _ = write_json(&self.dir.join("fired.json"), &*list);
        true
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 파일이 없으면 None. 파일이 깨졌으면 덮어써서 날리지 않도록 옆으로 치워두고 None.
fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    match serde_json::from_str(&text) {
        Ok(v) => Some(v),
        Err(_) => {
            let _ = fs::rename(path, path.with_extension("json.corrupt"));
            None
        }
    }
}

/// 임시 파일에 쓴 뒤 교체한다. 쓰는 도중 꺼져도 기존 파일이 남는다.
/// 계정 목록을 저장한다. 비밀번호·토큰은 DPAPI로 암호화해서 쓴다.
fn write_accounts_file(dir: &Path, list: &[Account]) -> Result<(), String> {
    let enc: Vec<Account> = list
        .iter()
        .map(|a| {
            let mut a = a.clone();
            a.password = crate::secret::protect(&a.password);
            a.client_secret = crate::secret::protect(&a.client_secret);
            a.refresh_token = crate::secret::protect(&a.refresh_token);
            a
        })
        .collect();
    write_json(&dir.join("accounts.json"), &enc)
}

fn reveal_account(mut a: Account) -> Account {
    a.password = crate::secret::reveal(&a.password);
    a.client_secret = crate::secret::reveal(&a.client_secret);
    a.refresh_token = crate::secret::reveal(&a.refresh_token);
    a
}

pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    write_text(path, &text)
}

pub fn write_text(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("wc_store_{}", uuid::Uuid::new_v4().simple()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    fn ev(id: &str, title: &str) -> Event {
        Event {
            id: id.into(),
            title: title.into(),
            start_date: "2026-10-30".into(),
            end_date: "2026-10-28".into(), // 일부러 뒤집어 둔다
            ..Default::default()
        }
    }

    #[test]
    fn upsert_cleans_input_and_survives_restart() {
        let dir = tmp();
        let s = Store::load(dir.clone());
        s.upsert(ev("1", "  회의  ")).unwrap();
        let e = &s.events()[0];
        assert_eq!(e.title, "회의");
        assert_eq!(e.end_date, "2026-10-30"); // 종료일이 앞서면 보정
        assert!(e.updated_at > 0);
        assert!(!e.dirty); // 로컬 일정은 서버에 올릴 것이 없다
        assert!(s.upsert(ev("2", "   ")).is_err());
        assert_eq!(Store::load(dir).events().len(), 1);
    }

    #[test]
    fn client_cannot_forge_server_fields() {
        let s = Store::load(tmp());
        let mut a = ev("1", "서버 일정");
        a.calendar_id = "acc".into();
        a.remote_id = Some("forged".into());
        a.read_only = true;
        s.upsert(a).unwrap();
        let e = &s.events()[0];
        assert_eq!(e.remote_id, None);
        assert!(!e.read_only);
        assert!(e.dirty); // 동기화 계정 소속이면 서버에 올려야 한다

        // 서버가 원본 ID를 부여한 뒤에는 클라이언트가 바꿀 수 없다.
        s.mutate_events(|l| l[0].remote_id = Some("real".into())).unwrap();
        let mut b = ev("1", "수정");
        b.calendar_id = "other".into();
        b.remote_id = Some("forged".into());
        s.upsert(b).unwrap();
        let e = &s.events()[0];
        assert_eq!((e.remote_id.as_deref(), e.calendar_id.as_str()), (Some("real"), "acc"));
    }

    #[test]
    fn readonly_events_are_protected() {
        let s = Store::load(tmp());
        let mut r = ev("r", "구독");
        r.read_only = true;
        s.mutate_events(|l| l.push(r)).unwrap();
        assert!(s.upsert(ev("r", "고치기")).is_err());
        assert!(s.remove("r").is_err());
        assert_eq!(s.events()[0].title, "구독");
    }

    #[test]
    fn remove_marks_synced_and_drops_local() {
        let s = Store::load(tmp());
        s.upsert(ev("local", "로컬")).unwrap();
        let mut a = ev("syn", "서버");
        a.calendar_id = "acc".into();
        s.upsert(a).unwrap();
        s.mutate_events(|l| l.iter_mut().find(|e| e.id == "syn").unwrap().remote_id = Some("r1".into())).unwrap();
        let mut b = ev("unsent", "아직 안 올림");
        b.calendar_id = "acc".into();
        s.upsert(b).unwrap();

        s.remove("local").unwrap();
        s.remove("syn").unwrap();
        s.remove("unsent").unwrap();
        assert_eq!(s.events().len(), 0);
        let raw = s.raw_events();
        assert_eq!(raw.len(), 1); // 서버에 올라간 적 있는 것만 삭제 표시로 남는다
        assert!(raw[0].deleted && raw[0].dirty && raw[0].remote_id.as_deref() == Some("r1"));
    }

    #[test]
    fn merge_keeps_newer_side() {
        let s = Store::load(tmp());
        s.upsert(ev("1", "현재")).unwrap();
        let now = s.events()[0].updated_at;
        let mut old = ev("1", "옛날 백업");
        old.updated_at = now - 1000;
        let mut newer = ev("2", "새 일정");
        newer.updated_at = 5;
        let mut newest = ev("1", "더 최근 백업");
        newest.updated_at = now + 1000;
        assert_eq!(s.merge_events(vec![old, newer.clone()]).unwrap(), 1); // id=2만 추가
        assert_eq!(s.events().iter().find(|e| e.id == "1").unwrap().title, "현재");
        assert_eq!(s.merge_events(vec![newest, newer]).unwrap(), 1); // id=1만 교체
        assert_eq!(s.events().iter().find(|e| e.id == "1").unwrap().title, "더 최근 백업");
    }

    #[test]
    fn fired_keys_are_recorded_once_and_persisted() {
        let dir = tmp();
        let s = Store::load(dir.clone());
        assert!(s.mark_fired("a|1"));
        assert!(!s.mark_fired("a|1"));
        assert!(!Store::load(dir).mark_fired("a|1"));
    }

    #[test]
    fn settings_are_clamped_and_old_files_load() {
        let dir = tmp();
        let s = Store::load(dir.clone());
        let saved = s
            .set_settings(Settings { opacity: 5.0, month_mode: "x".into(), week_start: 9, view: "?".into(), sync_minutes: 99999, ..Default::default() })
            .unwrap();
        assert_eq!((saved.opacity, saved.month_mode.as_str(), saved.week_start, saved.view.as_str(), saved.sync_minutes), (1.0, "month", 1, "month", 1440));
        let json = serde_json::to_string(&saved).unwrap();
        assert!(json.contains("monthMode") && json.contains("syncMinutes") && json.contains("notifyEnabled"));

        // 1단계에서 저장된 예전 파일(새 필드 없음)도 읽혀야 한다.
        fs::write(dir.join("settings.json"), r#"{"opacity":0.5,"monthMode":"rolling","weekStart":1}"#).unwrap();
        fs::write(dir.join("events.json"), r##"[{"id":"9","title":"t","startDate":"2026-01-01","endDate":"2026-01-01","color":"#fff","reminders":[10],"calendarId":"local","updatedAt":1,"deleted":false}]"##).unwrap();
        let s2 = Store::load(dir);
        assert_eq!((s2.settings().opacity, s2.settings().view.as_str(), s2.settings().sync_minutes), (0.5, "month", 15));
        assert_eq!(s2.events().len(), 1);
        assert!(!s2.events()[0].read_only);
    }

    #[test]
    fn corrupt_file_is_set_aside_not_overwritten() {
        let dir = tmp();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("events.json"), "{깨짐").unwrap();
        let s = Store::load(dir.clone());
        assert_eq!(s.events().len(), 0);
        assert!(dir.join("events.json.corrupt").exists());
    }

    #[test]
    fn remove_account_removes_its_events_only() {
        let s = Store::load(tmp());
        s.add_account(Account { id: "acc".into(), kind: "ics".into(), ..Default::default() }).unwrap();
        s.upsert(ev("l", "로컬")).unwrap();
        let mut r = ev("x", "구독");
        r.calendar_id = "acc".into();
        s.mutate_events(|l| l.push(r)).unwrap();
        s.remove_account("acc").unwrap();
        assert_eq!(s.accounts().len(), 0);
        assert_eq!(s.events().iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["l"]);
    }
}
