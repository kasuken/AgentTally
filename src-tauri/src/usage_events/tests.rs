use super::*;
use crate::util::parse_rfc3339;
use serde_json::json;

fn upsert(rows: &mut BTreeMap<String, Observation>, events: Vec<Observation>) {
    for event in events {
        if event.tokens.is_none() && event.tool_category.is_none() {
            rows.remove(&event.id);
        } else {
            rows.insert(event.id.clone(), event);
        }
    }
}

fn restore(parser: &UsageParser) -> UsageParser {
    serde_json::from_str(&serde_json::to_string(parser).unwrap()).unwrap()
}

#[test]
fn claude_interleaved_blocks_refine_one_request_and_retain_first_event_day() {
    let mut p = UsageParser::default();
    let mut rows = BTreeMap::new();
    let mut a = json!({"timestamp":"2026-11-20T23:59:59Z","type":"assistant",
        "message":{"id":"a","model":"model-a","usage":{"input_tokens":9,"cache_read_input_tokens":20,
          "cache_creation_input_tokens":5,"cache_creation":{"ephemeral_5m_input_tokens":5},"output_tokens":1},
          "content":[{"type":"tool_use","id":"t1","name":"Read","input":{"path":"PRIVATE_PAYLOAD"}}]}});
    upsert(&mut rows, p.process(Format::Claude, &a));
    upsert(&mut rows, p.process(Format::Claude,&json!({"timestamp":"2026-11-21T00:00:00Z","type":"assistant",
        "message":{"id":"b","model":"model-b","usage":{"input_tokens":0},"content":[{"type":"text","text":"PRIVATE_PAYLOAD"}]}})));
    a["timestamp"] = json!("2026-11-21T00:00:02Z");
    a["message"]["usage"] = json!({"output_tokens":7});
    p = restore(&p);
    upsert(&mut rows, p.process(Format::Claude, &a));
    assert_eq!(rows.len(), 3);
    let a = &rows["usage:a"];
    assert_eq!(a.ts, parse_rfc3339("2026-11-20T23:59:59Z").unwrap());
    let t = a.tokens.as_ref().unwrap();
    assert_eq!(
        (t.input, t.cache_read, t.cache_write, t.cache_write_5m, t.output),
        (Some(9), Some(20), Some(5), Some(5), Some(7))
    );
    assert_eq!(t.input_includes_cache, Some(false));
    let b = rows["usage:b"].tokens.as_ref().unwrap();
    assert_eq!((b.input, b.output), (Some(0), None));
    assert_eq!(rows["tool:t1"].tool_category.as_deref(), Some("read/search"));
    assert_eq!(rows["tool:t1"].ts, a.ts);
    assert!(!format!("{rows:?}{p:?}").contains("PRIVATE_PAYLOAD"));
}

#[test]
fn codex_watermarks_deduplicate_rate_updates_and_keep_model_and_cache_at_time() {
    let mut p = UsageParser::default();
    let counts = |at, n, cached, output, reasoning| {
        json!({"type":"event_msg","timestamp":at,
        "payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":n,
        "cached_input_tokens":cached,"output_tokens":output,"reasoning_output_tokens":reasoning,
        "total_tokens":n+output}}}})
    };
    p.process(
        Format::Codex,
        &json!({"type":"turn_context","payload":{"model":"one"}}),
    );
    let row = p
        .process(Format::Codex, &counts(1000, 50, 20, 10, 3))
        .pop()
        .unwrap();
    assert_eq!(row.model.as_deref(), Some("one"));
    assert_eq!(row.tokens.unwrap().total, Some(60));
    p = restore(&p);
    assert!(p.process(Format::Codex, &counts(1001, 50, 20, 10, 3)).is_empty());
    p.process(
        Format::Codex,
        &json!({"type":"turn_context","payload":{"model":"two"}}),
    );
    let row = p
        .process(Format::Codex, &counts(1002, 60, 25, 14, 5))
        .pop()
        .unwrap();
    let t = row.tokens.unwrap();
    assert_eq!(row.ts, 1_002_000);
    assert_eq!(row.model.as_deref(), Some("two"));
    assert_eq!(
        (t.input, t.cache_read, t.output, t.reasoning, t.total),
        (Some(10), Some(5), Some(4), Some(2), Some(14))
    );
    assert_eq!(t.input_includes_cache, Some(true));
    assert!(t.output_includes_reasoning);
    assert!(p.process(Format::Codex, &counts(1003, 50, 20, 10, 3)).is_empty());
}

