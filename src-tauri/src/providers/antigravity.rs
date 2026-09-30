//! Antigravity (IDE and CLI): `~/.gemini/antigravity*/`.
//!
//! - `conversation_summaries.db`: one row per conversation (title, run status, workspace,
//!   parent conversation).
//! - `conversations/<id>.db` (+ `-wal`/`-shm`): the conversation's `steps`, one protobuf
//!   message per step. There is no published schema; the few fields read here were
//!   identified from the files themselves:
//!
//! | step type | meaning        | fields used                                               |
//! |-----------|----------------|-----------------------------------------------------------|
//! | 14        | user prompt    | 19 → 2: text                                              |
//! | 15        | model turn     | 20 → 3: text, 20 → 7 (repeated): tool call {2 name, 3 JSON args} |
//! | 132       | tool execution | status 7 = failed, 31 → 2: error message                  |
//! | 101       | notification   | 114 → 2 → 1: text (e.g. a background task finished)       |
//!
//! Every step has 5 → 1 → {1: seconds, 2: nanos}, its creation time.

use crate::model::{Activity, Kind, Session};
use crate::util::{clean_prompt, clip, summarize_args};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

/// Step statuses that will not change any more: done, continued in the background, failed.
const FINAL: [i64; 3] = [3, 6, 7];

#[derive(Debug, Default, Clone)]
pub struct Summary {
    pub title: String,
    pub status: String,
    pub workspace: Option<String>,
    pub last_modified: i64,
    pub parent: Option<String>,
    pub killed: bool,
    pub steps: i64,
}

/// What has been read so far from one conversation.
#[derive(Debug, Default)]
pub struct Cursor {
    /// Highest step index already applied.
    pub idx: i64,
    /// Run status seen on the previous refresh.
    pub run_status: String,
}

impl Cursor {
    pub fn new() -> Self {
        Cursor { idx: -1, run_status: String::new() }
    }
}

/// Opens a database for reading without creating files next to it. SQLite creates `-wal`
/// and `-shm` files even for read-only readers of a WAL database; when there is no `-wal`
/// there is nothing uncommitted to see, so the database is opened `immutable` instead.
fn open(db: &Path) -> Option<Connection> {
    let mut flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = if wal_path(db).exists() {
        Connection::open_with_flags(db, flags).ok()?
    } else {
        flags |= OpenFlags::SQLITE_OPEN_URI;
        Connection::open_with_flags(immutable_uri(db), flags).ok()?
    };
    conn.busy_timeout(Duration::from_millis(250)).ok()?;
    Some(conn)
}

pub fn wal_path(db: &Path) -> std::path::PathBuf {
    let mut name = db.as_os_str().to_owned();
    name.push("-wal");
    name.into()
}

/// `C:\a b\x.db` → `file:///C:/a%20b/x.db?immutable=1`
fn immutable_uri(db: &Path) -> String {
    let path = db.to_string_lossy().replace('\\', "/");
    let mut out = String::from("file://");
    if !path.starts_with('/') {
        out.push('/');
    }
    for ch in path.chars() {
        match ch {
            '%' => out.push_str("%25"),
            '?' => out.push_str("%3F"),
            '#' => out.push_str("%23"),
            ' ' => out.push_str("%20"),
            c => out.push(c),
        }
    }
    out.push_str("?immutable=1");
    out
}

/// Reads one conversation's row from `conversation_summaries.db` (read-only; the app
/// keeps writing to it in WAL mode, which does not block readers).
pub fn read_summary(db: &Path, id: &str) -> Option<Summary> {
    let conn = open(db)?;
    conn.query_row(
        "SELECT title, status, workspace_uris, last_modified_time, parent_conversation_id, killed, step_count
         FROM conversation_summaries WHERE conversation_id = ?1",
        [id],
        |row| {
            let text = |i: usize| -> String {
                match row.get_ref(i) {
                    Ok(ValueRef::Text(t)) => String::from_utf8_lossy(t).into_owned(),
                    _ => String::new(),
                }
            };
            let truthy = match row.get_ref(5) {
                Ok(ValueRef::Integer(n)) => n != 0,
                Ok(ValueRef::Text(t)) => matches!(t, b"1" | b"true" | b"TRUE"),
                _ => false,
            };
            Ok(Summary {
                title: text(0),
                status: text(1),
                workspace: first_workspace(&text(2)),
                last_modified: crate::util::parse_rfc3339(&text(3)).unwrap_or(0),
                parent: Some(text(4)).filter(|p| !p.is_empty()),
                killed: truthy,
                steps: row.get::<_, i64>(6).unwrap_or(0),
            })
        },
    )
    .ok()
}

