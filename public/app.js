// PlanThatParty — front-end SPA (no build step, plain JS)
"use strict";

const app = document.getElementById("app");
const fab = document.getElementById("fabFeedback");

// ---------- tiny helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) =>
  (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const PIN_KEY = "ptp_admin_pin";
const getPin = () => localStorage.getItem(PIN_KEY) || "";
const setPin = (p) => localStorage.setItem(PIN_KEY, p);

async function apiFetch(path, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  if (getPin()) headers["x-admin-pin"] = getPin();
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText), { status: res.status, data });
  return data;
}
const get = (p) => apiFetch(p);
const post = (p, b) => apiFetch(p, { method: "POST", body: JSON.stringify(b) });
const patch = (p, b) => apiFetch(p, { method: "PATCH", body: JSON.stringify(b) });
const del = (p) => apiFetch(p, { method: "DELETE" });

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------- channel labels ----------
const CHANNELS = {
  email: "📧 Email",
  sms: "💬 Text / SMS",
  imessage: "🍏 iMessage",
  whatsapp: "🟢 WhatsApp",
  phone: "📞 Phone call",
  in_person: "🧍 In person",
  calendar: "📅 Calendar invite",
};
const PLATFORMS = { iphone: "iPhone", android: "Android", google: "Google", microsoft: "Microsoft", other: "Other" };
const channelLabel = (c) => CHANNELS[c] || c || "—";

// ============================================================
//  ROUTER
// ============================================================
const state = { tab: "focus", data: null, focus: { level: 0, areaId: null, taskId: null } };

function route() {
  const path = location.pathname;
  const m = path.match(/^\/me\/([a-z0-9]+)/i);
  if (m) return renderVolunteer(m[1]);
  return renderAdmin();
}

// ============================================================
//  VOLUNTEER VIEW  (/me/:token) — "only the info they need"
// ============================================================
const VOL_LEVELS = ["Everything", "Just my tasks", "One thing at a time"];
let volCtx = { token: null, data: null, level: 0 };

async function renderVolunteer(token) {
  fab.hidden = false;
  fab.dataset.person = "";
  app.innerHTML = `<div class="boot">Loading your tasks…</div>`;
  let d;
  try {
    d = await get("/api/me/" + encodeURIComponent(token));
  } catch (e) {
    app.innerHTML = `<div class="wrap"><div class="panel" style="margin-top:40px"><h2>Hmm, this link didn't work</h2><p class="hint">Ask your party coordinator for a fresh link.</p></div></div>`;
    return;
  }
  fab.dataset.person = d.person.id;
  fab.dataset.name = d.person.name;
  volCtx = { token, data: d, level: 0 };

  const party = d.party || {};
  const when = [party.event_date, party.start_time].filter(Boolean).join(" · ");
  app.innerHTML = `
    <header class="top"><div class="top-inner">
      <div class="brand">🎃 ${esc(party.name || "Halloween Party")}</div>
    </div></header>
    <div class="wrap">
      <div class="hello">
        <h1>Hey ${esc(d.person.name)} 👋</h1>
        <p>Here's just your part${when ? " · " + esc(when) : ""}${party.location ? " · " + esc(party.location) : ""}</p>
      </div>
      <div class="focus-top panel">${dialMarkup(0, VOL_LEVELS, "volDial")}</div>
      <div id="volBody"></div>
    </div>`;
  drawVol();
  wireDial($("#volDial"), volCtx.level, VOL_LEVELS.length, (l) => { volCtx.level = l; redrawVolDial(); drawVol(); });
}

function redrawVolDial() {
  const host = $("#volDial");
  if (!host) return;
  host.outerHTML = dialMarkup(volCtx.level, VOL_LEVELS, "volDial");
  wireDial($("#volDial"), volCtx.level, VOL_LEVELS.length, (l) => { volCtx.level = l; redrawVolDial(); drawVol(); });
}

function drawVol() {
  const body = $("#volBody");
  if (!body) return;
  const { token, data: d, level } = volCtx;
  const openTasks = d.tasks.filter((t) => t.status !== "done");

  if (level === 2) {
    const t = openTasks[0] || d.tasks[0];
    body.innerHTML = t
      ? `<div class="spotlight panel">
          ${t.area_emoji ? `<div class="chip area">${t.area_emoji} ${esc(t.area_name || "")}</div>` : ""}
          <h1>${esc(t.title)}</h1>
          ${t.description ? `<p class="spot-desc">${esc(t.description)}</p>` : ""}
          <div class="spot-status">
            ${[["in_progress", "On it"], ["blocked", "I'm stuck"], ["done", "Done ✓"]].map(([s, l]) => `<button class="btn ${t.status === s ? "primary" : ""}" data-vol-spot="${s}" data-id="${t.id}">${l}</button>`).join("")}
          </div>
          <p class="hint" style="text-align:center;margin-top:16px">${openTasks.length > 1 ? `${openTasks.length - 1} more after this — one at a time.` : "This is your last one. You've got it. 🎉"}</p>
        </div>`
      : `<div class="empty panel">Nothing left — you're all done! 🎉</div>`;
    body.querySelectorAll("[data-vol-spot]").forEach((b) =>
      b.addEventListener("click", async () => {
        await post(`/api/me/${token}/task/${b.dataset.id}`, { status: b.dataset.volSpot });
        const t = volCtx.data.tasks.find((x) => x.id == b.dataset.id); if (t) t.status = b.dataset.volSpot;
        toast("Updated — thank you!"); drawVol();
      })
    );
    return;
  }

  const tasks = level === 1 ? openTasks : d.tasks;
  const taskRows = tasks.length ? tasks.map((t) => volTaskRow(t, token)).join("") : `<div class="empty">No tasks assigned to you yet — you're all clear! 🎉</div>`;
  const showSupplies = level === 0 && d.supplies.length;
  body.innerHTML = `
    <div class="section-title">✅ ${level === 1 ? "What's left" : "Your tasks"}</div>
    <div class="panel">${taskRows}</div>
    ${showSupplies ? `<div class="section-title">🛒 Things to grab</div><div class="panel">${d.supplies.map((s) => volSupplyRow(s, token)).join("")}</div>` : ""}
    <p class="empty">See something off, or want a different job? Tap 💬 Feedback anytime.</p>`;
}

