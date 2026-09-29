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
            Some("modelState") => model_state(sess, body),
            Some("result") => done(sess),
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
    for r in body.get("requests").and_then(Value::as_array).into_iter().flatten() {
        request(sess, r);
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

fn request(sess: &mut Session, r: &Value) {
    let ts = ts_of(r.get("timestamp"));
    let text = r.pointer("/message/text").and_then(Value::as_str).unwrap_or("");
    if let Some(t) = clean_prompt(text) {
        sess.push(Activity::new(ts, Kind::User, t));
    }
    for part in r.get("response").and_then(Value::as_array).into_iter().flatten() {
        response_part(sess, part);
    }
    if let Some(ms) = r.get("modelState") {
        model_state(sess, ms);
    } else if r.get("result").map(|x| !x.is_null()).unwrap_or(false) {
        done(sess);
    }
}

fn model_state(sess: &mut Session, ms: &Value) {
    let finished = ms.get("completedAt").is_some() || ms.get("value").and_then(Value::as_u64).unwrap_or(0) > 0;
    if finished {
        done(sess);
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

fn decode_uri(uri: &str) -> String {
    let path = uri.trim_start_matches("file:///").split('#').next().unwrap_or(uri);
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&path[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `workspace.json` → the folder the VS Code window has open.
pub fn workspace_folder(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let uri = s(&v, "folder").or_else(|| s(&v, "workspace"))?;
    Some(decode_uri(uri))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_file_links() {
        assert_eq!(
            strip_links("Reading [](file:///c%3A/_GITHUB_/LearnStack/version.json)"),
            "Reading LearnStack/version.json"
        );
        assert_eq!(strip_links("Ran [tests](cmd:x) now"), "Ran tests now");
    }
}
