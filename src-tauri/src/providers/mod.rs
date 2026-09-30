//! Where each agent keeps its logs, and how to find recently touched sessions.

pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod copilot;
pub mod gemini;
pub mod vscode;

use crate::model::ProviderInfo;
use crate::util::mtime_ms;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Claude,
    Codex,
    Copilot,
    VsCode,
    Gemini,
    /// Binary or undocumented storage: only "the file changed" is known.
    /// Antigravity conversation: SQLite summary row plus CLI prompt history.
    Antigravity,
    Presence,
}

/// A session log file found on disk.
#[derive(Clone, Debug)]
pub struct Candidate {
    pub format: Format,
    pub provider: &'static str,
    pub path: PathBuf,
    pub id: String,
    pub parent: Option<String>,
    pub role: Option<String>,
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub client: Option<String>,
    /// Other files whose writes count as activity (e.g. a SQLite `-wal`).
    pub companions: Vec<PathBuf>,
}

impl Candidate {
    fn new(format: Format, provider: &'static str, path: PathBuf, id: impl Into<String>) -> Self {
        Candidate {
            format,
            provider,
            path,
            id: id.into(),
            parent: None,
            role: None,
            cwd: None,
            title: None,
            client: None,
            companions: Vec::new(),
        }
    }
}

pub struct Roots {
    pub claude: PathBuf,
    pub codex: PathBuf,
    pub copilot: PathBuf,
    pub vscode: Vec<(String, PathBuf)>,
    pub gemini: PathBuf,
    pub opencode: Vec<PathBuf>,
}