#[test]
fn codex_per_call_without_a_watermark_can_transition_to_cumulative() {
    let mut p = UsageParser::default();
    let last = json!({"timestamp":100,"type":"event_msg","payload":{"type":"token_count","info":{
        "last_token_usage":{"input_tokens":8,"output_tokens":2,"total_tokens":10}}}});
    assert_eq!(p.process(Format::Codex, &last).len(), 1);
    assert!(restore(&p).process(Format::Codex, &last).is_empty());
    let next = json!({"timestamp":101,"type":"event_msg","payload":{"type":"token_count","info":{
        "total_token_usage":{"input_tokens":14,"output_tokens":3,"total_tokens":17}}}});
    assert_eq!(
        p.process(Format::Codex, &next)[0].tokens.as_ref().unwrap().total,
        Some(7)
    );
}

#[test]
fn gemini_rewrite_and_restart_replace_edited_counts_without_multiplying_tools() {
    let mut p = UsageParser::default();
    let mut doc = json!({"messages":[{"type":"user","timestamp":100,"content":"PRIVATE_PAYLOAD"},
        {"id":"m1","type":"gemini","timestamp":101,"model":"flash","tokens":{"input":100,"cached":50,
         "thoughts":7,"output":3,"tool":2,"total":112},
         "toolCalls":[{"id":"call1","name":"run_shell_command","timestamp":102,"args":{"command":"PRIVATE_PAYLOAD"}}]}]});
    let mut rows = BTreeMap::new();
    upsert(&mut rows, p.process(Format::Gemini, &doc));
    doc["messages"][1]["tokens"]["output"] = json!(4);
    doc["messages"][1]["tokens"]["total"] = json!(113);
    upsert(&mut rows, UsageParser::default().process(Format::Gemini, &doc));
    let t = rows["usage:m1"].tokens.as_ref().unwrap();
    assert_eq!(
        (
            t.input,
            t.cache_read,
            t.output,
            t.reasoning,
            t.tool_input,
            t.total
        ),
        (Some(100), Some(50), Some(4), Some(7), Some(2), Some(113))
    );
    assert_eq!(t.input_includes_cache, Some(true));
    assert!(!t.output_includes_reasoning);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows["tool:call1"].ts, 102000);
    assert!(!format!("{rows:?}").contains("PRIVATE_PAYLOAD"));
}

#[test]
fn copilot_shutdown_and_resume_charge_only_unreported_fields_and_residuals() {
    let mut p = UsageParser::default();
    let call = |at, id, input, output| {
        json!({"type":"assistant.usage","timestamp":at,"id":id,
        "data":{"apiCallId":id,"model":"m","responseModel":"m-new","inputTokens":input,"outputTokens":output}})
    };
    let shutdown = |at, id, input, output, cached| {
        json!({"type":"session.shutdown","timestamp":at,"id":id,
        "data":{"modelMetrics":{"m":{"usage":{"inputTokens":input,"outputTokens":output,"cacheReadTokens":cached}}},
        "agentMetrics":{"main":{"modelMetrics":{"m":{"usage":{"inputTokens":input}}}}}}})
    };
    p.process(Format::Copilot, &call(100, "c1", 25, 5));
    let first = p.process(Format::Copilot, &shutdown(101, "s1", 25, 5, 10));
    let t = first[0].tokens.as_ref().unwrap();
    assert!(!first[0].aggregate);
    assert_eq!(first[0].ts, 100000);
    assert_eq!(first[0].id, "usage:c1");
    assert_eq!(
        (t.input, t.output, t.cache_read, t.cache_write),
        (Some(25), Some(5), Some(10), None)
    );
    assert!(p
        .process(Format::Copilot, &shutdown(102, "s2", 25, 5, 10))
        .is_empty());
    p = restore(&p);
    assert!(p.process(Format::Copilot, &call(103, "c1", 25, 5)).is_empty());
    p.process(Format::Copilot, &call(104, "c2", 4, 2));
    let last = p.process(Format::Copilot, &shutdown(105, "s3", 40, 10, 12));
    let t = last[0].tokens.as_ref().unwrap();
    // The two newly reported cache reads might belong to c2 or the unobserved
    // call(s); treating them as two extra tokens would double-charge known input.
    assert_eq!((t.input, t.output, t.cache_read), (Some(11), Some(3), None));
    assert!(last[0].aggregate);
    assert!(p
        .process(
            Format::Copilot,
            &json!({"type":"session.usage_info","data":{"currentTokens":1500},"timestamp":106})
        )
        .is_empty());
    assert!(p
        .process(
            Format::Copilot,
            &json!({"type":"assistant.message","data":{"outputTokens":5},"timestamp":107})
        )
        .is_empty());
}

