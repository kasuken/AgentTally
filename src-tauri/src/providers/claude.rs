//! Claude Code transcripts: `~/.claude/projects/<project>/<session>.jsonl`.

use crate::model::{Activity, Kind, Session};
use crate::util::{clean_prompt, clip, s, summarize_args, ts_of, u64_at};
use serde_json::Value;

pub fn apply(sess: &mut Session, v: &Value) {
    let ts = ts_of(v.get("timestamp"));
    // The first cwd is the project root; later lines follow the agent's `cd`s.
    if let (None, Some(cwd)) = (&sess.cwd, s(v, "cwd")) {
        sess.cwd = Some(cwd.to_string());
    }
    if let Some(b) = s(v, "gitBranch").filter(|b| !b.is_empty() && *b != "HEAD") {
        sess.branch = Some(b.to_string());
    }
    if let Some(e) = s(v, "entrypoint") {
        sess.client = Some(e.to_string());
    }

    match s(v, "type").unwrap_or("") {
        "custom-title" => {
            if let Some(t) = s(v, "customTitle") {
                sess.title = Some(t.to_string());
            }
        }
        "ai-title" | "agent-name" | "summary" => {
            let t = s(v, "aiTitle").or_else(|| s(v, "agentName")).or_else(|| s(v, "summary"));
            if let (None, Some(t)) = (&sess.title, t) {
                sess.title = Some(t.to_string());
            }
        }
        "user" => user(sess, v, ts),
        "assistant" => assistant(sess, v, ts),
        "system" => match s(v, "subtype").unwrap_or("") {
            "api_error" => sess.push(Activity::new(ts, Kind::Error, "API error, retrying")),
            "stop_hook_summary" | "turn_duration" => end_turn(sess, ts),
            "compact_boundary" => sess.push(Activity::new(ts, Kind::System, "Context compacted")),
            _ => sess.touch(ts),
        },
        _ => {}
    }
}

fn end_turn(sess: &mut Session, ts: i64) {
    if sess.turn_open {
        sess.push(Activity::new(ts, Kind::Done, ""));
    }
}

fn user(sess: &mut Session, v: &Value, ts: i64) {
    if v.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return;
    }
    let content = v.pointer("/message/content");
    match content {
        Some(Value::String(text)) => prompt(sess, text, ts),
        Some(Value::Array(items)) => {
            for item in items {
                match s(item, "type") {
                    Some("tool_result") => {
                        if item.get("is_error").and_then(Value::as_bool) == Some(true) {
                            sess.push(Activity::new(ts, Kind::Error, "A tool call failed"));
                        } else {
                            // The result of the current tool: still busy with it until the next step.
                            sess.touch(ts);
                            sess.turn_open = true;
                        }
                    }
                    Some("text") => prompt(sess, s(item, "text").unwrap_or(""), ts),
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

fn prompt(sess: &mut Session, text: &str, ts: i64) {
    if text.starts_with("[Request interrupted") {
        sess.push(Activity::new(ts, Kind::Done, "Interrupted by you"));
        return;
    }
    if text.contains("<local-command-stdout>") || text.contains("<local-command-caveat>") {
        return;
    }
    if let Some(p) = clean_prompt(text) {
        sess.push(Activity::new(ts, Kind::User, p));
    }
}

fn assistant(sess: &mut Session, v: &Value, ts: i64) {
    let Some(msg) = v.get("message") else { return };
    if let Some(m) = s(msg, "model").filter(|m| !m.starts_with('<')) {
        sess.model = Some(m.to_string());
    }
    // One API message is written as several lines (one per content block)
    // that repeat the same usage numbers.
    let mid = s(msg, "id").map(str::to_string);
    if mid.is_some() && mid != sess.last_usage_id {
        let u = |k: &str| u64_at(msg, &["usage", k]);
        sess.tokens_in += u("input_tokens") + u("cache_read_input_tokens") + u("cache_creation_input_tokens");
        sess.tokens_out += u("output_tokens");
        sess.last_usage_id = mid;
    }
    if let Some(Value::Array(items)) = msg.get("content") {
        for item in items {
            match s(item, "type") {
                Some("tool_use") => {
                    let name = s(item, "name").unwrap_or("tool");
                    let input = item.get("input").cloned().unwrap_or(Value::Null);
                    sess.push(Activity::tool(ts, name, summarize_args(&input)));
                }
                Some("text") => {
                    let t = s(item, "text").unwrap_or("");
                    if !t.trim().is_empty() {
                        sess.push(Activity::new(ts, Kind::Reply, clip(t, 160)));
                    }
                }
                Some("thinking") | Some("redacted_thinking") => {
                    sess.push(Activity::new(ts, Kind::Think, ""));
                }
                _ => {}
            }
        }
    }
    if matches!(s(msg, "stop_reason"), Some("end_turn") | Some("stop_sequence")) {
        sess.push(Activity::new(ts, Kind::Done, ""));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Station;
    use serde_json::json;

    #[test]
    fn tool_use_and_end() {
        let mut sess = Session::new("claude", "s");
        apply(&mut sess, &json!({"type":"user","timestamp":"2026-09-29T10:00:00Z","cwd":"C:\\p\\demo",
            "message":{"role":"user","content":"Fix the tests"}}));
        apply(&mut sess, &json!({"type":"assistant","timestamp":"2026-09-29T10:00:05Z",
            "message":{"id":"m1","model":"claude-opus-5-5","content":[{"type":"tool_use","name":"Read","input":{"file_path":"C:\\p\\demo\\src\\lib.rs"}}],
            "stop_reason":"tool_use","usage":{"input_tokens":10,"output_tokens":5}}}));
        let cur = sess.current().unwrap();
        assert_eq!(cur.station, Station::Library);
        assert_eq!(cur.text, "src/lib.rs");
        assert!(sess.turn_open);
        apply(&mut sess, &json!({"type":"assistant","timestamp":"2026-09-29T10:00:09Z",
            "message":{"id":"m2","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"}}));
        assert!(!sess.turn_open);
        assert_eq!(sess.tokens_in, 10);
        assert_eq!(sess.first_prompt.as_deref(), Some("Fix the tests"));
    }
}
