//! Antigravity (IDE and CLI): `~/.gemini/antigravity*/`.
//!
//! Each conversation is a SQLite database in `conversations/<id>.db` (with `-wal`/`-shm`
//! companions) whose steps are protobuf blobs. The readable parts live elsewhere:
//! `conversation_summaries.db` has one row per conversation (title, status, workspace,
//! parent) and the CLI's `history.jsonl` has the prompts you typed.

use crate::model::{Activity, Kind, Session};
use crate::util::{clean_prompt, s, ts_of};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

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

/// Reads one conversation's row from `conversation_summaries.db` (read-only; the app
/// keeps writing to it in WAL mode, which does not block readers).
pub fn read_summary(db: &Path, id: &str) -> Option<Summary> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(db, flags).ok()?;
    conn.busy_timeout(Duration::from_millis(250)).ok()?;
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

/// Prompts for this conversation from the CLI's `history.jsonl`: `(timestamp, text)`.
pub fn read_prompts(history: &Path, id: &str) -> Vec<(i64, String)> {
    let Ok(text) = std::fs::read_to_string(history) else { return Vec::new() };
    text.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| s(v, "conversationId") == Some(id))
        .filter_map(|v| Some((ts_of(v.get("timestamp")), s(&v, "display")?.to_string())))
        .collect()
}

/// Rebuilds the session from the summary row, prompts and the latest file activity.
pub fn apply(sess: &mut Session, summary: Option<Summary>, prompts: Vec<(i64, String)>, activity: i64) {
    sess.events.clear();
    sess.first_prompt = None;
    sess.turn_open = false;
    sess.blocked = false;
    sess.ended = false;
    let Some(sum) = summary else {
        // Older conversations (e.g. `.pb` files) have no summary row: file activity only.
        sess.presence_only = true;
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
    for (ts, text) in prompts {
        if let Some(p) = clean_prompt(&text) {
            sess.push(Activity::new(ts, Kind::User, p));
        }
    }
    let ts = sum.last_modified.max(activity);
    let steps = if sum.steps > 0 { format!("{} steps", sum.steps) } else { String::new() };
    let status = sum.status.to_ascii_uppercase();
    if sum.killed {
        sess.push(Activity::new(ts, Kind::Done, "Stopped"));
        sess.ended = true;
    } else if status.contains("RUNNING") {
        let text = if steps.is_empty() { "Running".to_string() } else { format!("Running · {steps}") };
        sess.push(Activity::new(ts, Kind::Think, text));
    } else if status.contains("ERROR") || status.contains("FAIL") {
        sess.push(Activity::new(ts, Kind::Error, "Run failed"));
        sess.push(Activity::new(ts, Kind::Done, ""));
    } else if status.is_empty() {
        sess.presence_only = true;
        sess.touch(ts);
    } else {
        // IDLE and other finished states: the agent handed the turn back.
        sess.push(Activity::new(ts, Kind::Done, steps));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Status;

    fn summary(status: &str) -> Summary {
        Summary {
            title: "Improve status UI".into(),
            status: status.into(),
            workspace: first_workspace(r#"["file:///c%3A/code/shop-api"]"#),
            last_modified: 1_000_000,
            steps: 12,
            ..Default::default()
        }
    }

    #[test]
    fn running_conversation_is_working_with_title_and_project() {
        let mut sess = Session::new("antigravity", "c1");
        apply(&mut sess, Some(summary("CASCADE_RUN_STATUS_RUNNING")), vec![(900_000, "Fix the login".into())], 0);
        assert_eq!(sess.status(1_010_000), Status::Working);
        assert_eq!(sess.title.as_deref(), Some("Improve status UI"));
        assert_eq!(sess.first_prompt.as_deref(), Some("Fix the login"));
        let project = crate::util::project_name(sess.cwd.as_deref().unwrap());
        assert_eq!(project, "shop-api");
    }

    #[test]
    fn idle_hands_the_turn_back_and_killed_is_offline() {
        let mut sess = Session::new("antigravity", "c1");
        apply(&mut sess, Some(summary("CASCADE_RUN_STATUS_IDLE")), vec![], 0);
        assert_eq!(sess.status(1_000_000 + 60_000), Status::Waiting);
        let mut killed = summary("CASCADE_RUN_STATUS_IDLE");
        killed.killed = true;
        apply(&mut sess, Some(killed), vec![], 0);
        assert_eq!(sess.status(1_000_000 + 60_000), Status::Offline);
    }

    #[test]
    fn summary_db_round_trip() {
        let dir = std::env::temp_dir().join(format!("agent-tally-ag-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("conversation_summaries.db");
        let _ = std::fs::remove_file(&db);
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE conversation_summaries (conversation_id text, title text, status text, workspace_uris text,
               last_modified_time datetime, parent_conversation_id text, killed numeric, step_count integer);
             INSERT INTO conversation_summaries VALUES ('c1', 'Title', 'CASCADE_RUN_STATUS_RUNNING',
               '[\"file:///C:/code/app\"]', '2026-09-29 17:38:58.6932574+00:00', 'p1', 0, 177);",
        )
        .unwrap();
        drop(conn);
        let s = read_summary(&db, "c1").unwrap();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(s.title, "Title");
        assert_eq!(s.parent.as_deref(), Some("p1"));
        assert_eq!(s.steps, 177);
        assert!(!s.killed);
        assert_eq!(s.last_modified, crate::util::parse_rfc3339("2026-09-29T17:38:58.693Z").unwrap());
        assert_eq!(crate::util::project_name(s.workspace.as_deref().unwrap()), "app");
    }
}