#[test]
fn tool_results_and_subagent_notifications_are_not_new_invocations() {
    let mut p = UsageParser::default();
    let mut rows = BTreeMap::new();
    for (kind, model) in [
        ("tool.execution_start", "first"),
        ("tool.execution_start", "other"),
        ("tool.execution_complete", ""),
        ("subagent.started", ""),
    ] {
        let v = json!({"timestamp":100,"type":kind,"id":model,"data":{"toolCallId":"c","toolName":"task","arguments":"PRIVATE_PAYLOAD"}});
        upsert(&mut rows, p.process(Format::Copilot, &v));
    }
    assert_eq!(rows.len(), 1);
    assert_eq!(rows["tool:c"].tool_category.as_deref(), Some("coordination"));
    let item = |kind| {
        json!({"timestamp":100,"type":"response_item","payload":{"type":kind,
        "call_id":"s","name":"exec_command","arguments":"PRIVATE_PAYLOAD"}})
    };
    assert_eq!(p.process(Format::Codex, &item("function_call")).len(), 1);
    assert!(p.process(Format::Codex, &item("function_call_output")).is_empty());
}

#[test]
fn vscode_verified_storage_schema_supports_snapshots_and_field_patches() {
    let mut p = UsageParser::default();
    let mut rows = BTreeMap::new();
    let tool = json!({"kind":"toolInvocationSerialized","toolCallId":"c","toolId":"run_in_terminal",
        "invocationMessage":"PRIVATE_PAYLOAD"});
    let request = json!({"requestId":"request","timestamp":1000,"modelId":"selected","promptTokens":20,
        "completionTokens":4,"message":{"text":"PRIVATE_PAYLOAD"},"response":[tool.clone()]});
    upsert(
        &mut rows,
        p.process(
            Format::VsCode,
            &json!({"kind":0,"v":{"requests":[request.clone()]}}),
        ),
    );
    assert!(rows["usage:request:0"].partial);
    p = restore(&p);
    for patch in [
        json!({"kind":1,"k":["requests",0,"completionTokens"],"v":8}),
        json!({"kind":2,"k":["requests",0,"response"],"v":[tool]}),
        json!({"kind":1,"k":["requests",0,"modelTotals"],"v":[
            {"model":"actual","inputTokens":40,"cachedTokens":10,"outputTokens":6},
            {"model":"subagent","inputTokens":10,"outputTokens":2}]}),
    ] {
        upsert(&mut rows, p.process(Format::VsCode, &patch));
    }
    assert_eq!(rows.len(), 3);
    let first = &rows["usage:request:0"];
    assert_eq!(first.model.as_deref(), Some("actual"));
    assert_eq!(first.ts, 1_000_000);
    assert!(!first.partial);
    assert_eq!(first.tokens.as_ref().unwrap().input, Some(40));
    assert_eq!(rows["usage:request:1"].model.as_deref(), Some("subagent"));
    assert_eq!(rows["tool:c"].tool_category.as_deref(), Some("terminal"));
    upsert(
        &mut rows,
        p.process(
            Format::VsCode,
            &json!({"kind":1,"k":["requests",0,"modelTotals"],"v":[
        {"model":"actual","inputTokens":44,"cachedTokens":11,"outputTokens":8}]}),
        ),
    );
    assert!(!rows.contains_key("usage:request:1"));
    assert!(!format!("{p:?}{rows:?}").contains("PRIVATE_PAYLOAD"));
    let from_document = UsageParser::default().process(Format::VsCode, &json!({"requests":[request]}));
    assert_eq!(from_document.len(), 2);
}

#[test]
fn unknown_fields_presence_only_and_missing_time_do_not_fabricate_usage() {
    let mut p = UsageParser::default();
    for f in [
        Format::Claude,
        Format::Gemini,
        Format::Codex,
        Format::VsCode,
        Format::Copilot,
        Format::Antigravity,
        Format::Presence,
    ] {
        assert!(p
            .process(f, &json!({"timestamp":123,"content":"charge me 3000 tokens"}))
            .is_empty());
    }

    for timestamp in [Value::Null, json!(-9), json!("not a timestamp")] {
        assert!(p
            .process(
                Format::Claude,
                &json!({"type":"assistant","timestamp":timestamp,
            "message":{"id":"m","usage":{"input_tokens":15}}})
            )
            .is_empty());
    }
}

#[test]
fn live_view_uses_the_same_reported_fields_and_keeps_zero_distinct_from_missing() {
    use crate::{model::Session, providers::gemini};
    let mut session = Session::new("gemini", "s");
    let mut doc = json!({"messages":[{"type":"gemini","id":"m","timestamp":100,"tokens":{
        "input":8,"cached":5,"output":0}}]});
    gemini::apply_document(&mut session, &doc);
    let view = session.view(110_000);
    assert_eq!((view.tokens_in, view.tokens_out), (8, 0));
    assert!(view.tokens_in_known && view.tokens_out_known);
    doc["messages"][0]["tokens"] = json!({"input":10});
    gemini::apply_document(&mut session, &doc);
    let view = session.view(110_000);
    assert_eq!(view.tokens_in, 10);
    assert!(!view.tokens_out_known);
}
