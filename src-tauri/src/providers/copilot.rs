//! GitHub Copilot CLI: `~/.copilot/session-state/<session>/events.jsonl`.

use crate::model::{Activity, Kind, Session};
use crate::util::{clean_prompt, clip, path_str, s, summarize_args, ts_of, u64_at};
use serde_json::Value;

pub fn apply(sess: &mut Session, v: &Value) {
    let ts = ts_of(v.get("timestamp"));
    let d = v.get("data").unwrap_or(&Value::Null);
    match s(v, "type").unwrap_or("") {
        "session.start" | "session.resume" => {
            sess.ended = false;
            if let Some(cwd) = path_str(d, &["context", "cwd"]) {
                sess.cwd = Some(cwd.to_string());
            }
            if let Some(m) = s(d, "selectedModel") {
                sess.model = Some(m.to_string());
            }
            sess.touch(ts);
        }
        "session.shutdown" => {
            sess.push(Activity::new(ts, Kind::Done, "Session closed"));
            sess.ended = true;
        }
        "session.model_change" => {
            if let Some(m) = s(d, "newModel").or_else(|| s(d, "model")) {
                sess.model = Some(m.to_string());
            }
        }
        "session.auto_mode_resolved" => {
            if let Some(m) = s(d, "chosenModel") {
                sess.model = Some(m.to_string());
            }
        }
        "user.message" => {
            sess.ended = false;
            if let Some(t) = s(d, "content").and_then(clean_prompt) {
                sess.push(Activity::new(ts, Kind::User, t));
            }
        }
        "assistant.turn_start" | "assistant.reasoning" | "model.turn_started" => {
            sess.push(Activity::new(ts, Kind::Think, ""))
        }
        "assistant.message" => {
            if let Some(m) = s(d, "model") {
                sess.model = Some(m.to_string());
            }
            if let Some(t) = s(d, "content").filter(|t| !t.trim().is_empty()) {
                sess.push(Activity::new(ts, Kind::Reply, clip(t, 160)));
            } else {
                sess.touch(ts);
            }
        }
        "assistant.usage" => {
            sess.tokens_in += u64_at(d, &["inputTokens"]);
            sess.tokens_out += u64_at(d, &["outputTokens"]);
        }
        "tool.execution_start" => {
            let name = s(d, "toolName").unwrap_or("tool");
            let args = d.get("arguments").cloned().unwrap_or(Value::Null);
            if name == "report_intent" {
                let intent = summarize_args(&args);
                sess.push(Activity::new(ts, Kind::Think, intent));
                return;
            }
            let mut text = summarize_args(&args);
            if text.is_empty() {
                text = s(d, "toolTitle").map(|t| clip(t, 110)).unwrap_or_default();
            }
            sess.push(Activity::tool(ts, name, text));
        }
        "tool.execution_complete" => {
            if d.get("success").and_then(Value::as_bool) == Some(false) {
                sess.push(Activity::new(ts, Kind::Error, "A tool call failed"));
            } else {
                sess.touch(ts);
            }
        }
        "subagent.started" => {
            let name = s(d, "agentDisplayName").or_else(|| s(d, "agentName")).unwrap_or("sub-agent");
            sess.push(Activity::tool(ts, "task", format!("Started {}", name)));
        }
        "permission.requested" => {
            sess.push(Activity::new(ts, Kind::Wait, "Waiting for your permission"));
            sess.blocked = true;
        }
        "permission.completed" => {
            sess.blocked = false;
            sess.touch(ts);
        }
        // Fires after every model call; a new turn_start follows unless the agent is done.
        "assistant.turn_end" => {
            sess.touch(ts);
            sess.turn_open = false;
        }
        "session.task_complete" => sess.push(Activity::new(ts, Kind::Done, "")),
        "abort" => sess.push(Activity::new(ts, Kind::Done, "Aborted")),
        "session.error" => {
            let m = s(d, "message").unwrap_or("Session error");
            sess.push(Activity::new(ts, Kind::Error, clip(m, 120)));
        }
        "session.compaction_start" => sess.push(Activity::new(ts, Kind::System, "Compacting context")),
        _ => sess.touch(ts),
    }
}