impl Roots {
    pub fn detect() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let env_dir = |key: &str, fallback: PathBuf| {
            std::env::var_os(key).map(PathBuf::from).unwrap_or(fallback)
        };
        let config = dirs::config_dir().unwrap_or_else(|| home.join(".config"));
        let vscode = ["Code", "Code - Insiders", "VSCodium", "Cursor"]
            .iter()
            .map(|name| (name.to_string(), config.join(name).join("User")))
            .collect();
        let mut opencode = vec![home.join(".local").join("share").join("opencode")];
        if let Some(data) = dirs::data_dir() {
            opencode.push(data.join("opencode"));
        }
        Roots {
            claude: env_dir("CLAUDE_CONFIG_DIR", home.join(".claude")).join("projects"),
            codex: env_dir("CODEX_HOME", home.join(".codex")).join("sessions"),
            copilot: home.join(".copilot").join("session-state"),
            vscode,
            gemini: home.join(".gemini"),
            opencode,
        }
    }

    pub fn providers(&self) -> Vec<ProviderInfo> {
        let info = |key, name, roots: Vec<&PathBuf>| ProviderInfo {
            key,
            name,
            detected: roots.iter().any(|r| r.exists()),
            roots: roots.iter().map(|r| r.display().to_string()).collect(),
        };
        let gemini_tmp = self.gemini.join("tmp");
        let vs: Vec<PathBuf> = self.vscode.iter().map(|(_, p)| p.join("workspaceStorage")).collect();
        let ag = [self.gemini.join("antigravity"), self.gemini.join("antigravity-cli")];
        vec![
            info("claude", "Claude Code", vec![&self.claude]),
            info("codex", "Codex", vec![&self.codex]),
            info("copilot", "Copilot CLI", vec![&self.copilot]),
            info("vscode", "Copilot Chat", vs.iter().collect()),
            info("gemini", "Gemini CLI", vec![&gemini_tmp]),
            info("antigravity", "Antigravity", ag.iter().collect()),
            info("opencode", "OpenCode", self.opencode.iter().collect()),
        ]
    }

    /// All session files modified after `since` (Unix ms).
    pub fn discover(&self, since: i64) -> Vec<Candidate> {
        let mut out = Vec::new();
        self.discover_claude(since, &mut out);
        self.discover_codex(since, &mut out);
        self.discover_copilot(since, &mut out);
        self.discover_vscode(since, &mut out);
        self.discover_gemini(since, &mut out);
        self.discover_presence(since, &mut out);
        out
    }

    fn discover_claude(&self, since: i64, out: &mut Vec<Candidate>) {
        for project in dirs_in(&self.claude) {
            for (path, _) in recent_files(&project, since, |n| n.ends_with(".jsonl")) {
                let id = stem(&path);
                out.push(Candidate::new(Format::Claude, "claude", path, id));
            }
            // Sub-agents live in <session-id>/subagents/agent-*.jsonl.
            for session_dir in dirs_in(&project) {
                let sub = session_dir.join("subagents");
                for (path, _) in recent_files(&sub, since, |n| n.ends_with(".jsonl")) {
                    let mut c = Candidate::new(Format::Claude, "claude", path.clone(), stem(&path));
                    c.parent = Some(file_name(&session_dir));
                    c.role = Some("subagent".into());
                    out.push(c);
                }
            }
        }
    }

    fn discover_codex(&self, since: i64, out: &mut Vec<Candidate>) {
        // sessions/YYYY/MM/DD/rollout-*.jsonl; long threads keep appending to old days.
        for year in dirs_in(&self.codex) {
            for month in dirs_in(&year) {
                for day in dirs_in(&month) {
                    for (path, _) in recent_files(&day, since, |n| n.ends_with(".jsonl")) {
                        let id = codex_id(&stem(&path));
                        out.push(Candidate::new(Format::Codex, "codex", path, id));
                    }
                }
            }
        }
    }

    fn discover_copilot(&self, since: i64, out: &mut Vec<Candidate>) {
        for dir in dirs_in(&self.copilot) {
            let events = dir.join("events.jsonl");
            let Ok(meta) = fs::metadata(&events) else { continue };
            if mtime_ms(&meta) < since {
                continue;
            }
            let mut c = Candidate::new(Format::Copilot, "copilot", events, file_name(&dir));
            if let Ok(yaml) = fs::read_to_string(dir.join("workspace.yaml")) {
                let lines: Vec<&str> = yaml.lines().collect();
                for (i, line) in lines.iter().enumerate() {
                    if line.starts_with(' ') {
                        continue;
                    }
                    if let Some((k, v)) = line.split_once(':') {
                        let mut v = v.trim().trim_matches('"').to_string();
                        // Block scalars (`name: |-`) continue on the next indented line.
                        if v.starts_with('|') || v.starts_with('>') {
                            v = lines.get(i + 1).map(|l| l.trim().to_string()).unwrap_or_default();
                        }
                        match k.trim() {
                            "cwd" if !v.is_empty() => c.cwd = Some(v),
                            "name" if !v.is_empty() => c.title = Some(v),
                            "client_name" if !v.is_empty() => c.client = Some(v),
                            _ => {}
                        }
                    }
                }
            }
            out.push(c);
        }
    }

    fn discover_vscode(&self, since: i64, out: &mut Vec<Candidate>) {
        for (edition, user) in &self.vscode {
            for ws in dirs_in(&user.join("workspaceStorage")) {
                let chats = ws.join("chatSessions");
                let files = recent_files(&chats, since, |n| n.ends_with(".jsonl") || n.ends_with(".json"));
                if files.is_empty() {
                    continue;
                }
                let cwd = vscode::workspace_folder(&ws.join("workspace.json"));
                for (path, _) in files {
                    let mut c = Candidate::new(Format::VsCode, "vscode", path.clone(), stem(&path));
                    c.cwd = cwd.clone();
                    c.client = Some(edition.clone());
                    out.push(c);
                }
            }
            let empty = user.join("globalStorage").join("emptyWindowChatSessions");
            for (path, _) in recent_files(&empty, since, |n| n.ends_with(".jsonl") || n.ends_with(".json")) {
                let mut c = Candidate::new(Format::VsCode, "vscode", path.clone(), stem(&path));
                c.client = Some(edition.clone());
                out.push(c);
            }
        }
    }

    fn discover_gemini(&self, since: i64, out: &mut Vec<Candidate>) {
        for project in dirs_in(&self.gemini.join("tmp")) {
            let root = fs::read_to_string(project.join(".project_root"))
                .ok()
                .map(|s| s.trim().to_string());
            for (path, _) in recent_files(&project.join("chats"), since, |n| n.ends_with(".json")) {
                let mut c = Candidate::new(Format::Gemini, "gemini", path.clone(), stem(&path));
                c.cwd = root.clone();
                out.push(c);
            }
        }
    }

    fn discover_presence(&self, since: i64, out: &mut Vec<Candidate>) {
        for app in ["antigravity", "antigravity-cli"] {
            let base = self.gemini.join(app);
            // One conversation is `<id>.db` plus `-wal`/`-shm` companions (or a legacy `<id>.pb`).
            let mut groups: std::collections::BTreeMap<String, Vec<(PathBuf, i64)>> = Default::default();
            for (path, mtime) in recent_files(&base.join("conversations"), 0, |_| true) {
                let name = file_name(&path);
                // `-shm` changes whenever anyone reads the database (AgentTally included), and an
                // empty `-wal` holds nothing new: neither is activity.
                if name.ends_with("-shm") {
                    continue;
                }
                if name.ends_with("-wal") && fs::metadata(&path).map(|m| m.len() == 0).unwrap_or(true) {
                    continue;
                }
                let id = name.split('.').next().unwrap_or(&name).to_string();
                groups.entry(id).or_default().push((path, mtime));
            }
            for (id, mut files) in groups {
                if files.iter().all(|(_, m)| *m < since) {
                    continue;
                }
                // The main database is the anchor; writes usually land in the -wal first.
                files.sort_by_key(|(p, _)| !p.extension().is_some_and(|e| e == "db" || e == "pb"));
                let (main, _) = files.remove(0);
                let mut c = Candidate::new(Format::Antigravity, "antigravity", main, id.clone());
                c.companions = files.into_iter().map(|(p, _)| p).collect();
                c.title = antigravity_title(&base.join("brain").join(&id))
                    .or_else(|| Some("Antigravity conversation".into()));
                c.client = Some(app.into());
                out.push(c);
            }
        }
        for base in &self.opencode {
            let main = base.join("opencode.db");
            let wal = base.join("opencode.db-wal");
            let recent = [&main, &wal]
                .iter()
                .any(|p| fs::metadata(p).map(|m| mtime_ms(&m) >= since).unwrap_or(false));
            if recent && main.exists() {
                let mut c = Candidate::new(Format::Presence, "opencode", main, "opencode");
                c.companions = vec![wal];
                c.title = Some("OpenCode session".into());
                out.push(c);
            }
        }
    }
}

