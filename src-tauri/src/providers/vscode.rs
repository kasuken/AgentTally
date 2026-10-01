//! GitHub Copilot Chat in VS Code: `workspaceStorage/<hash>/chatSessions/<id>.jsonl`.
//!
//! The file is a log of JSON patches over a session object:
//! `kind 0` = full snapshot, `kind 1` = set value at path `k`, `kind 2` = append to array at `k`.

use crate::model::{Activity, Kind, Session};
use crate::util::{clean_prompt, clip, s, short_path, ts_of};
use serde_json::Value;
use std::path::Path;

pub fn apply(sess: &mut Session, v: &Value) {
    let body = v.get("v").unwrap_or(&Value::Null);
    let key: Vec<&str> = v
        .get("k")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    // `["requests", 3, "response"]` → 3 (the string key above leaves the numbers out).
    let index = v.get("k").and_then(Value::as_array).and_then(|a| a.iter().find_map(Value::as_u64));
    // Older builds wrote the whole session as a single JSON document.
    if v.get("kind").is_none() && v.get("requests").is_some() {
        return snapshot(sess, v);
    }
    match v.get("kind").and_then(Value::as_u64) {
        Some(0) => snapshot(sess, body),
        Some(1) => match key.last().copied() {
            Some("customTitle") => {
                if let Some(t) = body.as_str() {
                    sess.title = Some(t.to_string());
                }
            }
            Some("modelState") => {
                if model_state(sess, body) {
                    finished(sess, index);
                }
            }
            Some("result") => {
                done(sess);
                finished(sess, index);
            }
            Some("selectedModel") => model(sess, body),
            _ => {}
        },
        Some(2) => match key.as_slice() {
            ["requests"] => {
                for r in body.as_array().into_iter().flatten() {
                    request(sess, r);
                }
            }
            [.., "response"] => {
                for part in body.as_array().into_iter().flatten() {
                    response_part(sess, part);
                }
                // VS Code writes the final response after the result; it must not reopen the turn.
                if index.is_some() && sess.finished_request >= index {
                    done(sess);
                }
            }
            _ => {}
        },
        _ => {}
    }
}

fn snapshot(sess: &mut Session, body: &Value) {
    if let Some(t) = s(body, "customTitle") {
        sess.title = Some(t.to_string());
    }
    sess.touch(ts_of(body.get("creationDate")));
    if let Some(m) = body.pointer("/inputState/selectedModel") {
        model(sess, m);
    }
    for (i, r) in body.get("requests").and_then(Value::as_array).into_iter().flatten().enumerate() {
        if request(sess, r) {
            finished(sess, Some(i as u64));
        }
    }
}

fn model(sess: &mut Session, m: &Value) {
    let name = m
        .pointer("/metadata/name")
        .and_then(Value::as_str)
        .or_else(|| s(m, "identifier"));
    if let Some(n) = name {
        sess.model = Some(n.to_string());
    }
}

/// Reads one request; returns whether it has already finished.
fn request(sess: &mut Session, r: &Value) -> bool {
    let ts = ts_of(r.get("timestamp"));
    let text = r.pointer("/message/text").and_then(Value::as_str).unwrap_or("");
    if let Some(t) = clean_prompt(text) {
        sess.push(Activity::new(ts, Kind::User, t));
    }
    for part in r.get("response").and_then(Value::as_array).into_iter().flatten() {
        response_part(sess, part);
    }
    if let Some(ms) = r.get("modelState") {
        model_state(sess, ms)
    } else if r.get("result").map(|x| !x.is_null()).unwrap_or(false) {
        done(sess);
        true
    } else {
        false
    }
}

/// Closes the turn when the model state says the request is complete; returns whether it is.
fn model_state(sess: &mut Session, ms: &Value) -> bool {
    let finished = ms.get("completedAt").is_some() || ms.get("value").and_then(Value::as_u64).unwrap_or(0) > 0;
    if finished {
        done(sess);
    }
    finished
}

fn finished(sess: &mut Session, request: Option<u64>) {
    if request.is_some() {
        sess.finished_request = sess.finished_request.max(request);
    }
}

fn done(sess: &mut Session) {
    if sess.turn_open {
        sess.push(Activity::new(0, Kind::Done, ""));
    }
}

