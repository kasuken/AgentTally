//! Local accounting index. This worker never touches Scanner or emits live events.
use crate::providers::{Format, Roots};
use crate::usage_events::{Observation, Tokens, UsageParser};
use chrono::{Days, Local, NaiveDate, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const BATCH_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DOCUMENT: u64 = 16 * 1024 * 1024;
const MAX_RECORD: usize = 2 * 1024 * 1024;

#[derive(Clone, Default, Serialize)]
pub struct Progress {
    pub discovered: usize,
    pub indexed: usize,
    pub unsupported: usize,
    pub without_usage: usize,
    pub pending: usize,
    pub malformed: u64,
    pub errors: Vec<String>,
    pub updated_at: i64,
    pub importing: bool,
}

#[derive(Clone, Default)]
pub struct History {
    path: Option<PathBuf>,
    progress: Arc<Mutex<Progress>>,
}

#[derive(Clone, Default, Serialize)]
pub struct Counts {
    pub name: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cache_write_1h: u64,
    pub unclassified: u64,
    pub records: u64,
    pub missing_input: u64,
    pub missing_output: u64,
    pub missing_cache_read: u64,
    pub missing_cache_write: u64,
    pub partial: u64,
    pub aggregate: u64,
}

#[derive(Serialize)]
pub struct Summary {
    pub days: u32,
    pub start: String,
    pub end: String,
    pub earliest: Option<String>,
    pub totals: Counts,
    pub daily: Vec<Counts>,
    pub models: Vec<Counts>,
    pub providers: Vec<Counts>,
    pub tools: BTreeMap<String, u64>,
    pub progress: Progress,
}

fn message(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl History {
    pub fn start(app_data: Result<PathBuf, String>) -> Self {
        #[cfg(debug_assertions)]
        let app_data = crate::providers::fixture_root()
            .map(|p| Ok(p.join("app-data")))
            .unwrap_or(app_data);
        let history = Self {
            path: app_data.as_ref().ok().map(|p| p.join("usage-v1.sqlite")),
            ..Self::default()
        };
        let worker = history.clone();
        std::thread::spawn(move || {
            let result = app_data.and_then(|dir| {
                fs::create_dir_all(&dir).map_err(message)?;
                let mut db = open(&dir.join("usage-v1.sqlite"))?;
                let roots = Roots::detect();
                loop {
                    if let Err(e) = worker.cycle(&mut db, &roots) {
                        worker.set_error(format!("History index: {e}"));
                    }
                    let pending = worker.progress.lock().map(|p| p.pending).unwrap_or(0);
                    std::thread::sleep(if pending > 0 {
                        Duration::from_millis(150)
                    } else {
                        Duration::from_secs(8)
                    });
                }
                #[allow(unreachable_code)]
                Ok::<(), String>(())
            });
            if let Err(e) = result {
                worker.set_error(format!("History unavailable: {e}"));
            }
        });
        history
    }

    fn set_error(&self, error: String) {
        if let Ok(mut p) = self.progress.lock() {
            if !p.errors.contains(&error) {
                p.errors.push(error);
            }
            p.importing = false;
        }
    }

    fn cycle(&self, db: &mut Connection, roots: &Roots) -> Result<(), String> {
        let today = Local::now().date_naive();
        let cutoff = midnight(
            &Local,
            today
                .checked_sub_days(Days::new(29))
                .ok_or("Date overflow")?,
        )?;
        // Discovery uses modification time only to find eligible files; attribution uses event time.
        let candidates = roots.discover(cutoff);
        let mut p = Progress {
            discovered: candidates.len(),
            importing: true,
            ..Progress::default()
        };
        for provider in roots.providers() {
            for root in provider.roots {
                match fs::read_dir(&root) {
                    Ok(_) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => p.errors.push(format!(
                        "{} search root cannot be read ({})",
                        provider.name,
                        e.kind()
                    )),
                }
            }
        }
        self.publish(&p);
        for candidate in candidates {
            if matches!(candidate.format, Format::Antigravity | Format::Presence) {
                p.unsupported += 1;
                continue;
            }
            match index_file(
                db,
                &candidate.path,
                candidate.format,
                candidate.provider,
                cutoff,
            ) {
                Ok(result) => {
                    p.indexed += usize::from(result.complete);
                    p.pending += usize::from(!result.complete);
                    p.malformed += result.malformed;
                    p.without_usage += usize::from(!result.has_usage);
                }
                Err(e) => p.errors.push(format!(
                    "{} source {}: {e}",
                    candidate.provider,
                    fingerprint(candidate.path.to_string_lossy().as_bytes())
                )),
            }
            self.publish(&p);
            std::thread::yield_now();
        }
        db.execute("DELETE FROM observations WHERE ts < ?1", [cutoff])
            .map_err(message)?;
        db.execute("DELETE FROM sources WHERE touched < ?1", [cutoff])
            .map_err(message)?;
        p.importing = p.pending > 0;
        p.updated_at = crate::util::now_ms();
        self.publish(&p);
        Ok(())
    }

    fn publish(&self, progress: &Progress) {
        if let Ok(mut p) = self.progress.lock() {
            *p = progress.clone();
        }
    }

    pub fn summary(&self, days: u32) -> Result<Summary, String> {
        if !matches!(days, 1 | 7 | 30) {
            return Err("Usage period must be 1, 7 or 30 local dates".into());
        }
        let progress = self
            .progress
            .lock()
            .map_err(|_| "History state lock failed")?
            .clone();
        let path = self.path.as_ref().ok_or_else(|| {
            if progress.errors.is_empty() {
                "History data directory is unavailable".to_string()
            } else {
                progress.errors.join("; ")
            }
        })?;
        let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(message)?;
        db.busy_timeout(Duration::from_secs(2)).map_err(message)?;
        summarize(&db, days, Local::now().date_naive(), progress)
    }
}

fn open(path: &Path) -> Result<Connection, String> {
    let db = Connection::open(path).map_err(message)?;
    db.busy_timeout(Duration::from_secs(2)).map_err(message)?;
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS sources(
          source TEXT PRIMARY KEY, offset INTEGER NOT NULL, size INTEGER NOT NULL,
          modified INTEGER NOT NULL, boundary TEXT NOT NULL, parser TEXT NOT NULL,
          malformed INTEGER NOT NULL, touched INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS observations(
          source TEXT NOT NULL, id TEXT NOT NULL, ts INTEGER NOT NULL,
          provider TEXT NOT NULL, model TEXT, input INTEGER, output INTEGER,
          cache_read INTEGER, cache_write INTEGER, cache_write_1h INTEGER,
          unclassified INTEGER, tool TEXT, partial INTEGER NOT NULL,
          aggregate_count INTEGER NOT NULL, PRIMARY KEY(source,id));
        CREATE INDEX IF NOT EXISTS observation_time ON observations(ts);",
    )
    .map_err(message)?;
    Ok(db)
}

fn fingerprint(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn boundary(file: &mut File, offset: u64) -> Result<String, String> {
    let mut bytes = vec![0; offset.min(512) as usize];
    file.seek(SeekFrom::Start(offset.saturating_sub(512)))
        .map_err(message)?;
    file.read_exact(&mut bytes).map_err(message)?;
    let mut prefix = vec![0; offset.min(512) as usize];
    file.seek(SeekFrom::Start(0)).map_err(message)?;
    file.read_exact(&mut prefix).map_err(message)?;
    bytes.extend(prefix);
    Ok(fingerprint(&bytes))
}

struct Indexed {
    complete: bool,
    malformed: u64,
    has_usage: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct Checkpoint {
    parser: UsageParser,
    discarding_record: bool,
}

fn has_usage(db: &Connection, source: &str) -> Result<bool, String> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM observations WHERE source=?1 AND tool IS NULL)",
        [source],
        |r| r.get(0),
    )
    .map_err(message)
}

fn index_file(
    db: &mut Connection,
    path: &Path,
    format: Format,
    provider: &str,
    cutoff: i64,
) -> Result<Indexed, String> {
    let source = fingerprint(path.to_string_lossy().as_bytes());
    let meta = fs::metadata(path).map_err(|e| format!("Cannot inspect log ({})", e.kind()))?;
    let size = meta.len();
    let modified = meta
        .modified()
        .map_err(message)?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(message)?
        .as_nanos();
    let modified = i64::try_from(modified).map_err(message)?;
    let touched = crate::util::mtime_ms(&meta);
    let old: Option<(u64, u64, i64, String, u64)> = db
        .query_row(
            "SELECT offset,size,modified,boundary,malformed FROM sources WHERE source=?1",
            [&source],
            |r| {
                Ok((
                    sql_count(r, 0)?.unwrap_or(0),
                    sql_count(r, 1)?.unwrap_or(0),
                    r.get(2)?,
                    r.get(3)?,
                    sql_count(r, 4)?.unwrap_or(0),
                ))
            },
        )
        .optional()
        .map_err(message)?;
    if let Some((offset, old_size, old_modified, _, malformed)) = &old {
        if *offset == size && *old_size == size && *old_modified == modified {
            return Ok(Indexed {
                complete: true,
                malformed: *malformed,
                has_usage: has_usage(db, &source)?,
            });
        }
    }
    let document = path.extension().is_some_and(|s| s == "json");
    if document && size > MAX_DOCUMENT {
        return Err("Document exceeds 16 MiB import limit; excluded".into());
    }
    let mut file = File::open(path).map_err(|e| format!("Cannot read log ({})", e.kind()))?;
    let mut offset = 0;
    let mut checkpoint = Checkpoint::default();
    let mut malformed = 0;
    let mut reset = true;
    if !document {
        if let Some((at, old_size, old_modified, hash, errors)) = &old {
            if size >= *at
                && (size > *old_size || modified == *old_modified)
                && boundary(&mut file, *at)? == *hash
            {
                offset = *at;
                let state: String = db
                    .query_row(
                        "SELECT parser FROM sources WHERE source=?1",
                        [&source],
                        |r| r.get(0),
                    )
                    .map_err(message)?;
                checkpoint = serde_json::from_str(&state)
                    .or_else(|_| serde_json::from_str(&state).map(|parser| Checkpoint {parser,discarding_record:false}))
                    .map_err(|_| "Invalid history checkpoint; close AgentTally and remove its usage-v1.sqlite files to rebuild")?;
                malformed = *errors;
                reset = false;
            }
        }
    }
    let tx = db.transaction().map_err(message)?;
    if reset {
        tx.execute("DELETE FROM observations WHERE source=?1", [&source])
            .map_err(message)?;
    }
    if document {
        let doc = serde_json::from_reader(BufReader::new(&file))
            .map_err(|_| "Invalid JSON document; previous index preserved until a valid rewrite")?;
        for observation in checkpoint.parser.process(format, &doc) {
            store(&tx, &source, provider, observation, cutoff)?;
        }
        checkpoint = Checkpoint::default();
        offset = size;
    } else {
        file.seek(SeekFrom::Start(offset)).map_err(message)?;
        let mut reader = BufReader::new(&file);
        let start = offset;
        for _ in 0..512 {
            let mut line = Vec::new();
            let length = reader
                .by_ref()
                .take((MAX_RECORD + 1) as u64)
                .read_until(b'\n', &mut line)
                .map_err(message)?;
            if length == 0 {
                break;
            }
            if checkpoint.discarding_record || length > MAX_RECORD {
                if !checkpoint.discarding_record {
                    malformed += 1;
                }
                checkpoint.discarding_record = line.last() != Some(&b'\n');
                offset += length as u64;
                if offset - start >= BATCH_BYTES {
                    break;
                }
                continue;
            }
            if line.last() != Some(&b'\n') {
                break;
            } // A writer may still be appending this record.
            offset += length as u64;
            match serde_json::from_slice(&line) {
                Ok(value) => {
                    for observation in checkpoint.parser.process(format, &value) {
                        store(&tx, &source, provider, observation, cutoff)?;
                    }
                }
                Err(_) => malformed += 1,
            }
            if offset - start >= BATCH_BYTES {
                break;
            }
        }
    }
    let state = serde_json::to_string(&checkpoint).map_err(message)?;
    if state.len() > 4 * 1024 * 1024 {
        return Err("Accounting checkpoint exceeds 4 MiB safety limit; file import paused without dropping reconciliation state".into());
    }
    let hash = boundary(&mut file, offset)?;
    tx.execute("INSERT INTO sources VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
      ON CONFLICT(source) DO UPDATE SET offset=excluded.offset,size=excluded.size,modified=excluded.modified,
      boundary=excluded.boundary,parser=excluded.parser,malformed=excluded.malformed,touched=excluded.touched",
      params![source,i64::try_from(offset).map_err(message)?,i64::try_from(size).map_err(message)?,
        modified,hash,state,i64::try_from(malformed).map_err(message)?,touched]).map_err(message)?;
    tx.commit().map_err(message)?;
    Ok(Indexed {
        complete: offset >= size,
        malformed,
        has_usage: has_usage(db, &source)?,
    })
}

fn normalized(t: &Tokens) -> (Option<u64>, Option<u64>, Option<u64>, bool) {
    let cache = t
        .cache_read
        .unwrap_or(0)
        .saturating_add(t.cache_write.unwrap_or(0));
    let unknown_split = t.input_includes_cache != Some(false) && t.cache_read.is_none();
    let invalid = (t.input_includes_cache == Some(true) && t.input.is_some_and(|n| n < cache))
        || (unknown_split && t.input.is_some())
        || (t.input.is_none() && t.tool_input.is_some())
        || (t.output.is_none() && !t.output_includes_reasoning && t.reasoning.is_some());
    let input = t.input.filter(|_| !unknown_split).map(|n| {
        if t.input_includes_cache == Some(true) {
            n.saturating_sub(cache)
        } else {
            n
        }
    });
    let input = match (input, t.tool_input) {
        (Some(a), Some(b)) => Some(a.saturating_add(b)),
        (a, b) => a.or(b),
    };
    let reasoning = if t.output_includes_reasoning {
        None
    } else {
        t.reasoning
    };
    let output = match (t.output, reasoning) {
        (Some(a), Some(b)) => Some(a.saturating_add(b)),
        (a, b) => a.or(b),
    };
    let known = input
        .unwrap_or(0)
        .saturating_add(output.unwrap_or(0))
        .saturating_add(cache);
    let remainder = t.total.map(|n| n.saturating_sub(known)).or_else(|| {
        if unknown_split {
            t.input.map(|n| n.saturating_sub(cache))
        } else {
            None
        }
    });
    (input, output, remainder, invalid)
}

fn store(
    db: &Connection,
    source: &str,
    provider: &str,
    o: Observation,
    cutoff: i64,
) -> Result<(), String> {
    if o.tokens.is_none() && o.tool_category.is_none() {
        db.execute(
            "DELETE FROM observations WHERE source=?1 AND id=?2",
            params![source, o.id],
        )
        .map_err(message)?;
        return Ok(());
    }
    if o.ts < cutoff || o.ts > crate::util::now_ms() + 60_000 {
        return Ok(());
    }
    let mut t = o.tokens.unwrap_or_default();
    let mut clamped = false;
    if let Some(input) = t.input.filter(|_| t.input_includes_cache == Some(true)) {
        if t.cache_read
            .unwrap_or(0)
            .saturating_add(t.cache_write.unwrap_or(0))
            > input
        {
            t.cache_read = t.cache_read.map(|n| n.min(input));
            t.cache_write = t
                .cache_write
                .map(|n| n.min(input.saturating_sub(t.cache_read.unwrap_or(0))));
            t.cache_write_1h = t.cache_write_1h.map(|n| n.min(t.cache_write.unwrap_or(0)));
            clamped = true;
        }
    }
    let (input, output, unclassified, invalid) = normalized(&t);
    // SQLite counters are signed; reject invalid oversized provider values explicitly.
    for n in [
        input,
        output,
        t.cache_read,
        t.cache_write,
        t.cache_write_1h,
        unclassified,
    ]
    .into_iter()
    .flatten()
    {
        if n > i64::MAX as u64 {
            return Err("Token counter exceeds SQLite range; source excluded".into());
        }
    }
    db.execute(
        "INSERT INTO observations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
      ON CONFLICT(source,id) DO UPDATE SET ts=excluded.ts,model=excluded.model,input=excluded.input,
      output=excluded.output,cache_read=excluded.cache_read,cache_write=excluded.cache_write,
      cache_write_1h=excluded.cache_write_1h,unclassified=excluded.unclassified,tool=excluded.tool,
      partial=excluded.partial,aggregate_count=excluded.aggregate_count",
        params![
            source,
            o.id,
            o.ts,
            provider,
            o.model,
            input.map(|n| n as i64),
            output.map(|n| n as i64),
            t.cache_read.map(|n| n as i64),
            t.cache_write.map(|n| n as i64),
            t.cache_write_1h.map(|n| n as i64),
            unclassified.map(|n| n as i64),
            o.tool_category,
            o.partial || invalid || clamped,
            o.aggregate
        ],
    )
    .map_err(message)?;
    Ok(())
}

fn midnight<T: TimeZone>(zone: &T, date: NaiveDate) -> Result<i64, String> {
    let midnight = date.and_hms_opt(0, 0, 0).ok_or("Invalid local date")?;
    // Some zones change clocks at midnight. Choose the first real instant on that date.
    for minute in 0..1440 {
        let time = midnight + chrono::Duration::minutes(minute);
        if let Some(local) = zone.from_local_datetime(&time).earliest() {
            return Ok(local.timestamp_millis());
        }
    }
    Err("Local calendar date has no valid instant".into())
}

fn summarize(
    db: &Connection,
    days: u32,
    today: NaiveDate,
    progress: Progress,
) -> Result<Summary, String> {
    let start_date = today
        .checked_sub_days(Days::new(u64::from(days - 1)))
        .ok_or("Date overflow")?;
    let start = midnight(&Local, start_date)?;
    let end = midnight(
        &Local,
        today
            .checked_add_days(Days::new(1))
            .ok_or("Date overflow")?,
    )?;
    let mut summary = Summary {
        days,
        start: start_date.to_string(),
        end: today.to_string(),
        earliest: None,
        totals: Counts::default(),
        daily: vec![],
        models: vec![],
        providers: vec![],
        tools: BTreeMap::new(),
        progress,
    };
    let mut daily: BTreeMap<String, Counts> = (0..days)
        .map(|d| {
            let name = (start_date + Days::new(u64::from(d))).to_string();
            (
                name.clone(),
                Counts {
                    name,
                    ..Counts::default()
                },
            )
        })
        .collect();
    let mut models = BTreeMap::<String, Counts>::new();
    let mut providers = BTreeMap::<String, Counts>::new();
    let mut stmt = db
        .prepare(
            "SELECT ts,provider,model,input,output,cache_read,cache_write,cache_write_1h,
      unclassified,tool,partial,aggregate_count FROM observations WHERE ts>=?1 AND ts<?2",
        )
        .map_err(message)?;
    let rows = stmt
        .query_map(params![start, end], |r| {
            let ts: i64 = r.get(0)?;
            let tool: Option<String> = r.get(9)?;
            let input = sql_count(r, 3)?;
            let output = sql_count(r, 4)?;
            Ok((
                ts,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                tool,
                Counts {
                    input: input.unwrap_or(0),
                    output: output.unwrap_or(0),
                    cache_read: sql_count(r, 5)?.unwrap_or(0),
                    cache_write: sql_count(r, 6)?.unwrap_or(0),
                    cache_write_1h: sql_count(r, 7)?.unwrap_or(0),
                    unclassified: sql_count(r, 8)?.unwrap_or(0),
                    records: 1,
                    missing_input: u64::from(input.is_none()),
                    missing_output: u64::from(output.is_none()),
                    missing_cache_read: u64::from(sql_count(r, 5)?.is_none()),
                    missing_cache_write: u64::from(sql_count(r, 6)?.is_none()),
                    partial: sql_count(r, 10)?.unwrap_or(0),
                    aggregate: sql_count(r, 11)?.unwrap_or(0),
                    ..Counts::default()
                },
            ))
        })
        .map_err(message)?;
    for row in rows {
        let (ts, provider, model, tool, counts) = row.map_err(message)?;
        if let Some(tool) = tool {
            *summary.tools.entry(tool).or_default() += 1;
            continue;
        }
        let date = Local
            .timestamp_millis_opt(ts)
            .single()
            .ok_or("Invalid event timestamp")?
            .date_naive()
            .to_string();
        summary.earliest = Some(
            summary
                .earliest
                .take()
                .map(|old| old.min(date.clone()))
                .unwrap_or(date.clone()),
        );
        add(&mut summary.totals, &counts);
        if let Some(day) = daily.get_mut(&date) {
            add(day, &counts);
        }
        let model = model.unwrap_or_else(|| "Unknown model".into());
        add(
            models.entry(model.clone()).or_insert_with(|| Counts {
                name: model,
                ..Counts::default()
            }),
            &counts,
        );
        add(
            providers.entry(provider.clone()).or_insert_with(|| Counts {
                name: provider,
                ..Counts::default()
            }),
            &counts,
        );
    }
    summary.daily = daily.into_values().collect();
    summary.models = models.into_values().collect();
    summary.models.sort_by_key(|r| {
        std::cmp::Reverse(
            r.input
                .saturating_add(r.output)
                .saturating_add(r.cache_read)
                .saturating_add(r.cache_write)
                .saturating_add(r.unclassified),
        )
    });
    summary.providers = providers.into_values().collect();
    Ok(summary)
}

fn add(a: &mut Counts, b: &Counts) {
    a.input = a.input.saturating_add(b.input);
    a.output = a.output.saturating_add(b.output);
    a.cache_read = a.cache_read.saturating_add(b.cache_read);
    a.cache_write = a.cache_write.saturating_add(b.cache_write);
    a.cache_write_1h = a.cache_write_1h.saturating_add(b.cache_write_1h);
    a.unclassified = a.unclassified.saturating_add(b.unclassified);
    a.records += b.records;
    a.missing_input += b.missing_input;
    a.missing_output += b.missing_output;
    a.missing_cache_read += b.missing_cache_read;
    a.missing_cache_write += b.missing_cache_write;
    a.partial += b.partial;
    a.aggregate += b.aggregate;
}

fn sql_count(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<Option<u64>> {
    row.get::<_, Option<i64>>(index)?
        .map(|n| {
            u64::try_from(n).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    index,
                    rusqlite::types::Type::Integer,
                    Box::new(e),
                )
            })
        })
        .transpose()
}

