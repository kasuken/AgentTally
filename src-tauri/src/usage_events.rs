//! Historical accounting from provider records, not from live session snapshots.
//! Feed one file in order; persist observations by `(source, id)` with replacement.
//! A retraction (neither tokens nor tool category) removes a superseded row.
//! The checkpoint contains only identifiers, categories and counters, never log bodies.

use crate::providers::Format;
use crate::util::s;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
mod tests;

/// Counts exactly as reported; missing is different from an explicit zero.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tokens {
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub cache_read: Option<u64>,
    pub cache_write: Option<u64>,
    /// Subdivisions of `cache_write`, not additional tokens (Anthropic).
    pub cache_write_5m: Option<u64>,
    pub cache_write_1h: Option<u64>,
    pub reasoning: Option<u64>,
    /// Tokens in tool-use prompts (Gemini), separate from `input`.
    pub tool_input: Option<u64>,
    pub total: Option<u64>,
    pub input_includes_cache: Option<bool>,
    pub output_includes_reasoning: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    pub id: String,
    pub ts: i64,
    pub model: Option<String>,
    pub tokens: Option<Tokens>,
    pub tool_category: Option<String>,
    /// Usage first observed in a cumulative shutdown/checkpoint, not timed per call.
    pub aggregate: bool,
    /// VS Code saved only the last prompt count, not whole-turn input.
    pub partial: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UsageParser {
    model: Option<String>,
    claude_messages: BTreeMap<String, (i64, Option<String>, Tokens)>,
    codex_previous: Option<Tokens>,
    codex_last_only: BTreeSet<String>,
    copilot_calls: BTreeSet<String>,
    copilot_accounted: BTreeMap<String, CopilotModel>,
    copilot_agent_models: BTreeMap<String, String>,
    tool_starts: BTreeSet<String>,
    vscode_requests: Vec<VsRequest>,
}

impl UsageParser {
    pub(super) fn codex_totals(&self) -> Option<&Tokens> {
        self.codex_previous.as_ref()
    }

    pub fn process(&mut self, format: Format, value: &Value) -> Vec<Observation> {
        let mut out = Vec::new();
        match format {
            Format::Claude => self.claude(value, &mut out),
            Format::Codex => self.codex(value, &mut out),
            Format::Copilot => self.copilot(value, &mut out),
            Format::Gemini => gemini(value, &mut out),
            Format::VsCode => self.vscode(value, &mut out),
            Format::Presence | Format::Antigravity => {}
        }
        if matches!(format, Format::Claude | Format::Codex | Format::Copilot) {
            // Replayed starts sometimes have a later record timestamp. Keep the
            // actual first observation, including when a duplicate spans midnight.
            out.retain(|o| o.tool_category.is_none() || self.tool_starts.insert(o.id.clone()));
        }
        out
    }
}

fn count(v: &Value, key: &str) -> Option<u64> {
    v.get(key)?.as_u64()
}

fn ts(v: &Value) -> i64 {
    if let Some(s) = v.as_str() {
        return chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|t| t.timestamp_millis())
            .filter(|t| *t > 0)
            .unwrap_or(0);
    }
    match v.as_i64() {
        Some(n @ 1..100_000_000_000) => n * 1000,
        Some(n) if n >= 100_000_000_000 => n,
        _ => 0,
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:/@+".contains(&b))
}

fn identifier(v: &Value, key: &str) -> Option<String> {
    s(v, key).filter(|id| valid_id(id)).map(str::to_owned)
}

fn items(v: &Value) -> impl Iterator<Item = &Value> {
    v.as_array().into_iter().flatten()
}

impl Tokens {
    fn reported(&self) -> bool {
        self.fields().iter().any(Option::is_some)
    }

    fn fields(&self) -> [Option<u64>; 9] {
        [
            self.input,
            self.output,
            self.cache_read,
            self.cache_write,
            self.reasoning,
            self.total,
            self.tool_input,
            self.cache_write_5m,
            self.cache_write_1h,
        ]
    }