function volTaskRow(t, token) {
  const opts = ["todo", "claimed", "in_progress", "blocked", "done"];
  const labels = { todo: "Not started", claimed: "I'll do it", in_progress: "In progress", blocked: "Blocked", done: "Done" };
  return `<div class="row">
    <div class="grow">
      <div class="title">${esc(t.title)}</div>
      <div class="meta">
        ${t.area_emoji ? `<span class="chip area">${t.area_emoji} ${esc(t.area_name || "")}</span>` : ""}
        ${t.due_date ? `<span>📅 ${esc(t.due_date)}</span>` : ""}
        ${t.priority === "high" ? `<span class="chip high">high priority</span>` : ""}
      </div>
      ${t.description ? `<div class="meta">${esc(t.description)}</div>` : ""}
    </div>
    <select class="status-select" data-vol-task="${t.id}" data-token="${esc(token)}">
      ${opts.map((o) => `<option value="${o}" ${o === t.status ? "selected" : ""}>${labels[o]}</option>`).join("")}
    </select>
  </div>`;
}
function volSupplyRow(s, token) {
  const opts = ["needed", "claimed", "purchased"];
  const labels = { needed: "Still need it", claimed: "I've got it covered", purchased: "Bought ✓" };
  return `<div class="row">
    <div class="grow">
      <div class="title">${esc(s.item)} ${s.quantity ? `<span class="meta">(${esc(s.quantity)})</span>` : ""}</div>
      <div class="meta">${s.area_emoji ? `<span class="chip area">${s.area_emoji} ${esc(s.area_name || "")}</span>` : ""}${s.estimated_cost != null ? `<span>~$${esc(s.estimated_cost)}</span>` : ""}</div>
    </div>
    <select class="status-select" data-vol-supply="${s.id}" data-token="${esc(token)}">
      ${opts.map((o) => `<option value="${o}" ${o === s.status ? "selected" : ""}>${labels[o]}</option>`).join("")}
    </select>
  </div>`;
}

// ============================================================
//  ADMIN APP
// ============================================================
async function renderAdmin() {
  fab.hidden = false;
  fab.dataset.person = "";
  try {
    state.data = await get("/api/state");
  } catch (e) {
    app.innerHTML = `<div class="wrap"><div class="panel" style="margin-top:40px"><p>Could not load: ${esc(e.message)}</p></div></div>`;
    return;
  }
  drawShell();
  drawTab();
}

