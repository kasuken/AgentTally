import { ago, providerMeta, sessionAction, STATUS_TEXT } from "./meta.js";
import { inWindow, sortSessions, WINDOWS } from "./selectors.js";

const STALE_MS = 12_000;

export function compactSummary(snapshot, hidden, timeWindow, now) {
  // The counts follow the dashboard's source/time scope, not its transient search or selection.
  const scope = snapshot.sessions.filter(s => !hidden.has(s.provider) && inWindow(s, timeWindow, now));
  const counts = { blocked: 0, waiting: 0, working: 0 };
  for (const s of scope) if (Object.hasOwn(counts, s.status)) counts[s.status]++;
  return { top: sortSessions(scope)[0], counts };
}

export function connectionState(snapshot, failed, now, startedAt) {
  // Re-reading the same cached native snapshot must not make a stopped scanner appear live.
  if (failed || now - (snapshot?.now ?? startedAt) > STALE_MS) return "disconnected";
  return snapshot ? "live" : "connecting";
}

function preferences() {
  try {
    const hidden = JSON.parse(localStorage.getItem("tally.hidden"));
    const time = JSON.parse(localStorage.getItem("tally.window"));
    return { hidden: new Set(Array.isArray(hidden) ? hidden : []), time: Object.hasOwn(WINDOWS, time) ? time : "live" };
  } catch {
    return { hidden: new Set(), time: "live" };
  }
}

