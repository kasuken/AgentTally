//! Codex rollouts: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.

use crate::model::{Activity, Kind, Session};
use crate::util::{clean_prompt, clip, path_str, s, short_path, summarize_args, ts_of, u64_at};
use serde_json::Value;

pub fn apply(sess: &mut Session, v: &Value) {
    let ts = ts_of(v.get("timestamp"));
    let p = v.get("payload").unwrap_or(&Value::Null);
    match s(v, "type").unwrap_or("") {
        "session_meta" => {
            if let Some(cwd) = s(p, "cwd") {
                sess.cwd = Some(cwd.to_string());
            }
            if let Some(o) = s(p, "originator") {
                sess.client = Some(o.to_string());
            }
            if let Some(parent) = s(p, "parent_thread_id") {
                sess.parent = Some(parent.to_string());
            }
            if let Some(sub) = p.pointer("/source/subagent") {
                let role = match sub {
                    Value::String(r) => r.clone(),
                    Value::Object(o) => o
                        .values()
                        .find_map(|x| x.as_str().map(str::to_string))
                        .or_else(|| o.keys().next().cloned())
                        .unwrap_or_else(|| "subagent".into()),
                    _ => "subagent".into(),
                };
                sess.role = Some(role);
            }
            sess.touch(ts_of(p.get("timestamp")).max(ts));
        }
        "turn_context" => {
            if let Some(cwd) = s(p, "cwd") {
                sess.cwd = Some(cwd.to_string());
            }
            if let Some(m) = s(p, "model") {
                sess.model = Some(m.to_string());
            }
        }
        "event_msg" => event(sess, p, ts),
        "response_item" => item(sess, p, ts),
        "compacted" => sess.push(Activity::new(ts, Kind::System, "Context compacted")),
        _ => {}
    }
}

fn event(sess: &mut Session, p: &Value, ts: i64) {
    match s(p, "type").unwrap_or("") {
        "task_started" => sess.push(Activity::new(ts, Kind::Think, "")),
        "task_complete" => {
            let msg = s(p, "last_agent_message").and_then(clean_prompt).unwrap_or_default();
            sess.push(Activity::new(ts, Kind::Done, msg));
        }
        "turn_aborted" => sess.push(Activity::new(ts, Kind::Done, "Turn aborted")),
        "user_message" => {
            if let Some(t) = s(p, "message").and_then(clean_prompt) {
                sess.push(Activity::new(ts, Kind::User, t));
            }
        }
        "agent_message" => {
            if let Some(t) = s(p, "message") {
                sess.push(Activity::new(ts, Kind::Reply, clip(t, 160)));
            }
        }
        "token_count" => {
            let total = |k: &str| u64_at(p, &["info", "total_token_usage", k]);
            if total("total_tokens") > 0 {
                sess.tokens_in = total("input_tokens");
                sess.tokens_out = total("output_tokens");
            }
            sess.touch(ts);
        }
        "thread_settings_applied" => {
            if let Some(m) = path_str(p, &["thread_settings", "model"]) {
                sess.model = Some(m.to_string());
            }
        }
        "item_completed" => {
            let it = p.get("item").unwrap_or(&Value::Null);
            let text = it
                .get("content")
                .and_then(Value::as_array)
                .and_then(|c| c.iter().find_map(|x| s(x, "text")))
                .or_else(|| s(it, "text"));
            match (s(it, "type"), text) {
                (Some("UserMessage"), Some(t)) => {
                    if let Some(t) = clean_prompt(t) {
                        sess.push(Activity::new(ts, Kind::User, t));
                    }
                }
                (Some("AgentMessage"), Some(t)) => sess.push(Activity::new(ts, Kind::Reply, clip(t, 160))),
                _ => sess.touch(ts),
            }
        }
        "exec_approval_request" | "apply_patch_approval_request" | "request_user_input" | "elicitation_request" => {
            sess.push(Activity::new(ts, Kind::Wait, "Waiting for your approval"));
            sess.blocked = true;
        }
        "error" | "stream_error" => {
            let m = s(p, "message").unwrap_or("Error");
            sess.push(Activity::new(ts, Kind::Error, clip(m, 120)));
        }
        _ => sess.touch(ts),
    }
}