#[tauri::command]
pub async fn usage_summary(
    history: tauri::State<'_, History>,
    days: u32,
) -> Result<Summary, String> {
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || history.summary(days))
        .await
        .map_err(message)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "agent-tally-history-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn db(&self) -> Connection {
            open(&self.0.join("test.sqlite")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn claude(id: &str, input: u64) -> String {
        format!(
            "{}\n",
            json!({"type":"assistant","timestamp":Local::now().to_rfc3339(),
            "message":{"id":id,"model":"claude-sonnet-4-5","usage":{"input_tokens":input,"output_tokens":4},
            "content":[{"type":"tool_use","id":format!("tool-{id}"),"name":"read_file","input":{"secret":"DO_NOT_RETAIN"}}]}})
        )
    }
    fn total(db: &Connection) -> u64 {
        summarize(db, 1, Local::now().date_naive(), Progress::default())
            .unwrap()
            .totals
            .input
    }

    #[test]
    fn restart_append_refinement_truncation_and_retraction_are_idempotent() {
        let fixture = Fixture::new();
        let path = fixture.0.join("events.jsonl");
        let mut db = fixture.db();
        fs::write(&path, claude("one", 10)).unwrap();
        index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        assert_eq!(total(&db), 10);
        drop(db);
        let mut db = fixture.db();
        index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        assert_eq!(total(&db), 10);
        File::options()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(format!("{}{}", claude("one", 20), claude("two", 30)).as_bytes())
            .unwrap();
        index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        assert_eq!(total(&db), 50);
        let summary = summarize(&db, 1, Local::now().date_naive(), Progress::default()).unwrap();
        assert_eq!(summary.tools.get("read/search"), Some(&2));
        fs::write(&path, claude("one", 7)).unwrap();
        index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        assert_eq!(total(&db), 7);
        let source = fingerprint(path.to_string_lossy().as_bytes());
        store(
            &db,
            &source,
            "claude",
            Observation {
                id: "usage:one".into(),
                ts: 0,
                model: None,
                tokens: None,
                tool_category: None,
                partial: false,
                aggregate: false,
            },
            0,
        )
        .unwrap();
        assert_eq!(total(&db), 0);
        let checkpoint: String = db
            .query_row("SELECT parser FROM sources", [], |r| r.get(0))
            .unwrap();
        assert!(!checkpoint.contains("DO_NOT_RETAIN"));
    }

    #[test]
    fn incomplete_frames_and_malformed_records_are_visible_and_recoverable() {
        let fixture = Fixture::new();
        let path = fixture.0.join("events.jsonl");
        let mut db = fixture.db();
        let line = claude("one", 18);
        fs::write(&path, format!("broken\n{}", line.trim_end())).unwrap();
        let first = index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        assert!(!first.complete);
        assert_eq!(first.malformed, 1);
        assert_eq!(total(&db), 0);
        File::options()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"\n")
            .unwrap();
        let second = index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        assert!(second.complete);
        assert_eq!(second.malformed, 1);
        assert_eq!(total(&db), 18);
    }

    #[test]
    fn oversized_record_is_discarded_in_bounded_batches_without_losing_later_records() {
        let fixture = Fixture::new();
        let path = fixture.0.join("events.jsonl");
        let mut db = fixture.db();
        let mut file = File::create(&path).unwrap();
        file.write_all(&vec![b'x'; MAX_RECORD * 3]).unwrap();
        file.write_all(format!("\n{}", claude("after-large-frame", 42)).as_bytes())
            .unwrap();
        drop(file);
        let first = index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        assert!(!first.complete);
        assert_eq!(first.malformed, 1);
        // Checkpoint and offset survive restart, including the frame-discard state.
        drop(db);
        let mut db = fixture.db();
        let mut complete = false;
        for _ in 0..5 {
            let result = index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
            assert_eq!(result.malformed, 1);
            if result.complete {
                complete = true;
                break;
            }
        }
        assert!(complete);
        assert_eq!(total(&db), 42);
    }

    #[test]
    fn same_length_rewrite_replaces_the_committed_source() {
        let fixture = Fixture::new();
        let path = fixture.0.join("events.jsonl");
        let mut db = fixture.db();
        let first = claude("same", 10);
        fs::write(&path, &first).unwrap();
        index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        let second = first.replace("\"input_tokens\":10", "\"input_tokens\":20");
        assert_eq!(first.len(), second.len());
        std::thread::sleep(Duration::from_millis(2));
        fs::write(&path, second).unwrap();
        index_file(&mut db, &path, Format::Claude, "claude", 0).unwrap();
        assert_eq!(total(&db), 20);
    }

    #[test]
    fn rewritten_documents_replace_removed_rows_without_duplicate_usage() {
        let fixture = Fixture::new();
        let path = fixture.0.join("session.json");
        let mut db = fixture.db();
        let doc = |count| {
            json!({"messages":(0..count).map(|i|json!({
            "id":format!("message-{i}"),"type":"gemini","timestamp":Local::now().to_rfc3339(),
            "model":"gemini-2.5-flash","tokens":{"input":100,"output":20,"cached":30,"thoughts":5,"tool":2,"total":127}
        })).collect::<Vec<_>>()}).to_string()
        };
        fs::write(&path, doc(2)).unwrap();
        index_file(&mut db, &path, Format::Gemini, "gemini", 0).unwrap();
        assert_eq!(total(&db), 144);
        fs::write(&path, "{").unwrap();
        assert!(index_file(&mut db, &path, Format::Gemini, "gemini", 0).is_err());
        assert_eq!(total(&db), 144);
        fs::write(&path, doc(1)).unwrap();
        index_file(&mut db, &path, Format::Gemini, "gemini", 0).unwrap();
        assert_eq!(total(&db), 72);
    }

    #[test]
    fn token_classes_do_not_double_count_cache_or_reasoning() {
        let t = Tokens {
            input: Some(100),
            output: Some(20),
            cache_read: Some(30),
            reasoning: Some(5),
            tool_input: Some(2),
            total: Some(127),
            input_includes_cache: Some(true),
            ..Tokens::default()
        };
        assert_eq!(normalized(&t), (Some(72), Some(25), Some(0), false));
        assert_eq!(
            normalized(&Tokens {
                output_includes_reasoning: true,
                ..t.clone()
            })
            .1,
            Some(20)
        );
        assert_eq!(
            normalized(&Tokens {
                input_includes_cache: Some(false),
                ..t
            })
            .0,
            Some(102)
        );
        assert_eq!(
            normalized(&Tokens {
                total: Some(500),
                ..Tokens::default()
            }),
            (None, None, Some(500), false)
        );
    }

    #[test]
    fn unknown_cache_split_is_unclassified_and_separate_reasoning_is_preserved() {
        assert_eq!(
            normalized(&Tokens {
                input: Some(100),
                output: Some(20),
                total: Some(120),
                input_includes_cache: Some(true),
                output_includes_reasoning: true,
                ..Tokens::default()
            }),
            (None, Some(20), Some(100), true)
        );
        assert_eq!(
            normalized(&Tokens {
                input: Some(100),
                output: Some(20),
                input_includes_cache: Some(true),
                output_includes_reasoning: true,
                ..Tokens::default()
            }),
            (None, Some(20), Some(100), true)
        );
        assert_eq!(
            normalized(&Tokens {
                reasoning: Some(25),
                ..Tokens::default()
            }),
            (None, Some(25), None, true)
        );
        // Codex has a cache-read split, but no separately reported write class.
        assert_eq!(
            normalized(&Tokens {
                input: Some(100),
                cache_read: Some(40),
                output: Some(20),
                input_includes_cache: Some(true),
                output_includes_reasoning: true,
                ..Tokens::default()
            }),
            (Some(60), Some(20), None, false)
        );
        let fixture = Fixture::new();
        let db = fixture.db();
        store(
            &db,
            "source",
            "test",
            Observation {
                id: "bad-cache".into(),
                ts: Local::now().timestamp_millis(),
                tokens: Some(Tokens {
                    input: Some(100),
                    cache_read: Some(400),
                    input_includes_cache: Some(true),
                    ..Tokens::default()
                }),
                model: None,
                tool_category: None,
                partial: false,
                aggregate: false,
            },
            0,
        )
        .unwrap();
        let summary = summarize(&db, 1, Local::now().date_naive(), Progress::default()).unwrap();
        assert_eq!(summary.totals.cache_read, 100);
        assert_eq!(summary.totals.partial, 1);
    }

    #[test]
    fn local_calendar_windows_use_midnight_and_exclude_expired_dates() {
        let fixture = Fixture::new();
        let db = fixture.db();
        let today = Local::now().date_naive();
        let start = midnight(&Local, today).unwrap();
        let make = |id: &str, ts| Observation {
            id: id.into(),
            ts,
            model: Some("unknown".into()),
            tokens: Some(Tokens {
                input: Some(10),
                input_includes_cache: Some(false),
                ..Tokens::default()
            }),
            tool_category: None,
            partial: false,
            aggregate: false,
        };
        store(&db, "source", "test", make("yesterday", start - 1), 0).unwrap();
        store(&db, "source", "test", make("today", start), 0).unwrap();
        assert_eq!(
            summarize(&db, 1, today, Progress::default())
                .unwrap()
                .totals
                .input,
            10
        );
        assert_eq!(
            summarize(&db, 7, today, Progress::default())
                .unwrap()
                .totals
                .input,
            20
        );
        db.execute("DELETE FROM observations WHERE ts < ?1", [start])
            .unwrap();
        assert_eq!(
            summarize(&db, 30, today, Progress::default())
                .unwrap()
                .daily
                .len(),
            30
        );
        assert_eq!(
            summarize(&db, 30, today, Progress::default())
                .unwrap()
                .totals
                .input,
            10
        );
        let east = chrono::FixedOffset::east_opt(5 * 3600 + 1800).unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 29).unwrap();
        assert_eq!(
            east.timestamp_millis_opt(midnight(&east, date).unwrap())
                .single()
                .unwrap()
                .date_naive(),
            date
        );
    }

    #[test]
    fn calendar_midnights_follow_os_daylight_saving_offsets() {
        for date in [
            NaiveDate::from_ymd_opt(2026, 3, 29).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(),
        ] {
            let next = date.checked_add_days(Days::new(1)).unwrap();
            let start = Local
                .timestamp_millis_opt(midnight(&Local, date).unwrap())
                .single()
                .unwrap();
            let end = Local
                .timestamp_millis_opt(midnight(&Local, next).unwrap())
                .single()
                .unwrap();
            assert_eq!(start.date_naive(), date);
            assert_eq!(end.date_naive(), next);
            let expected = 86_400 + i64::from(start.offset().local_minus_utc())
                - i64::from(end.offset().local_minus_utc());
            assert_eq!((end - start).num_seconds(), expected);
        }
    }
}