    fn combine(&self, other: &Self, f: impl Fn(Option<u64>, Option<u64>) -> Option<u64>) -> Self {
        Self {
            input: f(self.input, other.input),
            output: f(self.output, other.output),
            cache_read: f(self.cache_read, other.cache_read),
            cache_write: f(self.cache_write, other.cache_write),
            reasoning: f(self.reasoning, other.reasoning),
            total: f(self.total, other.total),
            tool_input: f(self.tool_input, other.tool_input),
            cache_write_5m: f(self.cache_write_5m, other.cache_write_5m),
            cache_write_1h: f(self.cache_write_1h, other.cache_write_1h),
            input_includes_cache: self.input_includes_cache,
            output_includes_reasoning: self.output_includes_reasoning,
        }
    }

    fn add_known(&self, other: &Self) -> Self {
        self.combine(other, |a, b| match (a, b) {
            (Some(a), Some(b)) => a.checked_add(b),
            _ => a.or(b),
        })
    }
}

fn usage(out: &mut Vec<Observation>, id: String, time: i64, model: Option<String>, tokens: Tokens) {
    if time > 0 && tokens.reported() {
        out.push(Observation {
            id: format!("usage:{id}"),
            ts: time,
            model,
            tokens: Some(tokens),
            tool_category: None,
            aggregate: false,
            partial: false,
        });
    }
}

fn tool(out: &mut Vec<Observation>, id: Option<String>, time: i64, model: &Option<String>, name: &str) {
    let Some(id) = id.filter(|_| time > 0) else { return };
    let n = name.to_ascii_lowercase();
    let has = |keys: &[&str]| keys.iter().any(|k| n.contains(k));
    let category = if has(&["web", "fetch", "browser", "http"]) {
        "web"
    } else if has(&["apply_patch", "replace", "edit", "create", "write", "insert"]) {
        "edit"
    } else if has(&["bash", "shell", "terminal", "exec", "command"]) {
        "terminal"
    } else if has(&["read", "view", "search", "glob", "grep", "find", "list"]) {
        "read/search"
    } else if has(&["task", "agent", "plan", "todo", "ask_user"]) {
        "coordination"
    } else {
        "other"
    };
    out.push(Observation {
        id: format!("tool:{id}"),
        ts: time,
        model: model.clone(),
        tokens: None,
        tool_category: Some(category.into()),
        aggregate: false,
        partial: false,
    });
}

fn claude_tokens(u: &Value) -> Tokens {
    Tokens {
        input: count(u, "input_tokens"),
        output: count(u, "output_tokens"),
        cache_read: count(u, "cache_read_input_tokens"),
        cache_write: count(u, "cache_creation_input_tokens"),
        cache_write_5m: count(&u["cache_creation"], "ephemeral_5m_input_tokens"),
        cache_write_1h: count(&u["cache_creation"], "ephemeral_1h_input_tokens"),
        input_includes_cache: Some(false),
        output_includes_reasoning: true,
        ..Default::default()
    }
}

impl UsageParser {
    fn claude(&mut self, v: &Value, out: &mut Vec<Observation>) {
        if s(v, "type") != Some("assistant") {
            return;
        }
        let m = &v["message"];
        if s(m, "model") == Some("<synthetic>") {
            return;
        }
        let model = identifier(m, "model");
        let time = ts(&v["timestamp"]);
        let id = identifier(m, "id").or_else(|| identifier(v, "requestId"));
        if let Some(id) = id {
            let incoming = claude_tokens(&m["usage"]);
            if incoming.reported() && time > 0 {
                let (at, name, counters) = self
                    .claude_messages
                    .entry(id.clone())
                    .or_insert_with(|| (time, model.clone(), Tokens::default()));
                // A response can be repeated once per content block, interleaved with other
                // responses. Some blocks carry provisional counters; never charge them twice.
                *at = (*at).min(time);
                *name = name.take().or_else(|| model.clone());
                *counters = incoming.combine(counters, std::cmp::max);
                usage(out, id, *at, name.clone(), counters.clone());
            }
        }
        for (i, part) in items(&m["content"]).enumerate() {
            if s(part, "type") == Some("tool_use") {
                let id = identifier(part, "id").or_else(|| identifier(v, "uuid").map(|u| format!("{u}:{i}")));
                tool(out, id, time, &model, s(part, "name").unwrap_or(""));
            }
        }
    }
}

