//! 반복 일정: 반복 규칙에서 날짜를 펼친다. (화면 표시는 자바스크립트에서 같은 규칙으로, 알림은 여기서 계산)
//! 매월·매년 반복에서 그 달에 같은 날짜가 없으면(31일, 2월 29일) 그 달은 건너뛴다(iCalendar와 같은 규칙).

use crate::store::Event;
use chrono::{Datelike, Duration, NaiveDate};

/// 같은 날짜 번호로 n개월 뒤. 그 달에 그 날이 없으면 None.
fn add_months(d: NaiveDate, n: i64) -> Option<NaiveDate> {
    let total = d.year() as i64 * 12 + d.month0() as i64 + n;
    let (y, m0) = (total.div_euclid(12), total.rem_euclid(12));
    NaiveDate::from_ymd_opt(y as i32, m0 as u32 + 1, d.day())
}

/// [from, to] 구간에 걸치는 일정의 시작 날짜들. 반복이 없으면 원래 시작일 하나(구간에 걸칠 때만).
pub fn occurrence_starts(ev: &Event, from: NaiveDate, to: NaiveDate) -> Vec<NaiveDate> {
    let Ok(start) = NaiveDate::parse_from_str(&ev.start_date, "%Y-%m-%d") else { return vec![] };
    let end = NaiveDate::parse_from_str(&ev.end_date, "%Y-%m-%d").unwrap_or(start).max(start);
    let span = (end - start).num_days();
    let Some(rep) = ev.repeat.as_ref() else {
        return if start <= to && end >= from { vec![start] } else { vec![] };
    };
    let until = rep.until.as_deref().and_then(|u| NaiveDate::parse_from_str(u, "%Y-%m-%d").ok());
    let step = rep.interval.max(1) as i64;
    let mut k: i64 = 0;
    // 매일·매주는 구간 바로 앞까지 건너뛴다.
    let period = match rep.freq.as_str() {
        "daily" => Some(step),
        "weekly" => Some(7 * step),
        _ => None,
    };
    if let Some(p) = period {
        let gap = (from - start).num_days() - span;
        if gap > 0 {
            k = gap / p;
        }
    }
    let mut out = Vec::new();
    let mut guard = 0;
    while guard < 20000 {
        guard += 1;
        let d = match rep.freq.as_str() {
            "daily" | "weekly" => Some(start + Duration::days(k * period.unwrap_or(1))),
            "monthly" => add_months(start, k * step),
            "yearly" => add_months(start, 12 * k * step),
            _ => None,
        };
        k += 1;
        let Some(d) = d else {
            if rep.freq == "monthly" || rep.freq == "yearly" {
                // 그 달에 같은 날이 없음: 건너뛴다. 단 구간을 한참 지나면 멈춘다.
                if add_months(start, (k - 1) * step * if rep.freq == "yearly" { 12 } else { 1 }).is_none()
                    && NaiveDate::from_ymd_opt(start.year() + ((k - 1) * step * if rep.freq == "yearly" { 12 } else { 1 } / 12) as i32, 1, 1).map_or(true, |x| x > to)
                {
                    break;
                }
                continue;
            }
            if out.is_empty() && start <= to && end >= from {
                out.push(start);
            }
            break;
        };
        if until.map_or(false, |u| d > u) || d > to {
            break;
        }
        if d + Duration::days(span) >= from {
            out.push(d);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Repeat;
    fn ev(start: &str, freq: &str, interval: u32, until: Option<&str>) -> Event {
        Event {
            id: "r".into(),
            title: "t".into(),
            start_date: start.into(),
            end_date: start.into(),
            repeat: Some(Repeat { freq: freq.into(), interval, until: until.map(|s| s.into()) }),
            ..Default::default()
        }
    }
    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    #[test]
    fn weekly_and_monthly_and_until() {
        let w = occurrence_starts(&ev("2026-10-05", "weekly", 1, None), d("2026-10-01"), d("2026-10-31"));
        assert_eq!(w, vec![d("2026-10-05"), d("2026-10-12"), d("2026-10-19"), d("2026-10-26")]);
        let m = occurrence_starts(&ev("2026-01-31", "monthly", 1, None), d("2026-01-01"), d("2026-05-31"));
        assert_eq!(m, vec![d("2026-01-31"), d("2026-03-31"), d("2026-05-31")]);
        let u = occurrence_starts(&ev("2026-10-01", "daily", 2, Some("2026-10-07")), d("2026-10-01"), d("2026-10-31"));
        assert_eq!(u, vec![d("2026-10-01"), d("2026-10-03"), d("2026-10-05"), d("2026-10-07")]);
    }
}
