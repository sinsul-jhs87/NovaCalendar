//! 플로우(flow.team) 캘린더: "일정 범위 조회" API로 일정을 읽어 온다(읽기 전용).
//!
//! - 인증: 요청 헤더 `x-flow-api-key` (플로우 키 관리 페이지에서 발급)
//! - 캘린더 목록: GET /user/calendars  → 수정 가능 / 읽기 전용 / 프로젝트 캘린더
//! - 일정 범위:   GET /user/calendars/events?startDateTime&endDateTime&cursor&pageSize  (100건씩, hasNext·lastCursor로 다음 장)
//! - 날짜·시간 형식: YYYYMMDDHHmmss
//! - 응답은 {"response": {...}} 로 감싸져 올 수 있다(문서 예시 기준). 둘 다 받는다.

use super::{fmt_date, http_client, reconcile, window};
use crate::store::{Account, Event, Store};
use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use serde_json::Value;

pub const BASE: &str = "https://api.flow.team";

/// 시험용으로 서버 주소를 바꿀 수 있다(WC_FLOW_BASE).
fn base() -> String {
    std::env::var("WC_FLOW_BASE").unwrap_or_else(|_| BASE.to_string())
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FlowCalendar {
    pub id: String,
    pub name: String,
    pub color: String,
    /// "수정 가능" | "읽기 전용" | "프로젝트"
    pub group: String,
}

/// 문자열이든 숫자든 문자열로
fn sval(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// "4F8EF7" → "#4f8ef7"
fn hex(v: &Value) -> Option<String> {
    let s = sval(v);
    let h = s.trim_start_matches('#');
    (h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit())).then(|| format!("#{}", h.to_lowercase()))
}

fn api_error(v: &Value, status: u16) -> String {
    let code = v["error"]["code"].as_str().unwrap_or("");
    let msg = v["error"]["message"].as_str().or_else(|| v["message"].as_str()).unwrap_or("").trim();
    let hint = if code == "UNAUTHORIZED_ERROR" || status == 401 {
        "플로우 API 키가 올바르지 않습니다. 플로우의 키 관리 페이지에서 발급한 키를 그대로 넣었는지 확인해 주세요."
    } else if status == 403 {
        "이 API 키로는 캘린더에 접근할 권한이 없습니다."
    } else if status == 429 {
        "플로우 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
    } else {
        ""
    };
    match (hint.is_empty(), msg.is_empty() || msg == "success") {
        (false, false) => format!("{hint} (원문: {msg})"),
        (false, true) => hint.to_string(),
        (true, false) => format!("플로우 오류: {msg}"),
        (true, true) => format!("플로우 서버 오류 (HTTP {status})"),
    }
}

async fn get(key: &str, path: &str, query: &[(&str, String)]) -> Result<Value, String> {
    let client = http_client(false)?;
    let res = client
        .get(format!("{}{}", base(), path))
        .header("x-flow-api-key", key)
        .header("Content-Type", "application/json")
        .query(query)
        .send()
        .await
        .map_err(|e| format!("플로우 서버에 연결할 수 없습니다. 인터넷 연결·프록시·방화벽을 확인해 주세요. ({e})"))?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    // 플로우 문서의 응답 예시는 {"response": {success, code, message, data|error}} 처럼 한 겹 더 감싸져 있다.
    // 감싼 형태와 감싸지 않은 형태를 모두 받는다.
    let v = if v["response"].is_object() { v["response"].clone() } else { v };
    let status = if status < 400 { v["code"].as_u64().map(|c| c as u16).filter(|c| *c >= 400).unwrap_or(status) } else { status };
    if status >= 400 || v["success"].as_bool() == Some(false) || !v["error"].is_null() && v["data"].is_null() {
        return Err(api_error(&v, status));
    }
    Ok(v)
}

/// 캘린더 목록(키 확인을 겸한다)
pub async fn calendars(key: &str) -> Result<Vec<FlowCalendar>, String> {
    let v = get(key, "/user/calendars", &[]).await?;
    let d = &v["data"];
    let mut out: Vec<FlowCalendar> = Vec::new();
    for (field, group) in [("editableCalendars", "수정 가능"), ("viewOnlyCalendars", "읽기 전용"), ("projectCalendars", "프로젝트")] {
        let Some(arr) = d[field].as_array() else { continue };
        for c in arr {
            let id = sval(&c["calendarSrno"]);
            if id.is_empty() || out.iter().any(|x| x.id == id) {
                continue;
            }
            let name = ["customCalendarName", "calendarName"]
                .iter()
                .map(|k| sval(&c[*k]))
                .find(|s| !s.is_empty())
                .unwrap_or_else(|| format!("캘린더 {id}"));
            out.push(FlowCalendar { id, name, color: hex(&c["calendarColor"]).unwrap_or_default(), group: group.into() });
        }
    }
    Ok(out)
}

/// 기간 안의 일정을 모두 받는다(100건씩 다음 장까지).
pub async fn events(key: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<Value>, String> {
    let (s, e) = (format!("{}000000", from.format("%Y%m%d")), format!("{}235959", to.format("%Y%m%d")));
    let mut cursor = "0".to_string();
    let mut all = Vec::new();
    for _ in 0..300 {
        let v = get(key, "/user/calendars/events", &[("startDateTime", s.clone()), ("endDateTime", e.clone()), ("cursor", cursor.clone()), ("pageSize", "100".into())]).await?;
        let d = &v["data"];
        if let Some(arr) = d["events"].as_array() {
            all.extend(arr.iter().cloned());
        }
        let next = d["hasNext"].as_bool().unwrap_or(false);
        let last = sval(&d["lastCursor"]);
        if !next || last.is_empty() || last == "-1" || last == cursor {
            break;
        }
        cursor = last;
    }
    Ok(all)
}

fn parse_dt(s: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s.trim(), "%Y%m%d%H%M%S").ok()
}

/// 본문에 섞여 올 수 있는 HTML 태그를 걷어 낸다.
fn plain(s: &str) -> String {
    let mut out = String::new();
    let mut tag = false;
    for ch in s.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n").chars() {
        match ch {
            '<' => tag = true,
            '>' if tag => tag = false,
            _ if !tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").trim().to_string()
}

/// 플로우 일정 하나 → NovaCalendar 일정
pub fn to_event(v: &Value, acc: &Account) -> Option<Event> {
    let st = parse_dt(&sval(&v["eventStartDateTime"]))?;
    let fin = parse_dt(&sval(&v["eventFinishDateTime"])).unwrap_or(st).max(st);
    let all_day = sval(&v["allDayYn"]).eq_ignore_ascii_case("Y");
    let start_date = st.date();
    let mut end_date = fin.date();
    // 다음 날 00:00:00 으로 끝나는 일정은 그 전날까지로 본다(종일 일정이 하루 더 길어지지 않게).
    if fin > st && fin.time() == NaiveTime::MIN && end_date > start_date {
        end_date -= Duration::days(1);
    }
    let srno = sval(&v["eventSrno"]);
    if srno.is_empty() {
        return None;
    }
    // 반복 일정은 날짜마다 따로 온다: 일정 번호 + 반복 인스턴스(없으면 시작일시)로 구분
    let inst = sval(&v["repeatInstanceId"]);
    let rid = if !inst.is_empty() {
        format!("{srno}#{inst}")
    } else if !sval(&v["repeatSrno"]).is_empty() {
        format!("{srno}#{}", st.format("%Y%m%d%H%M%S"))
    } else {
        srno
    };
    let title = sval(&v["eventName"]);
    let mut memo = plain(&sval(&v["eventBody"]));
    let loc = sval(&v["location"]);
    if !loc.is_empty() {
        memo = if memo.is_empty() { format!("장소: {loc}") } else { format!("{memo}\n장소: {loc}") };
    }
    Some(Event {
        title: if title.is_empty() { "(제목 없음)".into() } else { title },
        start_date: fmt_date(start_date),
        end_date: fmt_date(end_date),
        all_day,
        start_time: (!all_day).then(|| st.format("%H:%M").to_string()),
        end_time: (!all_day).then(|| fin.format("%H:%M").to_string()),
        memo,
        color: hex(&v["eventColor"]).or_else(|| hex(&v["calendarColor"])).unwrap_or_else(|| acc.color.clone()),
        calendar_id: acc.id.clone(),
        remote_id: Some(rid),
        read_only: true,
        ..Default::default()
    })
}

/// 계정에 고른 캘린더(비어 있으면 전부)의 일정을 받아 이 PC와 맞춘다.
pub async fn sync(store: &Store, acc: &Account) -> Result<(), String> {
    let (ws, we) = window();
    let raw = events(&acc.password, ws, we).await?;
    let remote: Vec<Event> = raw
        .iter()
        .filter(|v| acc.calendars.is_empty() || acc.calendars.iter().any(|c| *c == sval(&v["calendarSrno"])))
        .filter_map(|v| to_event(v, acc))
        .collect();
    reconcile(store, &acc.id, remote, ws, we)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn unwraps_response_envelope() {
        let wrapped = json!({"response": {"success": true, "code": 200, "message": "success", "data": {"hasNext": false}}});
        let v = if wrapped["response"].is_object() { wrapped["response"].clone() } else { wrapped };
        assert_eq!(v["data"]["hasNext"], json!(false));
    }

    #[test]
    fn maps_flow_event() {
        let acc = Account { id: "f".into(), color: "#123456".into(), ..Default::default() };
        let e = to_event(&json!({"eventSrno":"9","calendarSrno":"1","eventName":"주간 회의","eventBody":"<p>안건</p>","eventStartDateTime":"20260510100000","eventFinishDateTime":"20260510110000","allDayYn":"N","eventColor":"FF5733","location":"회의실 A","repeatSrno":"","repeatInstanceId":""}), &acc).unwrap();
        assert_eq!((e.start_date.as_str(), e.start_time.as_deref(), e.end_time.as_deref(), e.color.as_str()), ("2026-05-10", Some("10:00"), Some("11:00"), "#ff5733"));
        assert_eq!(e.memo, "안건\n장소: 회의실 A");
        let a = to_event(&json!({"eventSrno":"10","eventName":"휴가","eventStartDateTime":"20260512000000","eventFinishDateTime":"20260514000000","allDayYn":"Y"}), &acc).unwrap();
        assert_eq!((a.start_date.as_str(), a.end_date.as_str(), a.all_day), ("2026-05-12", "2026-05-13", true));
        let b = to_event(&json!({"eventSrno":"11","eventName":"출장","eventStartDateTime":"20260512000000","eventFinishDateTime":"20260513235959","allDayYn":"Y"}), &acc).unwrap();
        assert_eq!(b.end_date, "2026-05-13");
    }
}