// ChatRecordingService.recordMessageTokens copies promptTokenCount (including cached
// content), candidatesTokenCount, thoughtsTokenCount and toolUsePromptTokenCount separately.
// https://github.com/google-gemini/gemini-cli/blob/03862c4164844c6cf8063b4cc48546ec1609cf2e/packages/core/src/services/chatRecordingService.ts
fn gemini_tokens(t: &Value) -> Tokens {
    Tokens {
        input: count(t, "input"),
        output: count(t, "output"),
        cache_read: count(t, "cached"),
        reasoning: count(t, "thoughts"),
        total: count(t, "total"),
        tool_input: count(t, "tool"),
        input_includes_cache: Some(true),
        output_includes_reasoning: false,
        ..Default::default()
    }
}

fn gemini(doc: &Value, out: &mut Vec<Observation>) {
    for (i, m) in items(&doc["messages"]).enumerate() {
        if !matches!(s(m, "type"), Some("gemini" | "model")) {
            continue;
        }
        let time = ts(&m["timestamp"]);
        let model = identifier(m, "model");
        let id = identifier(m, "id").unwrap_or_else(|| format!("at:{time}:{i}"));
        usage(out, id.clone(), time, model.clone(), gemini_tokens(&m["tokens"]));
        for (j, call) in items(&m["toolCalls"]).enumerate() {
            let call_id = identifier(call, "id").unwrap_or_else(|| format!("{id}:{j}"));
            let at = ts(&call["timestamp"]);
            tool(
                out,
                Some(call_id),
                if at > 0 { at } else { time },
                &model,
                s(call, "name").unwrap_or(""),
            );
        }
    }
}

fn codex_tokens(t: &Value) -> Tokens {
    Tokens {
        input: count(t, "input_tokens"),
        output: count(t, "output_tokens"),
        cache_read: count(t, "cached_input_tokens"),
        reasoning: count(t, "reasoning_output_tokens"),
        total: count(t, "total_tokens"),
        input_includes_cache: Some(true),
        output_includes_reasoning: true,
        ..Default::default()
    }
}

impl UsageParser {
    fn codex(&mut self, v: &Value, out: &mut Vec<Observation>) {
        let p = &v["payload"];
        let time = ts(&v["timestamp"]);
        match (s(v, "type"), s(p, "type")) {
            (Some("turn_context"), _) => self.model = identifier(p, "model"),
            (Some("event_msg"), Some("thread_settings_applied")) => {
                if let Some(m) = identifier(&p["thread_settings"], "model") {
                    self.model = Some(m);
                }
            }
            (Some("event_msg"), Some("token_count")) => {
                let current = codex_tokens(&p["info"]["total_token_usage"]);
                let last = codex_tokens(&p["info"]["last_token_usage"]);
                let (delta, key) = if current.reported() {
                    let delta = if let Some(prev) = &self.codex_previous {
                        // A rate-limit update often re-emits the previous token_count. A stale
                        // or decreasing watermark is not evidence of a fresh billed request.
                        if current.total.zip(prev.total).is_some_and(|(a, b)| a < b)
                            || current
                                .fields()
                                .iter()
                                .zip(prev.fields())
                                .any(|(a, b)| a.zip(b).is_some_and(|(x, y)| x < y))
                        {
                            return;
                        }
                        let diff = current.combine(prev, |a, b| a?.checked_sub(b?));
                        if current.total.is_some() && current.total == prev.total
                            || !diff.fields().iter().flatten().any(|n| *n > 0)
                        {
                            // A re-emission can reveal a class missing on the original
                            // watermark. It is a baseline, not new usage on this day.
                            self.codex_previous = Some(current.combine(prev, Option::or));
                            return;
                        }
                        // A field first reported mid-session cannot be retroactively assigned
                        // to this call. Use its per-call count, when one exists.
                        last.combine(&diff, Option::or)
                    } else if last.reported() {
                        last // The first watermark may contain inherited history.
                    } else {
                        current.clone()
                    };
                    let key = format!("{time}:{:?}", current.fields());
                    self.codex_previous = Some(current);
                    (delta, key)
                } else if last.reported() {
                    let key = identifier(v, "id").unwrap_or_else(|| format!("{time}:{:?}", last.fields()));
                    if !self.codex_last_only.insert(key.clone()) {
                        return;
                    }
                    self.codex_previous =
                        Some(last.add_known(self.codex_previous.as_ref().unwrap_or(&Tokens::default())));
                    (last, key)
                } else {
                    return;
                };
                usage(out, key, time, self.model.clone(), delta);
            }
            (
                Some("response_item"),
                Some(kind @ ("function_call" | "custom_tool_call" | "local_shell_call" | "web_search_call")),
            ) => {
                let id = identifier(p, "call_id")
                    .or_else(|| identifier(p, "id"))
                    .or_else(|| (time > 0).then(|| format!("at:{time}:{kind}")));
                let name = s(p, "name").unwrap_or(kind);
                tool(out, id, time, &self.model, name);
            }
            _ => {}
        }
    }
}