fn response_part(sess: &mut Session, p: &Value) {
    match s(p, "kind") {
        Some("toolInvocationSerialized") | Some("toolInvocation") => {
            let tool = s(p, "toolId").unwrap_or("tool");
            let msg = p
                .get("pastTenseMessage")
                .or_else(|| p.get("invocationMessage"))
                .map(|m| s(m, "value").or_else(|| m.as_str()).unwrap_or(""))
                .unwrap_or("");
            sess.push(Activity::tool(0, tool, clip(&strip_links(msg), 110)));
        }
        Some("markdownContent") => {
            if let Some(t) = p.pointer("/content/value").and_then(Value::as_str) {
                if !t.trim().is_empty() {
                    sess.push(Activity::new(0, Kind::Reply, clip(t, 160)));
                }
            }
        }
        Some("thinking") => sess.push(Activity::new(0, Kind::Think, "")),
        None => {
            if let Some(t) = s(p, "value").filter(|t| !t.trim().is_empty()) {
                sess.push(Activity::new(0, Kind::Reply, clip(t, 160)));
            }
        }
        _ => {}
    }
}

/// `Reading [](file:///c%3A/p/src/a.rs)` → `Reading src/a.rs`
pub fn strip_links(msg: &str) -> String {
    let mut out = String::new();
    let mut rest = msg;
    while let Some(start) = rest.find('[') {
        let Some(mid) = rest[start..].find("](") else { break };
        let mid = start + mid;
        let Some(end) = rest[mid..].find(')') else { break };
        let end = mid + end;
        out.push_str(&rest[..start]);
        let label = &rest[start + 1..mid];
        let target = &rest[mid + 2..end];
        if label.trim().is_empty() {
            out.push_str(&short_path(&decode_uri(target)));
        } else {
            out.push_str(label);
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Percent-decodes a `file://` URI into a path: `file:///c%3A/x` → `c:/x`,
/// `file:///home/me/x` → `/home/me/x`.
pub fn decode_uri(uri: &str) -> String {
    let rest = uri.strip_prefix("file://").unwrap_or(uri);
    let bytes = rest.split(['#', '?']).next().unwrap_or(rest).as_bytes();
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    let path = String::from_utf8_lossy(&out).into_owned();
    // Windows drive paths come as `/c:/…`; keep the leading slash for Unix paths.
    let b = path.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        path[1..].to_string()
    } else {
        path
    }
}

/// `workspace.json` → the folder the VS Code window has open.
pub fn workspace_folder(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let uri = s(&v, "folder").or_else(|| s(&v, "workspace"))?;
    Some(crate::util::native_path(&decode_uri(uri)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn final_response_written_after_the_result_does_not_reopen_the_turn() {
        use crate::model::Status;
        let mut sess = Session::new("vscode", "x");
        let tool = serde_json::json!({ "kind": "toolInvocationSerialized", "toolId": "run_in_terminal", "isComplete": true });
        for line in [
            serde_json::json!({ "kind": 2, "k": ["requests"], "v": [{ "timestamp": 1_000, "message": { "text": "Publish it" }, "response": [], "modelState": { "value": 0 } }] }),
            serde_json::json!({ "kind": 2, "k": ["requests", 0, "response"], "v": [tool.clone()] }),
            serde_json::json!({ "kind": 1, "k": ["requests", 0, "result"], "v": { "timings": {} } }),
            serde_json::json!({ "kind": 1, "k": ["requests", 0, "modelState"], "v": { "value": 1, "completedAt": 2_000 } }),
            // VS Code appends the final response parts, tool calls included, after the result.
            serde_json::json!({ "kind": 2, "k": ["requests", 0, "response"], "v": [{ "value": "Published." }, tool] }),
        ] {
            apply(&mut sess, &line);
        }
        assert!(!sess.turn_open);
        assert_eq!(sess.status(sess.last_ts + 3 * 60_000), Status::Waiting);

        // The next request opens a new turn as usual.
        let next = sess.last_ts + 1;
        apply(&mut sess, &serde_json::json!({ "kind": 2, "k": ["requests"], "v": [{ "timestamp": next, "message": { "text": "Again" }, "response": [], "modelState": { "value": 0 } }] }));
        apply(&mut sess, &serde_json::json!({ "kind": 2, "k": ["requests", 1, "response"], "v": [{ "kind": "toolInvocationSerialized", "toolId": "read_file" }] }));
        assert!(sess.turn_open);
    }

    #[test]
    fn strips_file_links() {
        assert_eq!(
            strip_links("Reading [](file:///c%3A/code/shop-api/version.json)"),
            "Reading shop-api/version.json"
        );
        assert_eq!(strip_links("Ran [tests](cmd:x) now"), "Ran tests now");
    }

    #[test]
    fn decodes_file_uris_on_every_platform() {
        assert_eq!(decode_uri("file:///c%3A/code/app"), "c:/code/app");
        assert_eq!(decode_uri("file:///home/me/my%20app#frag"), "/home/me/my app");
        assert_eq!(decode_uri("file:///x/%E2%9C%93%"), "/x/✓%"); // trailing % must not panic
        assert_eq!(crate::util::native_path("c:/code/app/"), r"C:\code\app");
        assert_eq!(crate::util::native_path("/home/me/app"), "/home/me/app");
    }
}
