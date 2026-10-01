//! Normalized, provider-agnostic view of an agent session.

use serde::Serialize;
use std::collections::VecDeque;

const MAX_EVENTS: usize = 60;
const SEC: i64 = 1000;
const MIN: i64 = 60 * SEC;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    User,
    Think,
    Tool,
    Reply,
    Done,
    Error,
    Wait,
    System,
}

/// The building on the hex map a robot walks to for an activity.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Station {
    Hub,
    Library,
    Forge,
    Terminal,
    Radar,
    Tasks,
}

impl Station {
    pub const ALL: [Station; 6] = [
        Station::Hub,
        Station::Library,
        Station::Forge,
        Station::Terminal,
        Station::Radar,
        Station::Tasks,
    ];

    fn idx(self) -> usize {
        Station::ALL.iter().position(|s| *s == self).unwrap_or(0)
    }

    /// Maps a tool name from any agent onto a station.
    pub fn for_tool(name: &str) -> Station {
        let n = name.to_ascii_lowercase();
        let has = |xs: &[&str]| xs.iter().any(|x| n.contains(x));
        if has(&["web", "fetch", "http", "browser", "url", "mcp", "navigate"]) {
            Station::Radar
        } else if has(&["ask_user", "askuser", "question"]) {
            Station::Hub
        } else if has(&["todo", "task", "agent", "plan", "skill"]) {
            Station::Tasks
        } else if has(&["edit", "write", "patch", "replace", "create", "insert", "notebook"]) {
            Station::Forge
        } else if has(&["bash", "shell", "exec", "terminal", "command", "powershell", "run", "cmd"]) {
            Station::Terminal
        } else if has(&["read", "grep", "glob", "search", "find", "list", "view", "ls", "cat", "open"]) {
            Station::Library
        } else {
            Station::Tasks
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct Activity {
    pub ts: i64,
    pub kind: Kind,
    pub station: Station,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    pub text: String,
}

impl Activity {
    pub fn new(ts: i64, kind: Kind, text: impl Into<String>) -> Self {
        let station = match kind {
            Kind::Tool => Station::Tasks,
            _ => Station::Hub,
        };
        Activity { ts, kind, station, tool: None, text: text.into() }
    }

    pub fn tool(ts: i64, name: &str, text: impl Into<String>) -> Self {
        Activity {
            ts,
            kind: Kind::Tool,
            station: Station::for_tool(name),
            tool: Some(name.to_string()),
            text: text.into(),
        }
    }
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Actively running a turn: thinking, calling tools, writing.
    Working,
    /// Waiting on a permission prompt.
    Blocked,
    /// Finished its turn recently and is waiting for you.
    Waiting,
    /// Quiet for a while.
    Idle,
    /// Nothing for hours.
    Sleeping,
    /// The session was shut down.
    Offline,
}

#[derive(Clone, Debug, Default)]
pub struct Session {
    pub id: String,
    pub provider: &'static str,
    pub title: Option<String>,
    pub first_prompt: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub branch: Option<String>,
    pub client: Option<String>,
    pub parent: Option<String>,
    pub role: Option<String>,
    pub started: i64,
    pub last_ts: i64,
    pub file_mtime: i64,
    pub turn_open: bool,
    pub blocked: bool,
    pub ended: bool,
    /// Only file activity is known (binary/unknown formats).
    pub presence_only: bool,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub tool_calls: u32,
    pub station_counts: [u32; 6],
    pub events: VecDeque<Activity>,
    pub last_usage_id: Option<String>,
    /// VS Code: index of the latest request whose result has arrived.
    pub finished_request: Option<u64>,
}

impl Session {
    pub fn new(provider: &'static str, id: impl Into<String>) -> Self {
        Session { provider, id: id.into(), ..Default::default() }
    }

    pub fn touch(&mut self, ts: i64) {
        if ts > 0 {
            if self.started == 0 || ts < self.started {
                self.started = ts;
            }
            self.last_ts = self.last_ts.max(ts);
        }
    }

    pub fn push(&mut self, mut act: Activity) {
        if act.ts == 0 {
            act.ts = self.last_ts.max(self.file_mtime);
        }
        self.touch(act.ts);
        match act.kind {
            Kind::User => {
                self.turn_open = true;
                self.blocked = false;
                if self.first_prompt.is_none() && !act.text.is_empty() {
                    self.first_prompt = Some(act.text.clone());
                }
            }
            Kind::Tool | Kind::Think => self.turn_open = true,
            Kind::Done => {
                self.turn_open = false;
                self.blocked = false;
            }
            _ => {}
        }
        if act.kind == Kind::Tool {
            self.tool_calls += 1;
            self.station_counts[act.station.idx()] += 1;
        }
        // Streaming replies and repeated "thinking" beats collapse into one entry.
        if let Some(last) = self.events.back_mut() {
            let mergeable = matches!(act.kind, Kind::Reply | Kind::Think);
            if mergeable && last.kind == act.kind {
                if !act.text.is_empty() {
                    last.text = act.text;
                }
                last.ts = act.ts;
                return;
            }
        }
        self.events.push_back(act);
        while self.events.len() > MAX_EVENTS {
            self.events.pop_front();
        }
    }

    pub fn current(&self) -> Option<&Activity> {
        self.events.iter().rev().find(|a| a.kind != Kind::System)
    }

    fn activity_ts(&self) -> i64 {
        if self.last_ts > 0 {
            self.last_ts
        } else {
            self.file_mtime
        }
    }

    pub fn status(&self, now: i64) -> Status {
        let age = now - self.activity_ts();
        if self.ended {
            return Status::Offline;
        }
        if self.presence_only {
            let age = now - self.file_mtime;
            return if age < 45 * SEC {
                Status::Working
            } else if age < 30 * MIN {
                Status::Idle
            } else {
                Status::Sleeping
            };
        }
        if self.blocked && age < 30 * MIN {
            return Status::Blocked;
        }
        if self.turn_open {
            let on_tool = self.current().map(|a| a.kind == Kind::Tool).unwrap_or(false);
            if age < 2 * MIN || (on_tool && age < 20 * MIN) {
                return Status::Working;
            }
        } else if age < 5 * SEC {
            // Gap between two model turns.
            return Status::Working;
        } else if age < 20 * MIN {
            return Status::Waiting;
        }
        if age < 3 * 60 * MIN {
            Status::Idle
        } else {
            Status::Sleeping
        }
    }

    pub fn view(&self, now: i64) -> SessionView {
        let project = self
            .cwd
            .as_deref()
            .map(crate::util::project_name)
            .or_else(|| self.client.clone())
            .unwrap_or_else(|| self.provider.to_string());
        let title = self
            .title
            .clone()
            .or_else(|| self.first_prompt.clone())
            .unwrap_or_else(|| format!("{} session", project));
        let skip = self.events.len().saturating_sub(25);
        SessionView {
            key: format!("{}:{}", self.provider, self.id),
            id: self.id.clone(),
            provider: self.provider,
            title: crate::util::clip(&title, 80),
            project,
            cwd: self.cwd.clone(),
            model: self.model.clone(),
            branch: self.branch.clone(),
            client: self.client.clone(),
            parent: self.parent.clone().map(|p| format!("{}:{}", self.provider, p)),
            role: self.role.clone(),
            status: self.status(now),
            started: self.started,
            last_ts: self.activity_ts(),
            current: self.current().cloned(),
            events: self.events.iter().skip(skip).cloned().collect(),
            tokens_in: self.tokens_in,
            tokens_out: self.tokens_out,
            tool_calls: self.tool_calls,
            stations: self.station_counts,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub key: String,
    pub id: String,
    pub provider: &'static str,
    pub title: String,
    pub project: String,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub branch: Option<String>,
    pub client: Option<String>,
    pub parent: Option<String>,
    pub role: Option<String>,
    pub status: Status,
    pub started: i64,
    pub last_ts: i64,
    pub current: Option<Activity>,
    pub events: Vec<Activity>,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub tool_calls: u32,
    pub stations: [u32; 6],
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub key: &'static str,
    pub name: &'static str,
    pub detected: bool,
    pub roots: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub now: i64,
    pub providers: Vec<ProviderInfo>,
    pub sessions: Vec<SessionView>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stations() {
        assert_eq!(Station::for_tool("Read"), Station::Library);
        assert_eq!(Station::for_tool("Bash"), Station::Terminal);
        assert_eq!(Station::for_tool("apply_patch"), Station::Forge);
        assert_eq!(Station::for_tool("TodoWrite"), Station::Tasks);
        assert_eq!(Station::for_tool("WebFetch"), Station::Radar);
        assert_eq!(Station::for_tool("run_in_terminal"), Station::Terminal);
        assert_eq!(Station::for_tool("copilot_readFile"), Station::Library);
    }

    #[test]
    fn status_flow() {
        let mut s = Session::new("claude", "x");
        s.push(Activity::new(1_000, Kind::User, "hi"));
        assert_eq!(s.status(2_000), Status::Working);
        s.push(Activity::new(3_000, Kind::Done, ""));
        assert_eq!(s.status(3_000 + 60_000), Status::Waiting);
        assert_eq!(s.status(3_000 + 4 * 3_600_000), Status::Sleeping);
    }
}
