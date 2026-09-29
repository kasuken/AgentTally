//! Finds agent session logs, tails them incrementally and keeps a live
//! `Session` per file.

use crate::model::{Session, Snapshot};
use crate::providers::{antigravity, claude, codex, copilot, gemini, vscode, Candidate, Format, Roots};
use crate::util::{mtime_ms, now_ms};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::PathBuf;

/// How far back to look for sessions.
pub const LOOKBACK_MS: i64 = 24 * 3600 * 1000;
/// How much of an existing log to replay when first seen.
const INITIAL_TAIL: u64 = 2 * 1024 * 1024;
/// Largest single line (or whole-file document) we are willing to parse.
const MAX_DOC: u64 = 16 * 1024 * 1024;
/// When the replay skips the start of a log, this much of the head is read for metadata only.
const HEAD_BYTES: u64 = 256 * 1024;

struct Tracked {
    format: Format,
    path: PathBuf,
    offset: u64,
    partial: Vec<u8>,
    len: u64,
    mtime: i64,
    /// Files that count as activity besides `path` (e.g. a SQLite `-wal`).
    companions: Vec<PathBuf>,
    session: Session,
}

pub struct Scanner {
    roots: Roots,
    tracked: HashMap<PathBuf, Tracked>,
}

impl Scanner {
    pub fn new() -> Self {
        Scanner { roots: Roots::detect(), tracked: HashMap::new() }
    }

    /// Walks the provider folders for new or updated session files.
    pub fn discover(&mut self) {
        let since = now_ms() - LOOKBACK_MS;
        for cand in self.roots.discover(since) {
            match self.tracked.get_mut(&cand.path) {
                Some(t) => {
                    // Cheap metadata (titles in side files) can change at any time.
                    // Claude and Antigravity keep better titles in the logs themselves.
                    if cand.title.is_some() && !matches!(cand.format, Format::Claude | Format::Antigravity) {
                        t.session.title = cand.title;
                    }
                    t.companions = cand.companions;
                }
                None => {
                    let t = Tracked::new(cand);
                    self.tracked.insert(t.path.clone(), t);
                }
            }
        }
    }

    /// Reads whatever was appended to tracked files since the last poll.
    pub fn poll(&mut self) {
        let since = now_ms() - LOOKBACK_MS;
        self.tracked.retain(|_, t| match t.stat() {
            Some((mtime, len)) => {
                if mtime < since {
                    return false;
                }
                if mtime != t.mtime || len != t.len {
                    t.mtime = mtime;
                    t.len = len;
                    t.session.file_mtime = mtime;
                    t.refresh();
                }
                true
            }
            None => false,
        });
    }

    pub fn snapshot(&self) -> Snapshot {
        let now = now_ms();
        let mut sessions: Vec<_> = self
            .tracked
            .values()
            .filter(|t| !t.session.events.is_empty() || t.session.presence_only)
            .map(|t| t.session.view(now))
            .filter(|v| now - v.last_ts < LOOKBACK_MS)
            .collect();
        sessions.sort_by(|a, b| b.last_ts.cmp(&a.last_ts));
        Snapshot { now, providers: self.roots.providers(), sessions }
    }
}

impl Tracked {
    fn new(c: Candidate) -> Self {
        let mut session = Session::new(c.provider, c.id);
        session.parent = c.parent;
        session.role = c.role;
        session.cwd = c.cwd;
        session.title = c.title;
        session.client = c.client;
        session.presence_only = c.format == Format::Presence;
        Tracked {
            format: c.format,
            path: c.path,
            offset: 0,
            partial: Vec::new(),
            len: 0,
            mtime: 0,
            companions: c.companions,
            session,
        }
    }

    /// Newest mtime and the length of the main file; companions only add activity.
    /// `None` when the main file is gone.
    fn stat(&self) -> Option<(i64, u64)> {
        let meta = fs::metadata(&self.path).ok()?;
        let mut mtime = mtime_ms(&meta);
        let mut len = meta.len();
        for c in &self.companions {
            if let Ok(m) = fs::metadata(c) {
                mtime = mtime.max(mtime_ms(&m));
                len = len.wrapping_add(m.len());
            }
        }
        Some((mtime, len))
    }

    fn refresh(&mut self) {
        match self.format {
            Format::Presence => {}
            Format::Antigravity => {
                // conversations/<id>.db → the app folder holding the summaries and history.
                let Some(base) = self.path.parent().and_then(|p| p.parent()) else { return };
                let id = self.session.id.clone();
                let summary = antigravity::read_summary(&base.join("conversation_summaries.db"), &id);
                let prompts = antigravity::read_prompts(&base.join("history.jsonl"), &id);
                antigravity::apply(&mut self.session, summary, prompts, self.mtime);
            }
            Format::Gemini => {
                if self.len > MAX_DOC {
                    return;
                }
                if let Ok(text) = fs::read_to_string(&self.path) {
                    if let Ok(doc) = serde_json::from_str::<Value>(&text) {
                        gemini::apply_document(&mut self.session, &doc);
                    }
                }
            }
            _ => self.read_lines(),
        }
    }

    fn apply(&mut self, line: &[u8]) {
        apply_line(self.format, &mut self.session, line);
    }