function start() {
  const $ = id => document.getElementById(id);
  const tauri = window.__TAURI__;
  const win = tauri?.window.getCurrentWindow();
  const params = new URLSearchParams(location.search);
  const demo = params.has("demo");
  const http = !tauri && !demo && params.has("live");
  const startedAt = Date.now();
  let prefs = preferences();
  let snapshot = null, failed = !tauri && !demo && !http, fixture = false;
  let shown = !tauri, subscribed = false, watchingVisibility = false, pulling = false, simulator;
  let commandError = "";

  function text(id, value, tooltip = false) {
    const el = $(id);
    if (el.textContent !== value) el.textContent = value;
    if (tooltip) el.title = value;
  }

  function render() {
    if (!shown) return;
    const now = Date.now();
    const connection = connectionState(snapshot, failed, now, startedAt);
    const lost = connection === "disconnected";
    const summary = snapshot && compactSummary(snapshot, prefs.hidden, prefs.time, lost ? snapshot.now : now);
    const s = summary?.top;
    const source = demo || fixture ? lost ? "Sample data · disconnected" : "Sample data"
      : lost ? "Scanner disconnected" : connection === "live" ? "Local scanner" : "Connecting";
    $("source").dataset.tone = lost ? "lost" : "";
    text("source", source);
    const status = s ? STATUS_TEXT[s.status] : snapshot ? "Idle" : lost ? "Unavailable" : "Connecting";
    text("status", `${lost && snapshot ? "Last known: " : ""}${status}`);
    $("status").dataset.tone = lost ? "" : s?.status || "";
    const filtered = snapshot?.sessions.length > 0 && !s;
    const title = s?.title || (lost && !snapshot ? "No scanner connection" : filtered ? "No sessions in scope"
      : snapshot ? "No recent sessions" : "Waiting for the scanner");
    const action = s ? sessionAction(s) : lost ? "Open the dashboard for connection details."
      : filtered ? "Check the source and time filters in the dashboard."
      : snapshot ? "New agent activity will appear here." : "The first local scan will appear here.";
    text("session-title", title, true);
    text("action", action, true);
    $("context").hidden = !s;
    if (s) text("context", [s.project, providerMeta(s.provider).name, s.parent && "Sub-agent"].filter(Boolean).join(" · "), true);
    const seen = $("seen");
    seen.hidden = !s;
    if (s) {
      const age = ago(now - s.lastTs);
      seen.dateTime = new Date(s.lastTs).toISOString();
      seen.title = `Last activity: ${new Date(s.lastTs).toLocaleString()}`;
      text("seen", age === "now" ? "Just now" : `${age} ago`);
    }
    for (const key of ["blocked", "waiting", "working"]) text(key, summary ? String(summary.counts[key]) : "–");
    text("approval-label", summary?.counts.blocked === 1 ? "approval" : "approvals");
    text("reply-label", summary?.counts.waiting === 1 ? "reply needed" : "replies needed");
    if (snapshot) {
      const date = new Date(snapshot.now);
      text("scan", `${lost ? "Last scan" : "Scan"} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
      $("scan").title = date.toLocaleString();
    }
    if (commandError) text("scan", commandError);
    // Announce substantive changes, not scanner timestamps on every poll.
    text("announcement", [source, status, title, action, commandError].filter(Boolean).join(". "));
  }

  function accept(snap) {
    if (!snap) return;
    if (!Array.isArray(snap.sessions) || !Number.isFinite(snap.now)) throw new Error("Invalid snapshot");
    if (snapshot && snapshot.now > snap.now) return;
    snapshot = snap;
    failed = false;
  }

  function setShown(visible) {
    shown = visible;
    if (!shown) return;
    prefs = preferences();
    commandError = "";
    render();
    void refresh();
  }

  async function refresh() {
    if (pulling || (!shown && watchingVisibility)) return;
    pulling = true;
    const previous = snapshot;
    try {
      if (tauri && !watchingVisibility) {
        shown = await win.isVisible();
        await tauri.event.listen("buddy-visible", e => setShown(e.payload === true));
        watchingVisibility = true;
        // A minimize/restore can occur while the listener is being registered.
        setShown(await win.isVisible());
      }
      if (!shown) return;
      if (demo) {
        simulator ??= (await import("./demo.js")).createDemo();
        accept(simulator.tick());
      } else if (tauri) {
        if (!subscribed) {
          await tauri.event.listen("tally", e => {
            try { accept(e.payload); } catch { failed = true; }
            render();
          });
          subscribed = true;
        }
        if (!snapshot || Date.now() - snapshot.now > 5_000) accept(await tauri.core.invoke("snapshot"));
      } else if (http) {
        const response = await fetch("/api/snapshot", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("Scan failed");
        fixture = response.headers.get("X-AgentTally-Fixture") === "1";
        accept(await response.json());
      }
    } catch {
      if (snapshot === previous) failed = true;
    } finally {
      pulling = false;
      render();
    }
  }

  $("restore").addEventListener("click", async () => {
    if (!tauri) {
      location.assign(`index.html${demo ? "?demo" : http ? "?live" : ""}`);
      return;
    }
    try { await tauri.core.invoke("show_main"); }
    catch { commandError = "Could not open dashboard"; render(); }
  });

  if (tauri) {
    $("drag-region").dataset.native = "";
    $("drag-region").title = "Drag to move this window";
    $("move").hidden = false;
    $("move").addEventListener("click", async () => {
      try {
        const [monitor, size, pos] = await Promise.all([tauri.window.currentMonitor(), win.outerSize(), win.outerPosition()]);
        if (!monitor) throw new Error("No monitor");
        const { position, size: area } = monitor.workArea;
        const gap = Math.round(16 * monitor.scaleFactor);
        const left = position.x + gap, top = position.y + gap;
        const right = Math.max(left, position.x + area.width - size.width - gap);
        const bottom = Math.max(top, position.y + area.height - size.height - gap);
        const corners = [[left, top], [right, top], [right, bottom], [left, bottom]];
        const distances = corners.map(([x, y]) => Math.hypot(pos.x - x, pos.y - y));
        const next = (distances.indexOf(Math.min(...distances)) + 1) % 4;
        await win.setPosition(new tauri.dpi.PhysicalPosition(...corners[next]));
        commandError = "";
      } catch { commandError = "Could not move window"; }
      render();
    });
  }
  window.addEventListener("storage", () => { prefs = preferences(); render(); });
  void refresh();
  if (tauri || demo || http) setInterval(refresh, 2500);
}

if (typeof document !== "undefined") start();