function drawShell() {
  const d = state.data;
  const party = d.party || {};
  const when = [party.event_date, party.start_time].filter(Boolean).join(" · ");
  const tabs = [
    ["focus", "🎛️ Focus"],
    ["dashboard", "Dashboard"],
    ["tasks", "Tasks"],
    ["people", "People"],
    ["supplies", "Supplies"],
    ["feedback", "Feedback" + (d.newFeedback ? ` <span class="badge">${d.newFeedback}</span>` : "")],
    ["settings", "Settings"],
  ];
  app.innerHTML = `
    <header class="top"><div class="top-inner" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="brand">🎃 ${esc(party.name || "PlanThatParty")}
          ${when ? `<span class="sub">${esc(when)}</span>` : ""}</div>
        <div class="spacer"></div>
        ${d.pinConfigured && !getPin() ? `<button class="btn small" id="pinBtn">🔒 Enter admin PIN</button>` : ""}
      </div>
      <div class="tabs">
        ${tabs.map(([id, label]) => `<button class="tab ${state.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}
      </div>
    </div></header>
    <div class="wrap" id="view"></div>`;
}

function drawTab() {
  const view = $("#view");
  if (!view) return;
  ({
    focus: viewFocus,
    dashboard: viewDashboard,
    tasks: viewTasks,
    people: viewPeople,
    supplies: viewSupplies,
    feedback: viewFeedback,
    settings: viewSettings,
  }[state.tab] || viewDashboard)(view);
}

// ---------- Dashboard ----------
function viewDashboard(view) {
  const d = state.data;
  const tasks = d.tasks;
  const done = tasks.filter((t) => t.status === "done").length;
  const unassigned = tasks.filter((t) => !t.assignee_id && t.status !== "done");
  const blocked = tasks.filter((t) => t.status === "blocked");
  const inProgress = tasks.filter((t) => t.status === "in_progress" || t.status === "claimed");
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const budget = d.supplies.reduce((s, x) => s + (Number(x.estimated_cost) || 0), 0);

  const needsAttention = [
    ...blocked.map((t) => ({ t, why: "Blocked" })),
    ...unassigned.slice(0, 8).map((t) => ({ t, why: "No one assigned" })),
  ];

  view.innerHTML = `
    <div class="grid cols-3" style="margin-top:16px">
      <div class="panel stat ${pct === 100 ? "good" : ""}"><div class="num">${pct}%</div><div class="lbl">${done} of ${tasks.length} tasks done</div></div>
      <div class="panel stat ${unassigned.length ? "warn" : "good"}"><div class="num">${unassigned.length}</div><div class="lbl">tasks need an owner</div></div>
      <div class="panel stat"><div class="num">${d.people.length}</div><div class="lbl">volunteers on the crew</div></div>
      <div class="panel stat ${blocked.length ? "bad" : ""}"><div class="num">${blocked.length}</div><div class="lbl">blocked</div></div>
      <div class="panel stat"><div class="num">${inProgress.length}</div><div class="lbl">in motion</div></div>
      <div class="panel stat"><div class="num">$${budget.toFixed(0)}</div><div class="lbl">estimated supplies cost</div></div>
    </div>

    <div class="section-title">🔔 Needs your attention</div>
    <div class="panel">
      ${needsAttention.length
        ? needsAttention.map(({ t, why }) => `
          <div class="row">
            <div class="grow">
              <div class="title">${esc(t.title)}</div>
              <div class="meta">${t.area_emoji ? `<span class="chip area">${t.area_emoji} ${esc(t.area_name || "")}</span>` : ""}<span class="chip ${why === "Blocked" ? "high" : "unassigned"}">${why}</span></div>
            </div>
            <button class="btn small" data-goto-task="${t.id}">Open</button>
          </div>`).join("")
        : `<div class="empty">Nothing on fire. Nice work. 🕯️</div>`}
    </div>

    <div class="section-title">📊 By area</div>
    <div class="grid cols-2">
      ${d.areas.map((a) => {
        const at = tasks.filter((t) => t.area_id === a.id);
        const ad = at.filter((t) => t.status === "done").length;
        return `<div class="panel">
          <h2>${a.emoji || "📌"} ${esc(a.name)}</h2>
          <p class="hint">${ad}/${at.length} done${a.description ? " · " + esc(a.description) : ""}</p>
          <div style="height:8px;background:var(--bg-2);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${at.length ? Math.round((ad / at.length) * 100) : 0}%;background:linear-gradient(90deg,var(--purple),var(--orange))"></div>
          </div>
        </div>`;
      }).join("")}
    </div>`;

  view.querySelectorAll("[data-goto-task]").forEach((b) =>
    b.addEventListener("click", () => { state.tab = "tasks"; drawShell(); drawTab(); })
  );
}

// ---------- Tasks ----------
let taskFilter = { area: "", person: "", status: "" };
function viewTasks(view) {
  const d = state.data;
  const areaOpts = `<option value="">All areas</option>` + d.areas.map((a) => `<option value="${a.id}" ${taskFilter.area == a.id ? "selected" : ""}>${a.emoji || ""} ${esc(a.name)}</option>`).join("");
  const personOpts = `<option value="">Anyone</option><option value="none" ${taskFilter.person === "none" ? "selected" : ""}>— Unassigned —</option>` + d.people.map((p) => `<option value="${p.id}" ${taskFilter.person == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const statusOpts = `<option value="">Any status</option>` + ["todo", "claimed", "in_progress", "blocked", "done"].map((s) => `<option value="${s}" ${taskFilter.status === s ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("");

  let list = d.tasks.slice();
  if (taskFilter.area) list = list.filter((t) => t.area_id == taskFilter.area);
  if (taskFilter.person === "none") list = list.filter((t) => !t.assignee_id);
  else if (taskFilter.person) list = list.filter((t) => t.assignee_id == taskFilter.person);
  if (taskFilter.status) list = list.filter((t) => t.status === taskFilter.status);

  view.innerHTML = `
    <div class="toolbar" style="margin-top:16px">
      <select id="fArea" style="width:auto">${areaOpts}</select>
      <select id="fPerson" style="width:auto">${personOpts}</select>
      <select id="fStatus" style="width:auto">${statusOpts}</select>
      <div class="spacer"></div>
      <button class="btn primary" id="addTaskBtn">+ Add task</button>
    </div>
    <div class="panel" id="taskList">
      ${list.length ? list.map((t) => taskRow(t)).join("") : `<div class="empty">No tasks match. Add one!</div>`}
    </div>`;

  $("#fArea").onchange = (e) => { taskFilter.area = e.target.value; drawTab(); };
  $("#fPerson").onchange = (e) => { taskFilter.person = e.target.value; drawTab(); };
  $("#fStatus").onchange = (e) => { taskFilter.status = e.target.value; drawTab(); };
  $("#addTaskBtn").onclick = () => openTaskModal();
  wireTaskRows(view);
}

function taskRow(t) {
  const d = state.data;
  const statusOpts = ["todo", "claimed", "in_progress", "blocked", "done"]
    .map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("");
  const assignOpts = `<option value="">Unassigned</option>` + d.people.map((p) => `<option value="${p.id}" ${t.assignee_id == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  return `<div class="row" data-task="${t.id}">
    <div class="grow">
      <div class="title">${esc(t.title)} ${t.priority === "high" ? `<span class="chip high">high</span>` : ""}</div>
      <div class="meta">
        ${t.area_emoji ? `<span class="chip area">${t.area_emoji} ${esc(t.area_name || "")}</span>` : ""}
        ${t.due_date ? `<span>📅 ${esc(t.due_date)}</span>` : ""}
        ${!t.assignee_id ? `<span class="chip unassigned">needs owner</span>` : ""}
      </div>
      ${t.description ? `<div class="meta">${esc(t.description)}</div>` : ""}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
      <select class="status-select" data-set-status="${t.id}">${statusOpts}</select>
      <select class="status-select" data-set-assignee="${t.id}">${assignOpts}</select>
      <div style="display:flex;gap:6px">
        <button class="btn small ghost" data-edit-task="${t.id}">Edit</button>
        <button class="btn small ghost danger" data-del-task="${t.id}">✕</button>
      </div>
    </div>
  </div>`;
}

function wireTaskRows(view) {
  view.querySelectorAll("[data-set-status]").forEach((s) =>
    s.addEventListener("change", async (e) => {
      await patch("/api/tasks/" + s.dataset.setStatus, { status: e.target.value });
      const t = state.data.tasks.find((x) => x.id == s.dataset.setStatus); if (t) t.status = e.target.value;
      toast("Updated");
    })
  );
  view.querySelectorAll("[data-set-assignee]").forEach((s) =>
    s.addEventListener("change", async (e) => {
      const val = e.target.value || null;
      await patch("/api/tasks/" + s.dataset.setAssignee, { assignee_id: val });
      const t = state.data.tasks.find((x) => x.id == s.dataset.setAssignee);
      if (t) { t.assignee_id = val; const p = state.data.people.find((p) => p.id == val); t.assignee_name = p ? p.name : null; }
      toast("Assigned");
    })
  );
  view.querySelectorAll("[data-edit-task]").forEach((b) => (b.onclick = () => openTaskModal(b.dataset.editTask)));
  view.querySelectorAll("[data-del-task]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this task?")) return;
      await del("/api/tasks/" + b.dataset.delTask);
      state.data.tasks = state.data.tasks.filter((x) => x.id != b.dataset.delTask);
      drawTab();
    })
  );
}

