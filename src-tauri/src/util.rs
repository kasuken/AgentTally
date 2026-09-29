//! Small helpers shared by the log parsers: time, JSON access, text cleanup.

use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parses RFC 3339 timestamps such as `2026-09-29T10:59:25.820Z` or
/// `2026-09-28T15:59:31.371+02:00` into Unix milliseconds.
pub fn parse_rfc3339(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, se) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let mut i = 19;
    let mut ms = 0i64;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let frac = &s[start..i];
        let digits: String = frac.chars().chain("000".chars()).take(3).collect();
        ms = digits.parse().unwrap_or(0);
    }
    let offset_min = match b.get(i) {
        Some(b'+') | Some(b'-') => {
            let sign = if b[i] == b'-' { -1 } else { 1 };
            let oh = num(i + 1..i + 3).unwrap_or(0);
            let om = num(i + 4..i + 6).unwrap_or(0);
            sign * (oh * 60 + om)
        }
        _ => 0,
    };
    let secs = days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se - offset_min * 60;
    Some(secs * 1000 + ms)
}

/// Reads a timestamp that may be an RFC 3339 string or epoch seconds/millis.
pub fn ts_of(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::String(s)) => parse_rfc3339(s).unwrap_or(0),
        Some(Value::Number(n)) => {
            let n = n.as_f64().unwrap_or(0.0) as i64;
            if n < 100_000_000_000 {
                n * 1000
            } else {
                n
            }
        }
        _ => 0,
    }
}

pub fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

pub fn path_str<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cur = v;
    for p in path {
        cur = cur.get(*p)?;
    }
    cur.as_str()
}

pub fn u64_at(v: &Value, path: &[&str]) -> u64 {
    let mut cur = v;
    for p in path {
        match cur.get(*p) {
            Some(n) => cur = n,
            None => return 0,
        }
    }
    cur.as_u64().unwrap_or(0)
}

/// Collapses whitespace and cuts to `max` characters with an ellipsis.
pub fn clip(text: &str, max: usize) -> String {
    let mut out = String::with_capacity(max.min(text.len()));
    let mut count = 0;
    let mut last_space = true;
    for ch in text.chars() {
        let ch = if ch.is_whitespace() { ' ' } else { ch };
        if ch == ' ' && last_space {
            continue;
        }
        last_space = ch == ' ';
        if count == max {
            out.push('…');
            return out.trim_end().to_string();
        }
        out.push(ch);
        count += 1;
    }
    out.trim_end().to_string()
}

/// Keeps the last two components of a path, e.g. `src/main.rs`.
pub fn short_path(p: &str) -> String {
    let p = p.trim_end_matches(['/', '\\']);
    let parts: Vec<&str> = p.split(['/', '\\']).filter(|x| !x.is_empty()).collect();
    match parts.len() {
        0 => p.to_string(),
        1 => parts[0].to_string(),
        n => format!("{}/{}", parts[n - 2], parts[n - 1]),
    }
}

/// Last path component, used as the project name for a working directory.
pub fn project_name(cwd: &str) -> String {
    cwd.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(cwd)
        .to_string()
}

/// Human-readable one-liner for a tool call's arguments.
pub fn summarize_args(args: &Value) -> String {
    let args = match args {
        Value::String(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(v @ Value::Object(_)) => v,
            _ => return clip(raw.lines().next().unwrap_or(""), 110),
        },
        other => other.clone(),
    };
    const KEYS: &[&str] = &[
        "description", "command", "cmd", "file_path", "filePath", "path", "notebook_path",
        "pattern", "query", "url", "prompt", "subject", "question", "intent", "skill", "name",
    ];
    for key in KEYS {
        if let Some(v) = args.get(*key) {
            let text = match v {
                Value::String(t) => t.clone(),
                Value::Array(a) => a
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" "),
                _ => continue,
            };
            if text.trim().is_empty() {
                continue;
            }
            return if key.contains("path") || key.contains("Path") {
                short_path(&text)
            } else {
                clip(text.lines().next().unwrap_or(&text), 110)
            };
        }
    }
    String::new()
}

/// Turns user prompt text into something readable: drops injected XML-ish
/// context blocks and keeps slash-command names.
pub fn clean_prompt(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(i) = t.find("<command-name>") {
        let rest = &t[i + 14..];
        let name = rest.split("</command-name>").next().unwrap_or(rest);
        let args = t
            .find("<command-args>")
            .map(|j| t[j + 14..].split("</command-args>").next().unwrap_or(""))
            .unwrap_or("");
        return Some(clip(&format!("{} {}", name.trim(), args.trim()), 140));
    }
    let mut kept = String::new();
    let mut depth = 0i32;
    for line in t.lines() {
        let l = line.trim();
        if l.starts_with("</") && l.ends_with('>') {
            depth = (depth - 1).max(0);
            continue;
        }
        if l.starts_with('<') && l.ends_with('>') && !l.contains("</") {
            depth += 1;
            continue;
        }
        if l.starts_with('<') && l.contains("</") {
            continue;
        }
        if depth == 0 && !l.is_empty() {
            kept.push_str(l);
            kept.push(' ');
        }
    }
    let kept = kept.trim();
    if kept.is_empty() {
        None
    } else {
        Some(clip(kept, 140))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_timestamps() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:01.5Z"), Some(1500));
        let a = parse_rfc3339("2026-09-28T15:59:31.371+02:00").unwrap();
        let b = parse_rfc3339("2026-09-28T13:59:31.371Z").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn cleans_prompts() {
        assert_eq!(
            clean_prompt("<command-name>/goal</command-name>\n<command-args>ship it</command-args>").as_deref(),
            Some("/goal ship it")
        );
        assert_eq!(
            clean_prompt("<system-reminder>\nnoise\n</system-reminder>\nFix the bug").as_deref(),
            Some("Fix the bug")
        );
    }

    #[test]
    fn shortens() {
        assert_eq!(short_path("C:\\a\\b\\c.rs"), "b/c.rs");
        assert_eq!(project_name("C:\\_GITHUB_\\LearnStack"), "LearnStack");
    }
}
