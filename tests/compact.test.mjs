import test from "node:test";
import assert from "node:assert/strict";
import { compactSummary, connectionState } from "../ui/js/buddy.js";

const now = 100_000_000;
const session = (key, status, extra) => ({ key, status, provider: "claude", project: "Atlas", lastTs: now, ...extra });

test("a blocked sub-agent outranks waiting and working sessions; counts honor source and time scope", () => {
  const working = session("parent", "working");
  const child = session("review", "blocked", { parent: working.key });
  const sessions = [working, session("question", "waiting"), child, session("hidden", "blocked", { provider: "codex" })];
  const hidden = new Set(["codex"]);
  const summary = compactSummary({ sessions }, hidden, "live", now);
  assert.equal(summary.top, child);
  assert.deepEqual(summary.counts, { blocked: 1, waiting: 1, working: 1 });
  assert.equal(sessions[0], working);

  const idle = session("idle", "idle", { lastTs: now - 16 * 60_000 });
  assert.equal(compactSummary({ sessions: [idle] }, hidden, "live", now).top, undefined);
  assert.equal(compactSummary({ sessions: [idle] }, hidden, "1h", now).top, idle);
});

test("stale cached snapshots and failed reads cannot imply a live scanner", () => {
  const started = now - 30_000;
  const snap = { now, sessions: [] };
  assert.equal(connectionState(null, false, now, now), "connecting");
  assert.equal(connectionState(null, false, now, started), "disconnected");
  assert.equal(connectionState(snap, false, now, started), "live");
  assert.equal(connectionState(snap, true, now, started), "disconnected");
  assert.equal(connectionState(snap, false, now + 13_000, started), "disconnected");
  assert.equal(connectionState({ ...snap, now: now + 13_000 }, false, now + 13_000, started), "live");
});