function openTaskModal(id) {
  const d = state.data;
  const t = id ? d.tasks.find((x) => x.id == id) : {};
  const areaOpts = `<option value="">— area —</option>` + d.areas.map((a) => `<option value="${a.id}" ${t.area_id == a.id ? "selected" : ""}>${a.emoji || ""} ${esc(a.name)}</option>`).join("");
  const personOpts = `<option value="">Unassigned</option>` + d.people.map((p) => `<option value="${p.id}" ${t.assignee_id == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  modal(`
    <h3>${id ? "Edit task" : "New task"}</h3>
    <label class="field"><span>Title</span><input id="mTitle" value="${esc(t.title || "")}" placeholder="What needs doing?" /></label>
    <label class="field"><span>Details</span><textarea id="mDesc" rows="2" placeholder="Optional notes">${esc(t.description || "")}</textarea></label>
    <div class="form-row">
      <label class="field"><span>Area</span><select id="mArea">${areaOpts}</select></label>
      <label class="field"><span>Assign to</span><select id="mAssignee">${personOpts}</select></label>
    </div>
    <div class="form-row">
      <label class="field"><span>Priority</span><select id="mPrio"><option value="normal">Normal</option><option value="high" ${t.priority === "high" ? "selected" : ""}>High</option><option value="low" ${t.priority === "low" ? "selected" : ""}>Low</option></select></label>
      <label class="field"><span>Due</span><input id="mDue" type="date" value="${esc(t.due_date || "")}" /></label>
    </div>`, async () => {
    const payload = {
      title: $("#mTitle").value.trim(),
      description: $("#mDesc").value.trim() || null,
      area_id: $("#mArea").value || null,
      assignee_id: $("#mAssignee").value || null,
      priority: $("#mPrio").value,
      due_date: $("#mDue").value || null,
    };
    if (!payload.title) return toast("Add a title");
    if (id) await patch("/api/tasks/" + id, payload); else await post("/api/tasks", payload);
    await refresh(); drawTab(); toast("Saved");
  });
}

// ---------- People ----------
function viewPeople(view) {
  const d = state.data;
  view.innerHTML = `
    <div class="toolbar" style="margin-top:16px">
      <div><h2 style="margin:0">The crew</h2><p class="hint" style="margin:2px 0 0">Each person gets a private link and only ever sees their own tasks — on the channel they prefer.</p></div>
      <div class="spacer"></div>
      <button class="btn primary" id="addPersonBtn">+ Add person</button>
    </div>
    <div class="grid cols-2">
      ${d.people.length ? d.people.map((p) => personCard(p)).join("") : `<div class="empty panel">No volunteers yet. Add the hosts and yourself to start.</div>`}
    </div>`;
  $("#addPersonBtn").onclick = () => openPersonModal();
  view.querySelectorAll("[data-edit-person]").forEach((b) => (b.onclick = () => openPersonModal(b.dataset.editPerson)));
  view.querySelectorAll("[data-del-person]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Remove this person? Their tasks become unassigned.")) return;
      await del("/api/people/" + b.dataset.delPerson);
      await refresh(); drawTab();
    })
  );
  view.querySelectorAll("[data-copy-link]").forEach((b) =>
    b.addEventListener("click", () => {
      const url = location.origin + "/me/" + b.dataset.copyLink;
      navigator.clipboard.writeText(url).then(() => toast("Link copied")).catch(() => prompt("Copy this link:", url));
    })
  );
}

function personCard(p) {
  const taskCount = state.data.tasks.filter((t) => t.assignee_id == p.id).length;
  return `<div class="panel">
    <div style="display:flex;align-items:center;gap:8px">
      <h2 style="margin:0">${esc(p.name)}</h2>
      ${p.role && p.role !== "volunteer" ? `<span class="chip">${esc(p.role)}</span>` : ""}
      <div class="spacer" style="flex:1"></div>
      <button class="btn small ghost" data-edit-person="${p.id}">Edit</button>
    </div>
    <p class="hint" style="margin:8px 0 6px">
      Prefers <strong style="color:var(--ink)">${channelLabel(p.preferred_channel)}</strong>${p.platform ? ` · ${esc(PLATFORMS[p.platform] || p.platform)}` : ""}
    </p>
    <div class="meta" style="color:var(--muted);font-size:13px">
      ${p.email ? `📧 ${esc(p.email)}<br/>` : ""}${p.phone ? `📱 ${esc(p.phone)}<br/>` : ""}${p.channel_notes ? `📝 ${esc(p.channel_notes)}<br/>` : ""}
    </div>
    <div class="meta" style="margin-top:8px"><span class="chip">${taskCount} task${taskCount === 1 ? "" : "s"}</span></div>
    <div style="display:flex;gap:6px;margin-top:12px">
      <button class="btn small" data-copy-link="${esc(p.share_token)}">🔗 Copy their link</button>
      <button class="btn small ghost danger" data-del-person="${p.id}">Remove</button>
    </div>
  </div>`;
}

function openPersonModal(id) {
  const p = id ? state.data.people.find((x) => x.id == id) : {};
  const chanOpts = Object.entries(CHANNELS).map(([v, l]) => `<option value="${v}" ${p.preferred_channel === v ? "selected" : ""}>${l}</option>`).join("");
  const platOpts = `<option value="">—</option>` + Object.entries(PLATFORMS).map(([v, l]) => `<option value="${v}" ${p.platform === v ? "selected" : ""}>${l}</option>`).join("");
  modal(`
    <h3>${id ? "Edit person" : "Add person"}</h3>
    <label class="field"><span>Name</span><input id="pName" value="${esc(p.name || "")}" placeholder="Their name" /></label>
    <div class="form-row">
      <label class="field"><span>Email</span><input id="pEmail" value="${esc(p.email || "")}" placeholder="name@email.com" /></label>
      <label class="field"><span>Phone</span><input id="pPhone" value="${esc(p.phone || "")}" placeholder="(555) 555-5555" /></label>
    </div>
    <div class="form-row">
      <label class="field"><span>How they like to be reached</span><select id="pChan">${chanOpts}</select></label>
      <label class="field"><span>Their world</span><select id="pPlat">${platOpts}</select></label>
    </div>
    <div class="form-row">
      <label class="field"><span>Role</span><select id="pRole">
        ${["volunteer", "lead", "co-host", "host"].map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}
      </select></label>
      <label class="field"><span>Contact notes</span><input id="pNotes" value="${esc(p.channel_notes || "")}" placeholder="e.g. best evenings" /></label>
    </div>`, async () => {
    const payload = {
      name: $("#pName").value.trim(),
      email: $("#pEmail").value.trim() || null,
      phone: $("#pPhone").value.trim() || null,
      preferred_channel: $("#pChan").value,
      platform: $("#pPlat").value || null,
      role: $("#pRole").value,
      channel_notes: $("#pNotes").value.trim() || null,
    };
    if (!payload.name) return toast("Add a name");
    if (id) await patch("/api/people/" + id, payload); else await post("/api/people", payload);
    await refresh(); drawTab(); toast("Saved");
  });
}

// ---------- Supplies ----------
function viewSupplies(view) {
  const d = state.data;
  const total = d.supplies.reduce((s, x) => s + (Number(x.estimated_cost) || 0), 0);
  const bought = d.supplies.filter((s) => s.status === "purchased").reduce((s, x) => s + (Number(x.estimated_cost) || 0), 0);
  view.innerHTML = `
    <div class="grid cols-3" style="margin-top:16px">
      <div class="panel stat"><div class="num">$${total.toFixed(0)}</div><div class="lbl">estimated total</div></div>
      <div class="panel stat good"><div class="num">$${bought.toFixed(0)}</div><div class="lbl">already purchased</div></div>
      <div class="panel stat warn"><div class="num">${d.supplies.filter((s) => s.status === "needed").length}</div><div class="lbl">still needed</div></div>
    </div>
    <div class="toolbar" style="margin-top:16px"><div class="spacer"></div><button class="btn primary" id="addSupplyBtn">+ Add item</button></div>
    <div class="panel">
      ${d.supplies.length ? d.supplies.map((s) => supplyRow(s)).join("") : `<div class="empty">No supplies tracked yet.</div>`}
    </div>`;
  $("#addSupplyBtn").onclick = () => openSupplyModal();
  wireSupplyRows(view);
}

function wireSupplyRows(view) {
  view.querySelectorAll("[data-set-supply-status]").forEach((sel) =>
    sel.addEventListener("change", async (e) => {
      await patch("/api/supplies/" + sel.dataset.setSupplyStatus, { status: e.target.value });
      const s = state.data.supplies.find((x) => x.id == sel.dataset.setSupplyStatus); if (s) s.status = e.target.value;
      toast("Updated");
    })
  );
  view.querySelectorAll("[data-edit-supply]").forEach((b) => (b.onclick = () => openSupplyModal(b.dataset.editSupply)));
  view.querySelectorAll("[data-del-supply]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this item?")) return;
      await del("/api/supplies/" + b.dataset.delSupply);
      state.data.supplies = state.data.supplies.filter((x) => x.id != b.dataset.delSupply);
      drawTab();
    })
  );
}

function supplyRow(s) {
  const opts = ["needed", "claimed", "purchased"].map((o) => `<option value="${o}" ${o === s.status ? "selected" : ""}>${o}</option>`).join("");
  return `<div class="row">
    <div class="grow">
      <div class="title">${esc(s.item)} ${s.quantity ? `<span class="meta">(${esc(s.quantity)})</span>` : ""}</div>
      <div class="meta">
        ${s.area_emoji ? `<span class="chip area">${s.area_emoji} ${esc(s.area_name || "")}</span>` : ""}
        ${s.assignee_name ? `<span>🧍 ${esc(s.assignee_name)}</span>` : `<span class="chip unassigned">no buyer</span>`}
        ${s.estimated_cost != null ? `<span>~$${esc(s.estimated_cost)}</span>` : ""}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
      <select class="status-select ${s.status}" data-set-supply-status="${s.id}">${opts}</select>
      <div style="display:flex;gap:6px">
        <button class="btn small ghost" data-edit-supply="${s.id}">Edit</button>
        <button class="btn small ghost danger" data-del-supply="${s.id}">✕</button>
      </div>
    </div>
  </div>`;
}

function openSupplyModal(id) {
  const d = state.data;
  const s = id ? d.supplies.find((x) => x.id == id) : {};
  const areaOpts = `<option value="">— area —</option>` + d.areas.map((a) => `<option value="${a.id}" ${s.area_id == a.id ? "selected" : ""}>${a.emoji || ""} ${esc(a.name)}</option>`).join("");
  const personOpts = `<option value="">Nobody yet</option>` + d.people.map((p) => `<option value="${p.id}" ${s.assignee_id == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  modal(`
    <h3>${id ? "Edit item" : "Add supply"}</h3>
    <label class="field"><span>Item</span><input id="sItem" value="${esc(s.item || "")}" placeholder="e.g. Fog machine fluid" /></label>
    <div class="form-row">
      <label class="field"><span>Quantity</span><input id="sQty" value="${esc(s.quantity || "")}" placeholder="e.g. 2 bottles" /></label>
      <label class="field"><span>Est. cost ($)</span><input id="sCost" type="number" step="0.01" value="${s.estimated_cost != null ? esc(s.estimated_cost) : ""}" /></label>
    </div>
    <div class="form-row">
      <label class="field"><span>Area</span><select id="sArea">${areaOpts}</select></label>
      <label class="field"><span>Who's buying</span><select id="sPerson">${personOpts}</select></label>
    </div>
    <label class="field"><span>Notes</span><input id="sNotes" value="${esc(s.notes || "")}" placeholder="Optional" /></label>`, async () => {
    const payload = {
      item: $("#sItem").value.trim(),
      quantity: $("#sQty").value.trim() || null,
      estimated_cost: $("#sCost").value ? Number($("#sCost").value) : null,
      area_id: $("#sArea").value || null,
      assignee_id: $("#sPerson").value || null,
      notes: $("#sNotes").value.trim() || null,
    };
    if (!payload.item) return toast("Add an item name");
    if (id) await patch("/api/supplies/" + id, payload); else await post("/api/supplies", payload);
    await refresh(); drawTab(); toast("Saved");
  });
}

// ---------- Feedback (admin triage) ----------
async function viewFeedback(view) {
  view.innerHTML = `<div class="boot">Loading feedback…</div>`;
  let items;
  try { items = await get("/api/feedback"); }
  catch (e) { view.innerHTML = `<div class="panel" style="margin-top:16px"><p>${esc(e.message)}</p>${e.status === 401 ? `<button class="btn" id="pinBtn2">Enter admin PIN</button>` : ""}</div>`;
    const pb = $("#pinBtn2"); if (pb) pb.onclick = askPin; return; }
  const icon = { love: "❤️", idea: "💡", confusing: "😕", bug: "🐞" };
  view.innerHTML = `
    <div class="section-title" style="margin-top:16px">💬 What people are telling us (${items.length})</div>
    <div class="panel">
      ${items.length ? items.map((f) => `
        <div class="row">
          <div class="grow">
            <div class="title">${icon[f.sentiment] || "💬"} ${esc(f.message)}</div>
            <div class="meta">${esc(f.person_name || f.author_name || "Anonymous")} · ${esc((f.created_at || "").replace("T", " "))} ${f.page ? `· <span class="chip">${esc(f.page)}</span>` : ""}</div>
          </div>
          <select class="status-select" data-fb="${f.id}">
            ${["new", "reviewed", "done"].map((s) => `<option value="${s}" ${s === f.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>`).join("") : `<div class="empty">No feedback yet. It'll show up here the moment someone taps 💬.</div>`}
    </div>`;
  view.querySelectorAll("[data-fb]").forEach((sel) =>
    sel.addEventListener("change", async (e) => { await patch("/api/feedback/" + sel.dataset.fb, { status: e.target.value }); toast("Updated"); })
  );
}

// ---------- Settings ----------
function viewSettings(view) {
  const p = state.data.party || {};
  view.innerHTML = `
    <div class="panel" style="margin-top:16px;max-width:560px">
      <h2>Party details</h2>
      <p class="hint">These show at the top for you and on every volunteer's page.</p>
      <label class="field"><span>Party name</span><input id="stName" value="${esc(p.name || "")}" /></label>
      <div class="form-row">
        <label class="field"><span>Date</span><input id="stDate" type="date" value="${esc(p.event_date || "")}" /></label>
        <label class="field"><span>Start time</span><input id="stTime" value="${esc(p.start_time || "")}" placeholder="7:00 PM" /></label>
      </div>
      <label class="field"><span>Location</span><input id="stLoc" value="${esc(p.location || "")}" placeholder="Address or place" /></label>
      <label class="field"><span>Note to the crew</span><textarea id="stNotes" rows="2">${esc(p.notes || "")}</textarea></label>
      <button class="btn primary" id="saveParty">Save party details</button>
    </div>
    <div class="panel" style="margin-top:14px;max-width:560px">
      <h2>Admin PIN</h2>
      <p class="hint">A shared PIN protects editing. Volunteers never need it — their private links just work. ${state.data.pinConfigured ? "" : "<strong>No PIN is set — anyone who finds this site can edit.</strong>"}</p>
      <label class="field"><span>Set / change PIN</span><input id="stPin" placeholder="${state.data.pinConfigured ? "Enter a new PIN to change it" : "Choose a PIN"}" /></label>
      <button class="btn" id="savePin">Save PIN</button>
    </div>`;
  $("#saveParty").onclick = async () => {
    await patch("/api/party", {
      name: $("#stName").value.trim(), event_date: $("#stDate").value || null,
      start_time: $("#stTime").value.trim() || null, location: $("#stLoc").value.trim() || null,
      notes: $("#stNotes").value.trim() || null,
    });
    await refresh(); drawShell(); state.tab = "settings"; drawTab(); toast("Saved");
  };
  $("#savePin").onclick = async () => {
    const v = $("#stPin").value.trim();
    if (!v) return toast("Type a PIN first");
    await patch("/api/party", { admin_pin: v });
    setPin(v); await refresh(); drawShell(); state.tab = "settings"; drawTab(); toast("PIN saved");
  };
}

// ============================================================
//  Modal + feedback widget + PIN
// ============================================================
function modal(inner, onSave) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal">${inner}<div class="modal-actions"><button class="btn ghost" data-close>Cancel</button>${onSave ? `<button class="btn primary" data-save>Save</button>` : ""}</div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.querySelector("[data-close]").onclick = close;
  const sv = back.querySelector("[data-save]");
  if (sv) sv.onclick = async () => { try { await onSave(); close(); } catch (e) { toast(e.message || "Error"); } };
  const first = back.querySelector("input,textarea,select"); if (first) first.focus();
  return close;
}

let fbSentiment = null;
function openFeedback() {
  fbSentiment = null;
  const person = fab.dataset.person;
  const name = fab.dataset.name || "";
  const close = modal(`
    <h3>How's this working?</h3>
    <p class="hint">Anything — confusing, broken, an idea, or just love. Goes straight to the coordinator.</p>
    <div class="sentiments">
      <button class="btn" data-sent="love">❤️ Love</button>
      <button class="btn" data-sent="idea">💡 Idea</button>
      <button class="btn" data-sent="confusing">😕 Confusing</button>
      <button class="btn" data-sent="bug">🐞 Bug</button>
    </div>
    ${person ? "" : `<label class="field"><span>Your name (optional)</span><input id="fbName" value="${esc(name)}" placeholder="So I know who to thank" /></label>`}
    <label class="field"><span>Your feedback</span><textarea id="fbMsg" rows="3" placeholder="Tell me what you're seeing…"></textarea></label>
  `, async () => {
    const msg = $("#fbMsg").value.trim();
    if (!msg) return toast("Type something first 🙂");
    await post("/api/feedback", {
      message: msg,
      sentiment: fbSentiment,
      page: location.pathname,
      person_id: person || null,
      author_name: person ? null : ($("#fbName") ? $("#fbName").value.trim() : null),
    });
    toast("Thank you! 🙏");
    if (state.tab === "feedback") { await refresh(); drawShell(); drawTab(); }
  });
  document.querySelectorAll(".sentiments [data-sent]").forEach((b) =>
    b.addEventListener("click", () => {
      fbSentiment = b.dataset.sent;
      document.querySelectorAll(".sentiments [data-sent]").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
    })
  );
}

function askPin() {
  modal(`<h3>Admin PIN</h3><p class="hint">Enter the shared PIN to edit the plan.</p><label class="field"><span>PIN</span><input id="pinInput" type="password" /></label>`, async () => {
    const v = $("#pinInput").value.trim();
    if (!v) return;
    setPin(v);
    await renderAdmin();
  });
}

// ============================================================
//  THE FOCUS DIAL  — zoom across altitude, and back out again
// ============================================================
// A reusable rotary dial. `levels` is an array of labels; the needle
// snaps to a detent per level. Drag it, click a tick, use +/- or arrow keys.
function dialMarkup(level, levels, id) {
  const n = levels.length;
  const cx = 120, cy = 120, r = 92, step = 180 / (n - 1);
  const pt = (a, rr) => [cx + rr * Math.cos((a * Math.PI) / 180), cy - rr * Math.sin((a * Math.PI) / 180)];
  const [nx, ny] = pt(180 - level * step, r - 8);
  let ticks = "";
  for (let i = 0; i < n; i++) {
    const [tx, ty] = pt(180 - i * step, r + 2);
    ticks += `<circle class="dial-tick ${i === level ? "on" : ""}" data-level="${i}" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="8"></circle>`;
  }
  return `
  <div class="dial-wrap" id="${id}">
    <button class="dial-arrow" data-dir="-1" title="Zoom out" aria-label="Zoom out">–</button>
    <div class="dial-core">
      <svg viewBox="0 0 240 140" class="dial-svg" role="slider" tabindex="0"
           aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${level}" aria-label="Focus level: ${esc(levels[level])}">
        <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" class="dial-arc"/>
        <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="dial-needle"/>
        <circle cx="${cx}" cy="${cy}" r="10" class="dial-hub"/>
        ${ticks}
      </svg>
      <div class="dial-label"><span>⤢ out</span><strong>${esc(levels[level])}</strong><span>in ⤡</span></div>
    </div>
    <button class="dial-arrow" data-dir="1" title="Zoom in" aria-label="Zoom in">+</button>
  </div>`;
}

function wireDial(root, level, n, onChange) {
  const svg = root.querySelector(".dial-svg");
  const cx = 120, cy = 120, step = 180 / (n - 1);
  const set = (l) => { l = Math.max(0, Math.min(n - 1, Math.round(l))); if (l !== level) onChange(l); };
  root.querySelectorAll("[data-dir]").forEach((b) => (b.onclick = () => set(level + Number(b.dataset.dir))));
  root.querySelectorAll(".dial-tick").forEach((t) =>
    t.addEventListener("pointerdown", (e) => { e.stopPropagation(); set(Number(t.dataset.level)); })
  );
  function fromEvent(e) {
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 240;
    const vy = ((e.clientY - rect.top) / rect.height) * 140;
    let a = (Math.atan2(cy - vy, vx - cx) * 180) / Math.PI;
    if (a < 0) a += 360;
    a = Math.max(0, Math.min(180, a));
    set((180 - a) / step);
  }
  let dragging = false;
  svg.addEventListener("pointerdown", (e) => { dragging = true; try { svg.setPointerCapture(e.pointerId); } catch {} fromEvent(e); });
  svg.addEventListener("pointermove", (e) => { if (dragging) fromEvent(e); });
  svg.addEventListener("pointerup", () => (dragging = false));
  svg.addEventListener("pointercancel", () => (dragging = false));
  svg.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowDown"].includes(e.key)) { set(level - 1); e.preventDefault(); }
    if (["ArrowRight", "ArrowUp"].includes(e.key)) { set(level + 1); e.preventDefault(); }
  });
}

// ---------- Admin focus view ----------
const FOCUS_LEVELS = ["The whole party", "Every area", "One area", "One thing"];

function ensureFocusTargets() {
  const d = state.data, f = state.focus;
  if (f.level >= 2 && !f.areaId) {
    const scored = d.areas
      .map((a) => ({ a, open: d.tasks.filter((t) => t.area_id === a.id && t.status !== "done").length }))
      .sort((x, y) => y.open - x.open);
    f.areaId = (scored[0] && scored[0].a.id) || (d.areas[0] && d.areas[0].id) || null;
  }
  if (f.level >= 3 && !f.taskId) {
    const pool = d.tasks.filter((t) => (!f.areaId || t.area_id === f.areaId) && t.status !== "done");
    f.taskId = (pool[0] && pool[0].id) || (d.tasks.find((t) => !f.areaId || t.area_id === f.areaId) || {}).id || null;
  }
}

function viewFocus(view) {
  ensureFocusTargets();
  const f = state.focus, d = state.data;
  view.innerHTML = `
    <div class="focus-top panel">
      ${dialMarkup(f.level, FOCUS_LEVELS, "focusDial")}
      <div class="focus-crumb">${focusCrumb()}</div>
    </div>
    <div id="focusBody">${focusBody()}</div>`;
  wireDial($("#focusDial"), f.level, FOCUS_LEVELS.length, (l) => {
    state.focus.level = l;
    if (l < 3) state.focus.taskId = null;
    if (l < 2) state.focus.areaId = null;
    drawTab();
  });
  wireFocusBody(view);
}

function focusCrumb() {
  const f = state.focus, d = state.data;
  const steps = [`<a data-crumb="0">🎃 Whole party</a>`];
  if (f.level >= 1) steps.push(`<a data-crumb="1">Every area</a>`);
  if (f.level >= 2 && f.areaId) {
    const a = d.areas.find((x) => x.id === f.areaId);
    steps.push(`<a data-crumb="2">${a ? (a.emoji || "") + " " + esc(a.name) : "Area"}</a>`);
  }
  if (f.level >= 3 && f.taskId) {
    const t = d.tasks.find((x) => x.id === f.taskId);
    steps.push(`<span>${t ? esc(t.title) : "One thing"}</span>`);
  }
  return steps.join(`<span class="crumb-sep">›</span>`);
}

function focusBody() {
  const f = state.focus;
  if (f.level === 0) return focusWhole();
  if (f.level === 1) return focusAreas();
  if (f.level === 2) return focusOneArea();
  return focusOneThing();
}

function focusWhole() {
  const d = state.data, tasks = d.tasks;
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const attention = tasks.filter((t) => t.status === "blocked").length + tasks.filter((t) => !t.assignee_id && t.status !== "done").length;
  const ring = progressRing(pct);
  return `<div class="focus-calm">
    ${ring}
    <p class="big">${done} of ${tasks.length} tasks handled</p>
    <p class="hint">${attention ? `${attention} thing${attention === 1 ? "" : "s"} could use attention` : "Everything's covered right now 🕯️"} · ${d.people.length} on the crew</p>
    <p class="hint">Turn the dial right to zoom in on one area — or all the way to a single next thing.</p>
  </div>`;
}

function focusAreas() {
  const d = state.data;
  return `<div class="grid cols-2" style="margin-top:14px">
    ${d.areas.map((a) => {
      const at = d.tasks.filter((t) => t.area_id === a.id);
      const ad = at.filter((t) => t.status === "done").length;
      const open = at.length - ad;
      return `<button class="panel area-card" data-focus-area="${a.id}">
        <h2>${a.emoji || "📌"} ${esc(a.name)}</h2>
        <p class="hint">${ad}/${at.length} done${open ? ` · ${open} open` : ""}</p>
        <div class="bar"><div style="width:${at.length ? Math.round((ad / at.length) * 100) : 0}%"></div></div>
      </button>`;
    }).join("")}
  </div>`;
}

function focusOneArea() {
  const d = state.data, f = state.focus;
  const a = d.areas.find((x) => x.id === f.areaId);
  const areaOpts = d.areas.map((x) => `<option value="${x.id}" ${x.id === f.areaId ? "selected" : ""}>${x.emoji || ""} ${esc(x.name)}</option>`).join("");
  const tasks = d.tasks.filter((t) => t.area_id === f.areaId);
  const supplies = d.supplies.filter((s) => s.area_id === f.areaId);
  return `
    <div class="toolbar" style="margin-top:14px">
      <label style="color:var(--muted);font-size:13px">Focused on</label>
      <select id="focusAreaPick" style="width:auto">${areaOpts}</select>
      <div class="spacer"></div>
      <button class="btn small primary" id="focusAddTask">+ Task here</button>
    </div>
    <div class="panel">${tasks.length ? tasks.map((t) => focusTaskRow(t)).join("") : `<div class="empty">No tasks in ${a ? esc(a.name) : "this area"} yet.</div>`}</div>
    ${supplies.length ? `<div class="section-title">🛒 Supplies for this area</div><div class="panel">${supplies.map((s) => supplyRow(s)).join("")}</div>` : ""}`;
}

function focusTaskRow(t) {
  const statusOpts = ["todo", "claimed", "in_progress", "blocked", "done"].map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("");
  const assignOpts = `<option value="">Unassigned</option>` + state.data.people.map((p) => `<option value="${p.id}" ${t.assignee_id == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  return `<div class="row">
    <button class="focus-dot" data-focus-task="${t.id}" title="Zoom into just this">🎯</button>
    <div class="grow">
      <div class="title">${esc(t.title)} ${t.priority === "high" ? `<span class="chip high">high</span>` : ""}</div>
      <div class="meta">${t.assignee_name ? `🧍 ${esc(t.assignee_name)}` : `<span class="chip unassigned">needs owner</span>`}${t.due_date ? ` · 📅 ${esc(t.due_date)}` : ""}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
      <select class="status-select" data-set-status="${t.id}">${statusOpts}</select>
      <select class="status-select" data-set-assignee="${t.id}">${assignOpts}</select>
    </div>
  </div>`;
}

function focusOneThing() {
  const d = state.data, f = state.focus;
  const t = d.tasks.find((x) => x.id === f.taskId);
  if (!t) return `<div class="empty panel" style="margin-top:14px">Nothing to focus on here — zoom out and pick something. 🎉</div>`;
  const a = d.areas.find((x) => x.id === t.area_id);
  // siblings within the same focused area (or all) for prev/next
  const sibs = d.tasks.filter((x) => (f.areaId ? x.area_id === f.areaId : true));
  const idx = sibs.findIndex((x) => x.id === t.id);
  const statusBtns = [["claimed", "I'll take it"], ["in_progress", "Working on it"], ["blocked", "Blocked"], ["done", "Done ✓"]]
    .map(([s, label]) => `<button class="btn ${t.status === s ? "primary" : ""}" data-spot-status="${s}">${label}</button>`).join("");
  const assignOpts = `<option value="">Unassigned</option>` + d.people.map((p) => `<option value="${p.id}" ${t.assignee_id == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  return `<div class="spotlight panel">
    ${a ? `<div class="chip area">${a.emoji || ""} ${esc(a.name)}</div>` : ""}
    <h1>${esc(t.title)}</h1>
    ${t.description ? `<p class="spot-desc">${esc(t.description)}</p>` : ""}
    <div class="spot-status">${statusBtns}</div>
    <div class="form-row" style="max-width:460px;margin-top:14px">
      <label class="field"><span>Who's on it</span><select id="spotAssignee">${assignOpts}</select></label>
      <label class="field"><span>Due</span><input id="spotDue" type="date" value="${esc(t.due_date || "")}" /></label>
    </div>
    <div class="spot-nav">
      <button class="btn ghost" data-spot-nav="-1" ${idx <= 0 ? "disabled" : ""}>← Previous</button>
      <span class="hint">${idx + 1} of ${sibs.length}${f.areaId ? " in this area" : ""}</span>
      <button class="btn ghost" data-spot-nav="1" ${idx >= sibs.length - 1 ? "disabled" : ""}>Next →</button>
    </div>
    <p class="hint" style="text-align:center;margin-top:16px">This is the only thing that matters right now. Zoom out with the dial when you're ready.</p>
  </div>`;
}

function progressRing(pct) {
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return `<svg width="140" height="140" viewBox="0 0 140 140" class="ring">
    <circle cx="70" cy="70" r="${r}" class="ring-bg"/>
    <circle cx="70" cy="70" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    <text x="70" y="78" text-anchor="middle" class="ring-txt">${pct}%</text>
  </svg>`;
}

function wireFocusBody(view) {
  // crumb navigation (zoom out to a level)
  view.querySelectorAll("[data-crumb]").forEach((a) =>
    a.addEventListener("click", () => {
      const l = Number(a.dataset.crumb);
      state.focus.level = l;
      if (l < 3) state.focus.taskId = null;
      if (l < 2) state.focus.areaId = null;
      drawTab();
    })
  );
  // pick an area → zoom to level 2
  view.querySelectorAll("[data-focus-area]").forEach((b) =>
    b.addEventListener("click", () => { state.focus.areaId = Number(b.dataset.focusArea); state.focus.level = 2; drawTab(); })
  );
  const pick = $("#focusAreaPick");
  if (pick) pick.onchange = (e) => { state.focus.areaId = Number(e.target.value); drawTab(); };
  const addT = $("#focusAddTask");
  if (addT) addT.onclick = () => openTaskModal();
  // zoom into a single task → level 3
  view.querySelectorAll("[data-focus-task]").forEach((b) =>
    b.addEventListener("click", () => { state.focus.taskId = Number(b.dataset.focusTask); state.focus.level = 3; drawTab(); })
  );
  // reuse the standard task/supply row handlers
  wireTaskRows(view);
  wireSupplyRows(view);
  // spotlight controls
  view.querySelectorAll("[data-spot-status]").forEach((b) =>
    b.addEventListener("click", async () => {
      const t = state.data.tasks.find((x) => x.id === state.focus.taskId);
      const status = b.dataset.spotStatus;
      await patch("/api/tasks/" + t.id, { status }); t.status = status; drawTab(); toast("Updated");
    })
  );
  const sa = $("#spotAssignee");
  if (sa) sa.onchange = async (e) => {
    const t = state.data.tasks.find((x) => x.id === state.focus.taskId);
    const val = e.target.value || null;
    await patch("/api/tasks/" + t.id, { assignee_id: val });
    t.assignee_id = val; const p = state.data.people.find((p) => p.id == val); t.assignee_name = p ? p.name : null; toast("Assigned");
  };
  const sd = $("#spotDue");
  if (sd) sd.onchange = async (e) => {
    const t = state.data.tasks.find((x) => x.id === state.focus.taskId);
    await patch("/api/tasks/" + t.id, { due_date: e.target.value || null }); t.due_date = e.target.value || null; toast("Saved");
  };
  view.querySelectorAll("[data-spot-nav]").forEach((b) =>
    b.addEventListener("click", () => {
      const f = state.focus, d = state.data;
      const sibs = d.tasks.filter((x) => (f.areaId ? x.area_id === f.areaId : true));
      const idx = sibs.findIndex((x) => x.id === f.taskId);
      const next = sibs[idx + Number(b.dataset.spotNav)];
      if (next) { f.taskId = next.id; drawTab(); }
    })
  );
}

// ---------- global wiring ----------
async function refresh() { state.data = await get("/api/state"); }

document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; drawShell(); drawTab(); return; }
  if (e.target.closest("#pinBtn")) return askPin();
});
fab.addEventListener("click", openFeedback);

// volunteer status changes (event delegation, works after re-render)
document.addEventListener("change", async (e) => {
  const vt = e.target.closest("[data-vol-task]");
  if (vt) { await post(`/api/me/${vt.dataset.token}/task/${vt.dataset.volTask}`, { status: e.target.value }); toast("Updated — thank you!"); return; }
  const vs = e.target.closest("[data-vol-supply]");
  if (vs) { await post(`/api/me/${vs.dataset.token}/supply/${vs.dataset.volSupply}`, { status: e.target.value }); toast("Updated — thank you!"); return; }
});

window.addEventListener("popstate", route);
route();