/// First Markdown heading of Antigravity's task.md for a conversation, if any.
fn antigravity_title(brain: &Path) -> Option<String> {
    let text = fs::read_to_string(brain.join("task.md")).ok()?;
    let line = text.lines().find(|l| !l.trim().is_empty())?;
    Some(crate::util::clip(line.trim_start_matches('#').trim(), 80))
}

/// rollout-2026-09-29T11-59-25-<uuid> → <uuid>
fn codex_id(stem: &str) -> String {
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() >= 11 {
        parts[parts.len() - 5..].join("-")
    } else {
        stem.to_string()
    }
}

fn dirs_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    rd.filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .collect()
}

fn recent_files(dir: &Path, since: i64, accept: impl Fn(&str) -> bool) -> Vec<(PathBuf, i64)> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    rd.filter_map(Result::ok)
        .filter(|e| accept(&e.file_name().to_string_lossy()))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let m = mtime_ms(&meta);
            (meta.is_file() && m >= since).then(|| (e.path(), m))
        })
        .collect()
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn codex_ids() {
        assert_eq!(
            super::codex_id("rollout-2026-09-29T11-59-25-01a0ec9a-d262-7710-8467-caff9d403097"),
            "01a0ec9a-d262-7710-8467-caff9d403097"
        );
    }
}