// Versioned CLI schemas: https://github.com/github/copilot-sdk/blob/2dfe56f7a205e0a4f13b6c02fc36afeb035650eb/nodejs/src/generated/session-events.ts
// In persisted metrics both cache classes are part of inputTokens; reasoning is part
// of outputTokens (also documented at https://ccusage.com/guide/copilot/).
fn copilot_tokens(d: &Value) -> Tokens {
    let cache_reported = d["cacheDetailsReported"].as_bool() != Some(false);
    Tokens {
        input: count(d, "inputTokens"),
        output: count(d, "outputTokens"),
        cache_read: count(d, "cacheReadTokens").filter(|_| cache_reported),
        cache_write: count(d, "cacheWriteTokens").filter(|_| cache_reported),
        reasoning: count(d, "reasoningTokens"),
        input_includes_cache: Some(true),
        output_includes_reasoning: true,
        ..Default::default()
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct CopilotModel {
    accounted: Tokens,
    missing_read: bool,
    missing_write: bool,
    missing_input: bool,
    /// If exactly one call is missing cache details, a later aggregate may
    /// determine them exactly. Otherwise attribution to calls would be a guess.
    unclassified_call: Option<(String, i64, Tokens)>,
}

impl CopilotModel {
    fn track_missing(&mut self, t: &Tokens, call: Option<(&str, i64)>) {
        let input = t.input.unwrap_or(0);
        let read = input > 0 && t.cache_read.is_none();
        let write = input > 0 && t.cache_write.is_none();
        if read || write {
            self.unclassified_call = if self.missing_read || self.missing_write {
                None
            } else {
                call.map(|(id, at)| (id.to_owned(), at, t.clone()))
            };
        }
        self.missing_read |= read;
        self.missing_write |= write;
        self.missing_input |=
            t.input.is_none() && (t.cache_read.unwrap_or(0) > 0 || t.cache_write.unwrap_or(0) > 0);
    }

    fn reconcile(
        &mut self,
        current: &Tokens,
        unknown: &Tokens,
        model: &str,
        out: &mut Vec<Observation>,
    ) -> (Tokens, bool) {
        let mut delta = current
            .combine(&self.accounted, |a, b| a?.checked_sub(b.unwrap_or(0)))
            .combine(unknown, |a, b| a.filter(|_| b.unwrap_or(0) == 0));
        if unknown.input.unwrap_or(0) > 0
            || unknown.cache_read.unwrap_or(0) > 0
            || unknown.cache_write.unwrap_or(0) > 0
        {
            delta.input = None;
            delta.cache_read = None;
            delta.cache_write = None;
        }
        let new_field = current
            .fields()
            .iter()
            .zip(self.accounted.fields())
            .any(|(a, b)| a.is_some() && b.is_none());
        // An aggregate cache count may describe input already charged on an earlier day.
        // Backfill a uniquely identifiable call only when there is NO additional input.
        // Otherwise retain the raw watermark but omit the ambiguous subdivision.
        if let Some((id, at, tokens)) = &mut self.unclassified_call {
            if delta.input == Some(0) && !self.missing_input {
                let before = tokens.clone();
                if self.missing_read && tokens.cache_read.is_none() {
                    tokens.cache_read = delta.cache_read;
                }
                if self.missing_write && tokens.cache_write.is_none() {
                    tokens.cache_write = delta.cache_write;
                }
                if tokens
                    .cache_read
                    .unwrap_or(0)
                    .saturating_add(tokens.cache_write.unwrap_or(0))
                    > tokens.input.unwrap_or(0)
                {
                    *tokens = before;
                } else if *tokens != before {
                    usage(out, id.clone(), *at, Some(model.to_owned()), tokens.clone());
                }
            }
        }
        if self.missing_read {
            delta.cache_read = None;
        }
        if self.missing_write {
            delta.cache_write = None;
        }
        if self.missing_input {
            delta.input = None;
            delta.cache_read = None;
            delta.cache_write = None;
        }
        if let Some(n) = delta.input {
            if delta
                .cache_read
                .unwrap_or(0)
                .saturating_add(delta.cache_write.unwrap_or(0))
                > n
            {
                delta.cache_read = None;
                delta.cache_write = None;
            }
        }
        self.track_missing(&delta, None);
        let covers_input = current
            .input
            .zip(self.accounted.input)
            .is_some_and(|(a, b)| a >= b)
            || self.accounted.input.is_none() && current.input.is_some();
        if covers_input {
            self.missing_input = false;
            if current.cache_read.is_some() {
                self.missing_read = false;
            }
            if current.cache_write.is_some() {
                self.missing_write = false;
            }
            if !self.missing_read && !self.missing_write {
                self.unclassified_call = None;
            }
        }
        let had_usage = self.accounted.reported();
        self.accounted = current.combine(&self.accounted, std::cmp::max);
        let emit = delta.fields().iter().flatten().any(|n| *n > 0) || (!had_usage && new_field);
        (delta, emit)
    }
}

// VS Code's chatSessionOperationLog storageSchema persists these fields directly on
// requests. `modelTotals` is whole-turn usage, including subagents; `promptTokens`
// is only the last call's prompt and `completionTokens` is whole-turn output.
// https://github.com/microsoft/vscode/blob/f7a23acef50604fd265b87740cf67519260c6fdc/src/vs/workbench/contrib/chat/common/model/chatSessionOperationLog.ts
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct VsRequest {
    key: String,
    model: Option<String>,
    time: i64,
    response_time: i64,
    completed: i64,
    prompt: Option<u64>,
    completion: Option<u64>,
    totals: Vec<(String, Tokens)>,
    emitted_slots: usize,
}

impl VsRequest {
    fn new(v: &Value, index: usize) -> Self {
        let time = ts(&v["timestamp"]);
        Self {
            key: identifier(v, "requestId").unwrap_or_else(|| format!("at:{time}:{index}")),
            model: identifier(v, "modelId"),
            time,
            response_time: ts(&v["responseTimestamp"]),
            completed: ts(&v["modelState"]["completedAt"]),
            prompt: count(v, "promptTokens"),
            completion: count(v, "completionTokens"),
            totals: Self::model_totals(&v["modelTotals"]),
            emitted_slots: 0,
        }
    }

    fn model_totals(v: &Value) -> Vec<(String, Tokens)> {
        items(v)
            .filter_map(|row| {
                let name = identifier(row, "model")?;
                let counts = Tokens {
                    input: count(row, "inputTokens"),
                    output: count(row, "outputTokens"),
                    cache_read: count(row, "cachedTokens"),
                    input_includes_cache: Some(true),
                    output_includes_reasoning: true,
                    ..Default::default()
                };
                counts.reported().then_some((name, counts))
            })
            .collect()
    }

    fn patch(&mut self, k: &str, value: &Value) -> bool {
        match k {
            "modelId" => self.model = value.as_str().filter(|id| valid_id(id)).map(str::to_owned),
            "timestamp" => self.time = ts(value),
            "responseTimestamp" => self.response_time = ts(value),
            "modelState" => self.completed = ts(&value["completedAt"]),
            "completionTokens" => self.completion = value.as_u64(),
            "promptTokens" => self.prompt = value.as_u64(),
            "modelTotals" => self.totals = Self::model_totals(value),
            _ => return false,
        }
        true
    }

    fn at(&self) -> i64 {
        [self.time, self.response_time, self.completed]
            .into_iter()
            .find(|n| *n > 0)
            .unwrap_or(0)
    }

    fn emit_usage(&mut self, out: &mut Vec<Observation>) {
        let at = self.at();
        if at == 0 {
            return;
        }
        let slot = |i| format!("{}:{i}", self.key);
        let n = if self.totals.is_empty() {
            let t = Tokens {
                input: self.prompt,
                output: self.completion,
                input_includes_cache: Some(true),
                output_includes_reasoning: true,
                ..Default::default()
            };
            if t.reported() {
                usage(out, slot(0), at, self.model.clone(), t);
                out.last_mut().unwrap().partial = true;
                1
            } else {
                0
            }
        } else {
            for (i, (model, t)) in self.totals.iter().enumerate() {
                usage(out, slot(i), at, Some(model.clone()), t.clone());
            }
            self.totals.len()
        };
        // A correction to modelTotals may shorten its array. A row with neither
        // payload is a retraction, not a fabricated zero-token observation.
        for i in n..self.emitted_slots {
            out.push(Observation {
                id: format!("usage:{}", slot(i)),
                ts: at,
                model: None,
                tokens: None,
                tool_category: None,
                aggregate: false,
                partial: false,
            });
        }
        self.emitted_slots = n;
    }

    fn emit_tools(&self, response: &Value, out: &mut Vec<Observation>) {
        for p in items(response) {
            if matches!(s(p, "kind"), Some("toolInvocation" | "toolInvocationSerialized")) {
                // A final response can replay earlier parts (even at different array
                // indices). toolId is the tool *type*, not the invocation's identity.
                let id = identifier(p, "toolCallId");
                let time = ts(&p["timestamp"]);
                tool(
                    out,
                    id,
                    if time > 0 { time } else { self.at() },
                    &self.model,
                    s(p, "toolId").unwrap_or(""),
                );
            }
        }
    }
}

impl UsageParser {
    fn vscode(&mut self, v: &Value, out: &mut Vec<Observation>) {
        let kind = count(v, "kind");
        let body = &v["v"];
        let path = v["k"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        if let Some(requests) = match kind {
            None => v["requests"].as_array(),
            Some(0) => body["requests"].as_array(),
            Some(1) if path.len() == 1 && path[0] == "requests" => body.as_array(),
            _ => None,
        } {
            self.replace_vs_tail(0, requests.iter(), out);
            return;
        }
        if path.first().and_then(Value::as_str) != Some("requests") {
            return;
        }
        if kind == Some(2) && path.len() == 1 {
            let start = count(v, "i")
                .and_then(|n| usize::try_from(n).ok())
                .unwrap_or(self.vscode_requests.len());
            self.replace_vs_tail(start, items(body), out);
            return;
        }
        let Some(index) = path
            .get(1)
            .and_then(Value::as_u64)
            .and_then(|n| usize::try_from(n).ok())
        else {
            return;
        };
        let Some(r) = self.vscode_requests.get_mut(index) else {
            return;
        };
        match (kind, path.len(), path.get(2).and_then(Value::as_str)) {
            (Some(1), 2, None) => {
                let mut new = VsRequest::new(body, index);
                if new.key == r.key {
                    new.emitted_slots = r.emitted_slots;
                }
                *r = new;
                r.emit_usage(out);
                r.emit_tools(&body["response"], out);
            }
            (Some(1 | 2), 3, Some("response")) => r.emit_tools(body, out),
            (Some(1 | 3), 3, Some(k)) if r.patch(k, body) => r.emit_usage(out),
            _ => {}
        }
    }

    fn replace_vs_tail<'a>(
        &mut self,
        start: usize,
        rows: impl Iterator<Item = &'a Value>,
        out: &mut Vec<Observation>,
    ) {
        let old: BTreeMap<_, _> = self
            .vscode_requests
            .drain(start.min(self.vscode_requests.len())..)
            .map(|r| (r.key, r.emitted_slots))
            .collect();
        for row in rows {
            let mut r = VsRequest::new(row, self.vscode_requests.len());
            r.emitted_slots = old.get(&r.key).copied().unwrap_or(0);
            r.emit_tools(&row["response"], out);
            r.emit_usage(out);
            self.vscode_requests.push(r);
        }
    }
}

impl UsageParser {
    fn copilot(&mut self, v: &Value, out: &mut Vec<Observation>) {
        let d = &v["data"];
        let time = ts(&v["timestamp"]);
        let agent = identifier(v, "agentId");
        if matches!(s(v, "type"), Some("assistant.message" | "assistant.usage")) {
            if let Some(m) = identifier(d, "model") {
                if let Some(a) = &agent {
                    self.copilot_agent_models.insert(a.clone(), m);
                } else {
                    self.model = Some(m);
                }
            }
        }
        let active_model = match agent {
            Some(a) => self.copilot_agent_models.get(&a),
            None => self.model.as_ref(),
        }
        .cloned();
        match s(v, "type") {
            Some("session.start" | "session.resume") => self.model = identifier(d, "selectedModel"),
            Some("session.model_change") => {
                self.model = identifier(d, "newModel").or_else(|| identifier(d, "model"))
            }
            Some("session.auto_mode_resolved") => self.model = identifier(d, "chosenModel"),
            Some("assistant.usage") => {
                let tokens = copilot_tokens(d);
                let id = identifier(&d["accounting"], "usageId")
                    .or_else(|| identifier(d, "apiCallId"))
                    .or_else(|| identifier(v, "id"))
                    .or_else(|| (time > 0).then(|| format!("at:{time}:{:?}", tokens.fields())));
                let Some(id) = id.filter(|_| tokens.reported()) else {
                    return;
                };
                if !self.copilot_calls.insert(id.clone()) {
                    return;
                }
                // The metric key in a later shutdown uses the call's `model`, which
                // may be an alias for the more specific responseModel.
                let model = identifier(d, "model")
                    .or_else(|| identifier(d, "responseModel"))
                    .or(active_model);
                let accounted = self
                    .copilot_accounted
                    .entry(model.clone().unwrap_or_default())
                    .or_default();
                accounted.track_missing(&tokens, Some((&id, time)));
                accounted.accounted = tokens.add_known(&accounted.accounted);
                usage(out, id, time, model, tokens);
            }
            Some("session.shutdown" | "session.usage_checkpoint") => {
                // modelMetrics is session-lifetime, including prior shutdowns and any
                // individually journaled assistant.usage. agentMetrics/tokenDetails overlap it.
                let Some(metrics) = d["accountingSnapshot"]["modelMetrics"]
                    .as_object()
                    .or_else(|| d["modelMetrics"].as_object())
                else {
                    return;
                };
                let unknown = self
                    .copilot_accounted
                    .get("")
                    .map(|m| m.accounted.clone())
                    .unwrap_or_default();
                for (model, metric) in metrics {
                    if !valid_id(model) {
                        continue;
                    }
                    let current = copilot_tokens(&metric["usage"]);
                    let accounted = self.copilot_accounted.entry(model.clone()).or_default();
                    let (delta, emit) = accounted.reconcile(&current, &unknown, model, out);
                    if time > 0 && delta.reported() && emit {
                        let id = identifier(v, "id").unwrap_or_else(|| format!("at:{time}"));
                        usage(
                            out,
                            format!("shutdown:{id}:{model}"),
                            time,
                            Some(model.clone()),
                            delta,
                        );
                        out.last_mut().unwrap().aggregate = true;
                    }
                }
            }
            Some("tool.execution_start") => {
                let id = identifier(d, "toolCallId").or_else(|| identifier(v, "id"));
                tool(out, id, time, &active_model, s(d, "toolName").unwrap_or(""));
            }
            _ => {}
        }
    }
}
