//! Gemini CLI: `~/.gemini/tmp/<project-hash>/chats/session-*.json`.
//! The whole conversation is rewritten on every update, so it is re-read in full.

use crate::model::{Activity, Kind, Session};
use crate::util::{clean_prompt, clip, s, summarize_args, ts_of, u64_at};
use serde_json::Value;

pub fn apply_document(sess: &mut Session, doc: &Value) {
    sess.events.clear();
    sess.tool_calls = 0;
    sess.station_counts = [0; 6];
    sess.tokens_in = 0;
    sess.tokens_out = 0;
    sess.touch(ts_of(doc.get("startTime")));

    let messages = doc.get("messages").and_then(Value::as_array);
    for m in messages.into_iter().flatten() {
        let ts = ts_of(m.get("timestamp"));
        let text = content_text(m.get("content"));
        match s(m, "type").unwrap_or("") {
            "user" => {
                if let Some(t) = clean_prompt(&text) {
                    sess.push(Activity::new(ts, Kind::User, t));
                }
            }
            "gemini" | "model" => {
                if let Some(model) = s(m, "model") {
                    sess.model = Some(model.to_string());
                }
                sess.tokens_in += u64_at(m, &["tokens", "input"]) + u64_at(m, &["tokens", "cached"]);
                sess.tokens_out += u64_at(m, &["tokens", "output"]);
                if m.get("thoughts").and_then(Value::as_array).map(|a| !a.is_empty()).unwrap_or(false) {
                    sess.push(Activity::new(ts, Kind::Think, ""));
                }
                let calls = m.get("toolCalls").and_then(Value::as_array);
                for call in calls.into_iter().flatten() {
                    let name = s(call, "name").unwrap_or("tool");
                    let args = call.get("args").cloned().unwrap_or(Value::Null);
                    let mut act = Activity::tool(ts_of(call.get("timestamp")).max(ts), name, summarize_args(&args));
                    if act.text.is_empty() {
                        act.text = s(call, "displayName").unwrap_or("").to_string();
                    }
                    sess.push(act);
                    if s(call, "status") == Some("error") {
                        sess.push(Activity::new(ts, Kind::Error, "A tool call failed"));
                    }
                }
                if !text.trim().is_empty() {
                    sess.push(Activity::new(ts, Kind::Reply, clip(&text, 160)));
                    if calls.map(|c| c.is_empty()).unwrap_or(true) {
                        sess.push(Activity::new(ts, Kind::Done, ""));
                    }
                }
            }
            "error" => sess.push(Activity::new(ts, Kind::Error, clip(&text, 120))),
            _ => sess.touch(ts),
        }
    }
    sess.touch(ts_of(doc.get("lastUpdated")));
}

fn content_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(t)) => t.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| s(p, "text").or_else(|| p.as_str()))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}