/// `["file:///c%3A/code/app"]` → `C:\code\app` (native separators, so it groups with other agents).
fn first_workspace(uris: &str) -> Option<String> {
    let list: Vec<String> = serde_json::from_str(uris).ok()?;
    let uri = list.into_iter().find(|u| !u.is_empty())?;
    Some(crate::util::native_path(&crate::providers::vscode::decode_uri(&uri)))
}

pub struct StepRow {
    pub idx: i64,
    pub kind: i64,
    pub status: i64,
    pub payload: Vec<u8>,
}

/// Steps after `after`, oldest first.
pub fn read_steps(db: &Path, after: i64) -> Vec<StepRow> {
    let Some(conn) = open(db) else { return Vec::new() };
    let Ok(mut stmt) = conn.prepare(
        "SELECT idx, step_type, status, step_payload FROM steps WHERE idx > ?1 ORDER BY idx LIMIT 5000",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([after], |r| {
        let payload = match r.get_ref(3)? {
            ValueRef::Blob(b) => b.to_vec(),
            _ => Vec::new(),
        };
        Ok(StepRow { idx: r.get(0)?, kind: r.get(1)?, status: r.get(2)?, payload })
    });
    match rows {
        Ok(rows) => rows.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

/// Brings the session up to date: metadata from the summary, new steps, then the run status.
pub fn refresh(sess: &mut Session, cursor: &mut Cursor, summaries: &Path, conversation: &Path, activity: i64) {
    let Some(sum) = read_summary(summaries, &sess.id) else {
        // Older conversations (e.g. `.pb` files) have no summary row: file activity only.
        sess.presence_only = sess.events.is_empty();
        return;
    };
    sess.presence_only = false;
    if !sum.title.is_empty() {
        sess.title = Some(sum.title.clone());
    }
    if sum.workspace.is_some() {
        sess.cwd = sum.workspace.clone();
    }
    if let Some(parent) = sum.parent.clone() {
        sess.parent = Some(parent);
        sess.role = Some("subagent".into());
    }

    for row in read_steps(conversation, cursor.idx) {
        // A step still being written (e.g. a streaming model turn) is read once it is final.
        if !FINAL.contains(&row.status) {
            break;
        }
        apply_step(sess, &row);
        cursor.idx = row.idx;
    }

    let status = sum.status.to_ascii_uppercase();
    // While running, recent file writes are activity; a finished turn is dated by Antigravity.
    let ts = sum.last_modified.max(activity);
    let finished_at = sum.last_modified.max(sess.last_ts);
    if sum.killed {
        if !sess.ended {
            sess.push(Activity::new(finished_at, Kind::Done, "Stopped"));
            sess.ended = true;
        }
    } else if status.contains("RUNNING") {
        sess.ended = false;
        if sess.events.is_empty() {
            sess.push(Activity::new(ts, Kind::Think, "Running"));
        }
        sess.turn_open = true;
        sess.touch(ts);
    } else if status.is_empty() {
        sess.presence_only = sess.events.is_empty();
        sess.touch(ts);
    } else if sess.turn_open && sum.last_modified + 1000 >= sess.last_ts {
        // Finished (IDLE and similar). Only trust the summary once it is at least as new as
        // the latest step, so a fresh prompt is not immediately marked as done.
        let steps = if sum.steps > 0 { format!("{} steps", sum.steps) } else { String::new() };
        sess.push(Activity::new(finished_at, Kind::Done, steps));
    }
    cursor.run_status = status;
}

fn apply_step(sess: &mut Session, row: &StepRow) {
    let p = row.payload.as_slice();
    let ts = step_time(p).unwrap_or(0);
    match row.kind {
        14 => {
            let text = msg(p, 19).and_then(|m| string(m, 2)).unwrap_or_default();
            match clean_prompt(&text) {
                Some(t) => sess.push(Activity::new(ts, Kind::User, t)),
                None => sess.touch(ts),
            }
        }
        15 => {
            let Some(m) = msg(p, 20) else { return sess.touch(ts) };
            let text = string(m, 3).unwrap_or_default();
            let calls: Vec<&[u8]> = messages(m, 7).collect();
            if calls.is_empty() {
                if text.trim().is_empty() {
                    sess.push(Activity::new(ts, Kind::Think, ""));
                } else {
                    sess.push(Activity::new(ts, Kind::Reply, clip(&text, 160)));
                }
                return;
            }
            if !text.trim().is_empty() {
                sess.push(Activity::new(ts, Kind::Think, clip(&text, 140)));
            }
            for call in calls {
                let name = string(call, 2).unwrap_or_else(|| "tool".into());
                let args: Value = string(call, 3)
                    .and_then(|a| serde_json::from_str(&a).ok())
                    .unwrap_or(Value::Null);
                // Antigravity writes a human summary into every call ("List workspace files").
                let summary = args.get("toolSummary").and_then(Value::as_str).filter(|s| !s.is_empty());
                let text = summary.map(|s| clip(s, 110)).unwrap_or_else(|| summarize_args(&args));
                sess.push(Activity::tool(ts, &name, text));
            }
        }
        132 => {
            if row.status == 7 {
                let err = msg(p, 31).and_then(|m| string(m, 2)).unwrap_or_else(|| "A tool call failed".into());
                sess.push(Activity::new(ts, Kind::Error, clip(&err, 120)));
            } else {
                sess.touch(ts);
            }
        }
        101 => {
            match msg(p, 114).and_then(|m| msg(m, 2)).and_then(|m| string(m, 1)) {
                Some(t) if !t.trim().is_empty() => sess.push(Activity::new(ts, Kind::System, clip(&t, 120))),
                _ => sess.touch(ts),
            }
        }
        _ => sess.touch(ts),
    }
}

// ---------------------------------------------------------------- minimal protobuf reader

enum Wire<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Fixed,
}

fn varint(buf: &[u8], i: &mut usize) -> Option<u64> {
    let mut v = 0u64;
    for shift in (0..64).step_by(7) {
        let b = *buf.get(*i)?;
        *i += 1;
        v |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Some(v);
        }
    }
    None
}

/// Iterates `(field number, value)` pairs of one message; stops quietly at malformed input.
fn fields(buf: &[u8]) -> impl Iterator<Item = (u64, Wire<'_>)> {
    let mut i = 0usize;
    std::iter::from_fn(move || {
        if i >= buf.len() {
            return None;
        }
        let key = varint(buf, &mut i)?;
        let value = match key & 7 {
            0 => Wire::Varint(varint(buf, &mut i)?),
            1 => {
                i = i.checked_add(8).filter(|&n| n <= buf.len())?;
                Wire::Fixed
            }
            2 => {
                let len = usize::try_from(varint(buf, &mut i)?).ok()?;
                let end = i.checked_add(len).filter(|&n| n <= buf.len())?;
                let bytes = &buf[i..end];
                i = end;
                Wire::Bytes(bytes)
            }
            5 => {
                i = i.checked_add(4).filter(|&n| n <= buf.len())?;
                Wire::Fixed
            }
            _ => return None,
        };
        Some((key >> 3, value))
    })
}

fn messages(buf: &[u8], field: u64) -> impl Iterator<Item = &[u8]> {
    fields(buf).filter_map(move |(f, v)| match v {
        Wire::Bytes(b) if f == field => Some(b),
        _ => None,
    })
}

fn msg(buf: &[u8], field: u64) -> Option<&[u8]> {
    messages(buf, field).next()
}

fn string(buf: &[u8], field: u64) -> Option<String> {
    msg(buf, field).map(|b| String::from_utf8_lossy(b).into_owned())
}

fn number(buf: &[u8], field: u64) -> Option<u64> {
    fields(buf).find_map(|(f, v)| match v {
        Wire::Varint(n) if f == field => Some(n),
        _ => None,
    })
}

/// 5 → 1 → {1: seconds, 2: nanos} as Unix milliseconds.
fn step_time(payload: &[u8]) -> Option<i64> {
    let t = msg(msg(payload, 5)?, 1)?;
    let secs = i64::try_from(number(t, 1)?).ok()?;
    let nanos = number(t, 2).unwrap_or(0) as i64;
    Some(secs * 1000 + nanos / 1_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Station, Status};

    // Tiny protobuf writer for building fixtures.
    fn put_varint(out: &mut Vec<u8>, mut v: u64) {
        loop {
            let b = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                return;
            }
            out.push(b | 0x80);
        }
    }
    fn num(field: u64, v: u64) -> Vec<u8> {
        let mut out = Vec::new();
        put_varint(&mut out, field << 3);
        put_varint(&mut out, v);
        out
    }
    fn bytes(field: u64, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        put_varint(&mut out, (field << 3) | 2);
        put_varint(&mut out, data.len() as u64);
        out.extend_from_slice(data);
        out
    }
    fn step(kind: u64, secs: u64, body: Vec<u8>) -> Vec<u8> {
        let time = [num(1, secs), num(2, 500_000_000)].concat();
        [num(1, kind), num(4, 3), bytes(5, &bytes(1, &time)), body].concat()
    }
    fn prompt(secs: u64, text: &str) -> Vec<u8> {
        step(14, secs, bytes(19, &bytes(2, text.as_bytes())))
    }
    fn tool_call(secs: u64, thought: &str, name: &str, args: &str) -> Vec<u8> {
        let call = [bytes(1, b"call_1"), bytes(2, name.as_bytes()), bytes(3, args.as_bytes())].concat();
        step(15, secs, bytes(20, &[bytes(3, thought.as_bytes()), bytes(7, &call)].concat()))
    }
    fn reply(secs: u64, text: &str) -> Vec<u8> {
        step(15, secs, bytes(20, &bytes(3, text.as_bytes())))
    }
    fn failed_tool(secs: u64, error: &str) -> Vec<u8> {
        step(132, secs, bytes(31, &bytes(2, error.as_bytes())))
    }

    struct Fixture {
        dir: std::path::PathBuf,
        summaries: std::path::PathBuf,
        conversation: std::path::PathBuf,
    }

    impl Fixture {
        fn new(name: &str, status: &str, modified: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("agent-tally-ag-{}-{}", name, std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let summaries = dir.join("conversation_summaries.db");
            let conn = Connection::open(&summaries).unwrap();
            conn.execute_batch(
                "CREATE TABLE conversation_summaries (conversation_id text, title text, status text, workspace_uris text,
                   last_modified_time datetime, parent_conversation_id text, killed numeric, step_count integer);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO conversation_summaries VALUES ('c1', 'Fix broken links', ?1, '[\"file:///c%3A/code/docs\"]', ?2, '', 0, 4)",
                [status, modified],
            )
            .unwrap();
            let conversation = dir.join("c1.db");
            Connection::open(&conversation)
                .unwrap()
                .execute_batch("CREATE TABLE steps (idx integer primary key, step_type integer, status integer, step_payload blob);")
                .unwrap();
            Fixture { dir, summaries, conversation }
        }

        fn add(&self, idx: i64, kind: i64, status: i64, payload: Vec<u8>) {
            Connection::open(&self.conversation)
                .unwrap()
                .execute("INSERT INTO steps VALUES (?1, ?2, ?3, ?4)", rusqlite::params![idx, kind, status, payload])
                .unwrap();
        }

        fn set_status(&self, status: &str, modified: &str) {
            Connection::open(&self.summaries)
                .unwrap()
                .execute("UPDATE conversation_summaries SET status = ?1, last_modified_time = ?2", [status, modified])
                .unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    const T0: u64 = 1_790_780_000; // 2026-09-30T14:53:20Z

    #[test]
    fn steps_become_a_timeline_of_prompts_tools_and_replies() {
        let fx = Fixture::new("timeline", "CASCADE_RUN_STATUS_RUNNING", "2026-09-30 14:53:40+00:00");
        fx.add(0, 14, 3, prompt(T0, "Fix the broken links"));
        fx.add(1, 15, 3, tool_call(T0 + 5, "First, list the files.", "run_command",
            r#"{"CommandLine":"Get-ChildItem -Recurse","toolSummary":"List workspace files"}"#));
        fx.add(2, 132, 3, step(132, T0 + 6, Vec::new()));
        fx.add(3, 15, 3, tool_call(T0 + 8, "", "view_file", r#"{"AbsolutePath":"C:\\code\\docs\\index.md"}"#));
        fx.add(4, 132, 7, failed_tool(T0 + 9, "file not found"));
        // Still streaming: must not be read yet.
        fx.add(5, 15, 1, reply(T0 + 10, "partial"));

        let mut sess = Session::new("antigravity", "c1");
        let mut cursor = Cursor::new();
        refresh(&mut sess, &mut cursor, &fx.summaries, &fx.conversation, 0);

        let kinds: Vec<_> = sess.events.iter().map(|e| (e.kind, e.text.as_str())).collect();
        assert_eq!(kinds, vec![
            (Kind::User, "Fix the broken links"),
            (Kind::Think, "First, list the files."),
            (Kind::Tool, "List workspace files"),
            (Kind::Tool, "docs/index.md"),
            (Kind::Error, "file not found"),
        ]);
        assert_eq!(sess.events[2].station, Station::Terminal);
        assert_eq!(sess.events[3].station, Station::Library);
        assert_eq!(sess.events[0].ts, T0 as i64 * 1000 + 500);
        assert_eq!(sess.tool_calls, 2);
        assert_eq!(cursor.idx, 4);
        assert_eq!(crate::util::project_name(sess.cwd.as_deref().unwrap()), "docs");
        assert_eq!(sess.status(T0 as i64 * 1000 + 30_000), Status::Working);

        // The streaming step completes and the run finishes: read once, then "your turn".
        Connection::open(&fx.conversation).unwrap()
            .execute("UPDATE steps SET status = 3, step_payload = ?1 WHERE idx = 5", [reply(T0 + 12, "All links fixed.")])
            .unwrap();
        fx.set_status("CASCADE_RUN_STATUS_IDLE", "2026-09-30 14:53:40+00:00");
        refresh(&mut sess, &mut cursor, &fx.summaries, &fx.conversation, 0);
        refresh(&mut sess, &mut cursor, &fx.summaries, &fx.conversation, 0);
        let tail: Vec<_> = sess.events.iter().rev().take(2).map(|e| (e.kind, e.text.as_str())).collect();
        assert_eq!(tail, vec![(Kind::Done, "4 steps"), (Kind::Reply, "All links fixed.")]);
        assert_eq!(sess.status(T0 as i64 * 1000 + 60_000), Status::Waiting);
        assert_eq!(sess.events.len(), 7);
    }

    #[test]
    fn a_new_prompt_is_not_closed_by_a_stale_idle_summary() {
        let fx = Fixture::new("stale", "CASCADE_RUN_STATUS_IDLE", "2026-09-30 14:53:20+00:00");
        fx.add(0, 14, 3, prompt(T0 + 60, "One more thing"));
        let mut sess = Session::new("antigravity", "c1");
        let mut cursor = Cursor::new();
        refresh(&mut sess, &mut cursor, &fx.summaries, &fx.conversation, 0);
        assert!(sess.turn_open, "summary is older than the prompt, so the turn stays open");
    }

    #[test]
    fn malformed_payloads_are_ignored() {
        assert!(step_time(&[0xff, 0xff, 0xff]).is_none());
        assert!(msg(&[0x0a, 0x10, 0x01], 1).is_none()); // length runs past the end
        let mut sess = Session::new("antigravity", "c1");
        apply_step(&mut sess, &StepRow { idx: 0, kind: 15, status: 3, payload: vec![0x0a, 0xff] });
        assert!(sess.events.is_empty());
    }
}

#[cfg(test)]
mod open_tests {
    use super::*;

    #[test]
    fn reading_a_database_without_wal_creates_no_files() {
        let dir = std::env::temp_dir().join(format!("agent-tally-ag-open-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("with space #1.db");
        {
            let conn = Connection::open(&db).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE steps (idx integer primary key, step_type integer, status integer, step_payload blob); INSERT INTO steps VALUES (0, 99, 3, x'');").unwrap();
        } // closing the last connection checkpoints and removes -wal / -shm
        assert!(!wal_path(&db).exists());
        assert_eq!(read_steps(&db, -1).len(), 1);
        let names: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(names, vec!["with space #1.db".to_string()]);
    }
}