    /// The tail replay misses where a session started: its project root (Claude's
    /// `cwd` follows every `cd`), first prompt and parent. Recover those from the head.
    fn apply_head(&mut self) {
        let mut lines = read_head_lines(&self.path, HEAD_BYTES).into_iter();
        // The header line (Codex session_meta, VS Code snapshot) is replayed for real.
        if let Some(first) = lines.next() {
            self.apply(&first);
        }
        let mut head = Session::new(self.session.provider, self.session.id.clone());
        for line in lines {
            apply_line(self.format, &mut head, &line);
        }
        let s = &mut self.session;
        s.cwd = s.cwd.take().or(head.cwd);
        s.first_prompt = s.first_prompt.take().or(head.first_prompt);
        s.parent = s.parent.take().or(head.parent);
        s.role = s.role.take().or(head.role);
        s.client = s.client.take().or(head.client);
        s.touch(head.started);
    }

    fn read_lines(&mut self) {
        let Ok(mut file) = File::open(&self.path) else { return };
        if self.len < self.offset {
            // Rewritten or truncated: start over.
            self.reset();
        }
        let mut skip_first = false;
        if self.offset == 0 && self.len > INITIAL_TAIL {
            // Replay only the tail of big logs; metadata comes from the head.
            self.apply_head();
            self.offset = self.len - INITIAL_TAIL;
            skip_first = true;
        }
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut buf = Vec::new();
        if file.take(MAX_DOC * 4).read_to_end(&mut buf).is_err() {
            return;
        }
        self.offset += buf.len() as u64;
        let mut data = std::mem::take(&mut self.partial);
        data.extend_from_slice(&buf);

        let mut lines: Vec<&[u8]> = data.split(|b| *b == b'\n').collect();
        let tail = trim_cr(lines.pop().unwrap_or(&[]));
        let start = usize::from(skip_first).min(lines.len());
        for line in &lines[start..] {
            let line = trim_cr(line);
            if !line.is_empty() {
                self.apply(line);
            }
        }
        // A trailing piece without a newline may still be growing; keep it unless it is already valid JSON.
        if !tail.is_empty() {
            if serde_json::from_slice::<Value>(tail).is_ok() {
                self.apply(tail);
            } else if (tail.len() as u64) < MAX_DOC {
                self.partial = tail.to_vec();
            }
        }
    }

    fn reset(&mut self) {
        self.offset = 0;
        self.partial.clear();
        let mut fresh = Session::new(self.session.provider, self.session.id.clone());
        fresh.parent = self.session.parent.take();
        fresh.role = self.session.role.take();
        fresh.cwd = self.session.cwd.take();
        fresh.client = self.session.client.take();
        fresh.file_mtime = self.session.file_mtime;
        self.session = fresh;
    }
}

fn trim_cr(line: &[u8]) -> &[u8] {
    line.strip_suffix(b"\r").unwrap_or(line)
}

fn apply_line(format: Format, sess: &mut Session, line: &[u8]) {
    let Ok(v) = serde_json::from_slice::<Value>(line) else { return };
    match format {
        Format::Claude => claude::apply(sess, &v),
        Format::Codex => codex::apply(sess, &v),
        Format::Copilot => copilot::apply(sess, &v),
        Format::VsCode => vscode::apply(sess, &v),
        Format::Gemini | Format::Antigravity | Format::Presence => {}
    }
}

/// Complete lines from the start of a file: always the first one (which may be large),
/// then more until `budget` bytes have been read.
fn read_head_lines(path: &PathBuf, budget: u64) -> Vec<Vec<u8>> {
    let Ok(f) = File::open(path) else { return Vec::new() };
    let mut r = BufReader::new(f.take(MAX_DOC + budget));
    let mut out = Vec::new();
    let mut read = 0u64;
    loop {
        let mut line = Vec::new();
        match r.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(n) => read += n as u64,
        }
        // A line cut off by the size limit is not complete JSON.
        if line.last() != Some(&b'\n') {
            break;
        }
        line.pop();
        out.push(trim_cr(&line).to_vec());
        if read >= budget {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn big_claude_log_keeps_project_root_from_head() {
        let dir = std::env::temp_dir().join(format!("agent-tally-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.jsonl");
        let mut f = File::create(&path).unwrap();
        writeln!(f, r#"{{"type":"queue-operation"}}"#).unwrap();
        writeln!(f, r#"{{"type":"user","timestamp":"2026-09-29T10:00:00Z","cwd":"C:\\p\\AgentTally","message":{{"content":"Build the app"}}}}"#).unwrap();
        // Enough later activity from a subfolder to push the head out of the tail replay.
        let later = format!(
            r#"{{"type":"assistant","timestamp":"2026-09-29T11:00:00Z","cwd":"C:\\p\\AgentTally\\src-tauri","message":{{"id":"m","content":[{{"type":"text","text":"{}"}}]}}}}"#,
            "x".repeat(1000)
        );
        for _ in 0..(INITIAL_TAIL / 1000 + 50) {
            writeln!(f, "{}", later).unwrap();
        }
        drop(f);
        let len = fs::metadata(&path).unwrap().len();
        let mut t = Tracked::new(Candidate {
            format: Format::Claude,
            provider: "claude",
            path: path.clone(),
            id: "s".into(),
            parent: None,
            role: None,
            cwd: None,
            title: None,
            client: None,
            companions: Vec::new(),
        });
        t.len = len;
        t.read_lines();
        fs::remove_dir_all(&dir).ok();
        assert!(len > INITIAL_TAIL);
        assert_eq!(t.session.cwd.as_deref(), Some(r"C:\p\AgentTally"));
        assert_eq!(t.session.first_prompt.as_deref(), Some("Build the app"));
        assert!(!t.session.events.is_empty());
    }
}
