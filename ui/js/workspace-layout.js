export function setupWorkspaceLayout(load, save) {
  const overview = document.getElementById("overview");
  const toggle = document.getElementById("toggle-overview");
  const divider = document.getElementById("pane-divider");
  const workspace = divider.parentElement;
  const min = Number(divider.getAttribute("aria-valuemin"));
  const max = Number(divider.getAttribute("aria-valuemax"));
  const initial = Number(divider.getAttribute("aria-valuenow"));
  const rtl = () => getComputedStyle(workspace).direction === "rtl";

  function showOverview(show) {
    overview.hidden = !show;
    toggle.setAttribute("aria-expanded", String(show));
  }
  const expanded = load("tally.layout.overview", null);
  showOverview(typeof expanded === "boolean" ? expanded : !matchMedia("(max-width: 850px), (max-height: 650px)").matches);
  toggle.onclick = () => {
    showOverview(overview.hidden);
    save("tally.layout.overview", !overview.hidden);
  };

  let share = initial;
  function resize(value) {
    share = Math.min(max, Math.max(min, Math.round(value)));
    workspace.style.setProperty("--session-share", `${share}%`);
    divider.setAttribute("aria-valuenow", String(share));
    divider.setAttribute("aria-valuetext", `${share}% for sessions`);
  }
  const stored = load("tally.layout.split", initial);
  resize(Number.isFinite(stored) ? stored : initial);
  const persist = () => save("tally.layout.split", share);
  divider.onkeydown = (e) => {
    const step = rtl() ? -2 : 2;
    const next = { ArrowLeft: share - step, ArrowRight: share + step, Home: min, End: max };
    if (!Object.hasOwn(next, e.key)) return;
    e.preventDefault();
    resize(next[e.key]); persist();
  };
  divider.ondblclick = () => { resize(initial); persist(); };
  let drag = null;
  divider.onpointerdown = (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    drag = { id: e.pointerId, x: e.clientX, width: workspace.clientWidth, share };
    divider.setPointerCapture(e.pointerId);
    divider.setAttribute("data-dragging", "");
  };
  divider.onpointermove = (e) => {
    if (drag?.id !== e.pointerId || !drag.width) return;
    resize(drag.share + (e.clientX - drag.x) / drag.width * (rtl() ? -100 : 100));
  };
  divider.onpointerup = (e) => {
    if (drag?.id === e.pointerId) { persist(); drag = null; }
  };
  divider.onlostpointercapture = () => {
    if (drag) resize(drag.share);
    drag = null;
    divider.removeAttribute("data-dragging");
  };
}