fn item(sess: &mut Session, p: &Value, ts: i64) {
    match s(p, "type").unwrap_or("") {
        "function_call" => {
            let name = s(p, "name").unwrap_or("tool");
            let args = p.get("arguments").cloned().unwrap_or(Value::Null);
            sess.blocked = false;
            sess.push(Activity::tool(ts, name, summarize_args(&args)));
        }
        "custom_tool_call" => {
            let name = s(p, "name").unwrap_or("tool");
            let input = s(p, "input").unwrap_or("");
            let (tool, text) = custom_call(name, input);
            sess.blocked = false;
            sess.push(Activity::tool(ts, &tool, text));
        }
        "local_shell_call" => {
            let cmd = p
                .pointer("/action/command")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            sess.push(Activity::tool(ts, "shell", clip(&cmd, 110)));
        }
        "web_search_call" => {
            let q = path_str(p, &["action", "query"]).unwrap_or("");
            sess.push(Activity::tool(ts, "web_search", clip(q, 110)));
        }
        "reasoning" => sess.push(Activity::new(ts, Kind::Think, "")),
        "message" if s(p, "role") == Some("assistant") => {
            let text = p
                .get("content")
                .and_then(Value::as_array)
                .and_then(|c| c.iter().find_map(|x| s(x, "text")));
            if let Some(t) = text.filter(|t| !t.trim().is_empty()) {
                sess.push(Activity::new(ts, Kind::Reply, clip(t, 160)));
            }
        }
        _ => sess.touch(ts),
    }
}

/// Codex "code mode" wraps tool calls in a JS snippet: `await tools.exec_command({"cmd": ...})`.
/// Pull out the inner tool name and its most telling argument.
fn custom_call(name: &str, input: &str) -> (String, String) {
    if name == "apply_patch" || input.starts_with("*** Begin Patch") {
        return ("apply_patch".into(), patch_target(input));
    }
    let inner = input.find("tools.").map(|i| {
        let rest = &input[i + 6..];
        let end = rest.find(|c: char| !(c.is_alphanumeric() || c == '_')).unwrap_or(rest.len());
        rest[..end].to_string()
    });
    let tool = inner.filter(|t| !t.is_empty()).unwrap_or_else(|| name.to_string());
    for key in ["\"cmd\":\"", "\"command\":\"", "\"path\":\"", "\"query\":\"", "\"url\":\""] {
        if let Some(i) = input.find(key) {
            let raw = json_string_at(&input[i + key.len()..]);
            let text = if key.contains("path") { short_path(&raw) } else { clip(&raw, 110) };
            return (tool, text);
        }
    }
    if input.contains("*** Begin Patch") {
        return ("apply_patch".into(), patch_target(input));
    }
    (tool, clip(input.lines().next().unwrap_or(""), 110))
}

fn patch_target(patch: &str) -> String {
    for marker in ["*** Update File: ", "*** Add File: ", "*** Delete File: "] {
        if let Some(i) = patch.find(marker) {
            let rest = &patch[i + marker.len()..];
            // The patch may be raw text or still JSON-escaped (`\n`).
            let line = rest.lines().next().unwrap_or(rest);
            let line = line.split("\\n").next().unwrap_or(line);
            return short_path(line.trim());
        }
    }
    "patch".into()
}

/// Decodes a JSON string body starting right after its opening quote.
fn json_string_at(rest: &str) -> String {
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => break,
            '\\' => match chars.next() {
                Some('n') | Some('r') | Some('t') => out.push(' '),
                Some(o) => out.push(o),
                None => break,
            },
            c => out.push(c),
        }
        if out.len() > 400 {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_mode_calls() {
        let (t, x) = custom_call("exec", r#"const r = await tools.exec_command({"cmd":"cargo test --all","yield_time_ms":1000});"#);
        assert_eq!(t, "exec_command");
        assert_eq!(x, "cargo test --all");
        let (t, x) = custom_call("apply_patch", "*** Begin Patch\n*** Update File: C:\\p\\src\\main.rs\n@@");
        assert_eq!(t, "apply_patch");
        assert_eq!(x, "src/main.rs");
    }
}
