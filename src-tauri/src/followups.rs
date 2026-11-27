use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUp {
    id: i64,
    project_key: String,
    project_name: String,
    title: String,
    note: String,
    link: String,
    done: bool,
    created_at: i64,
    updated_at: i64,
}

pub struct FollowUps {
    db: Mutex<Connection>,
}

impl FollowUps {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(message)?;
        }
        let db = Connection::open(path).map_err(message)?;
        db.busy_timeout(Duration::from_secs(2)).map_err(message)?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS follow_ups(
              id INTEGER PRIMARY KEY,
              project_key TEXT NOT NULL,
              project_name TEXT NOT NULL,
              title TEXT NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              link TEXT NOT NULL DEFAULT '',
              done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS follow_up_project ON follow_ups(project_key, done, updated_at);",
        )
        .map_err(message)?;
        Ok(Self { db: Mutex::new(db) })
    }

    pub fn list(&self) -> Result<Vec<FollowUp>, String> {
        let db = self
            .db
            .lock()
            .map_err(|_| "Follow-up database lock failed")?;
        let mut stmt = db
            .prepare(
                "SELECT id, project_key, project_name, title, note, link, done, created_at, updated_at
                 FROM follow_ups
                 ORDER BY done, project_name COLLATE NOCASE, updated_at DESC, id DESC",
            )
            .map_err(message)?;
        let rows = stmt.query_map([], follow_up_from_row).map_err(message)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(message)
    }

    pub fn save(
        &self,
        id: Option<i64>,
        project_key: String,
        project_name: String,
        title: String,
        note: String,
        link: String,
        done: bool,
    ) -> Result<FollowUp, String> {
        let project_key = required(project_key, "Project", 4096)?;
        let project_name = required(project_name, "Project", 500)?;
        let title = required(title, "Title", 500)?;
        let note = optional(note, "Update", 5000)?;
        let link = optional(link, "Link", 2048)?;
        if !link.is_empty() && !(link.starts_with("https://") || link.starts_with("http://")) {
            return Err("Link must start with http:// or https://".into());
        }

        let db = self
            .db
            .lock()
            .map_err(|_| "Follow-up database lock failed")?;
        let now = crate::util::now_ms();
        let saved_id = if let Some(id) = id {
            let changed = db
                .execute(
                    "UPDATE follow_ups SET project_key=?1, project_name=?2, title=?3,
                     note=?4, link=?5, done=?6, updated_at=?7 WHERE id=?8",
                    params![project_key, project_name, title, note, link, done, now, id],
                )
                .map_err(message)?;
            if changed != 1 {
                return Err("Follow-up item no longer exists".into());
            }
            id
        } else {
            db.execute(
                "INSERT INTO follow_ups
                 (project_key, project_name, title, note, link, done, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![project_key, project_name, title, note, link, done, now],
            )
            .map_err(message)?;
            db.last_insert_rowid()
        };
        get_by_id(&db, saved_id)?.ok_or_else(|| "Saved follow-up item could not be read".into())
    }

    pub fn delete(&self, id: i64) -> Result<(), String> {
        let db = self
            .db
            .lock()
            .map_err(|_| "Follow-up database lock failed")?;
        let changed = db
            .execute("DELETE FROM follow_ups WHERE id=?1", [id])
            .map_err(message)?;
        if changed != 1 {
            return Err("Follow-up item no longer exists".into());
        }
        Ok(())
    }
}

fn required(value: String, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{label} must be {max_chars} characters or fewer"));
    }
    Ok(value.to_string())
}

fn optional(value: String, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.chars().count() > max_chars {
        return Err(format!("{label} must be {max_chars} characters or fewer"));
    }
    Ok(value.to_string())
}

fn message(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn follow_up_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FollowUp> {
    Ok(FollowUp {
        id: row.get(0)?,
        project_key: row.get(1)?,
        project_name: row.get(2)?,
        title: row.get(3)?,
        note: row.get(4)?,
        link: row.get(5)?,
        done: row.get::<_, i64>(6)? != 0,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn get_by_id(db: &Connection, id: i64) -> Result<Option<FollowUp>, String> {
    db.query_row(
        "SELECT id, project_key, project_name, title, note, link, done, created_at, updated_at
         FROM follow_ups WHERE id=?1",
        [id],
        follow_up_from_row,
    )
    .optional()
    .map_err(message)
}

#[tauri::command]
pub fn follow_ups_list(state: tauri::State<'_, FollowUps>) -> Result<Vec<FollowUp>, String> {
    state.list()
}

#[tauri::command]
pub fn follow_ups_save(
    state: tauri::State<'_, FollowUps>,
    id: Option<i64>,
    project_key: String,
    project_name: String,
    title: String,
    note: String,
    link: String,
    done: bool,
) -> Result<FollowUp, String> {
    state.save(id, project_key, project_name, title, note, link, done)
}

#[tauri::command]
pub fn follow_ups_delete(state: tauri::State<'_, FollowUps>, id: i64) -> Result<(), String> {
    state.delete(id)
}

#[cfg(test)]
#[path = "followups/tests.rs"]
mod tests;
