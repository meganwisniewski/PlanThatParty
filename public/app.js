// PlanThatParty — front-end SPA (plain JS, no build step)
"use strict";
const appEl = document.getElementById("app");
const fab = document.getElementById("fabFeedback");

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PIN_KEY = "ptp_admin_pin";
const getPin = () => localStorage.getItem(PIN_KEY) || "";
const setPin = (p) => localStorage.setItem(PIN_KEY, p);
const clearPin = () => localStorage.removeItem(PIN_KEY);

async function apiFetch(path, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  // On visitor-facing pages (a volunteer link or the public /ideas box) never
  // attach the host PIN — so previewing them shows exactly what that visitor
  // sees, not the host-authorized view. Approver access still flows through
  // the volunteer's own token below.
  const p = location.pathname.replace(/\/+$/, "");
  const publicView = /^\/me\//.test(location.pathname) || p === "/ideas";
  if (getPin() && !publicView) headers["x-admin-pin"] = getPin();
  if (window.__approverToken) headers["x-approver-token"] = window.__approverToken;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText), { status: res.status });
  return data;
}
const get = (p) => apiFetch(p);
const post = (p, b) => apiFetch(p, { method: "POST", body: JSON.stringify(b || {}) });
const patch = (p, b) => apiFetch(p, { method: "PATCH", body: JSON.stringify(b) });
const del = (p) => apiFetch(p, { method: "DELETE" });

function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2000); }

/* ---------------- domain constants ---------------- */
const STATUSES = ["todo", "claimed", "in_progress", "blocked", "done"];
const ST_LABEL = { todo: "To do", claimed: "Claimed", in_progress: "In progress", blocked: "Blocked", done: "Done" };
const ST_GLYPH = { todo: "○", claimed: "◔", in_progress: "◕", blocked: "⊘", done: "●" };
const ST_COLOR = { todo: "#c3c8d0", claimed: "#1d4ed8", in_progress: "#eab308", blocked: "#b42318", done: "#15803d" };
const PRIOS = ["high", "normal", "low"];
const PR_GLYPH = { high: "▲", normal: "■", low: "·" };
const PR_LABEL = { high: "High", normal: "Med", low: "Low" };
const CHANNELS = { email: "📧 Email", sms: "💬 Text / SMS", imessage: "🍏 iMessage", whatsapp: "🟢 WhatsApp", phone: "📞 Phone call", in_person: "🧍 In person", calendar: "📅 Calendar invite" };
const PLATFORMS = { iphone: "iPhone", android: "Android", google: "Google", microsoft: "Microsoft", other: "Other" };
const FACT_META = {
  event_date: { label: "Party date", type: "date", field: "event_date" },
  start_time: { label: "Start time", type: "text", field: "start_time", ph: "e.g. 8:00 AM" },
  location: { label: "Location", type: "text", field: "location", ph: "Address or venue" },
  theme: { label: "Theme", type: "text", field: "theme", ph: "e.g. Haunted Carnival" },
  headcount_target: { label: "Headcount target", type: "number", field: "headcount_target", ph: "e.g. 60" },
  budget_target: { label: "Budget ($)", type: "number", field: "budget_target", ph: "e.g. 500" },
};
const channelLabel = (c) => CHANNELS[c] || c || "—";
const REMIND_OPTS = [[0, "At start"], [60, "1 hour before"], [1440, "1 day before"], [10080, "1 week before"]];
const reminderSet = (csv) => String(csv || "").split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
function googleCalUrl(party) {
  if (!party || !party.calStart) return null;
  const p = new URLSearchParams();
  p.set("action", "TEMPLATE");
  p.set("text", party.name || "Halloween Party");
  p.set("dates", `${party.calStart}/${party.calEnd}`);
  if (!party.calAllDay) p.set("ctz", "America/Denver"); // party is in Denver — pin to Mountain time
  const det = party.cal_details || party.notes;
  if (det) p.set("details", det);
  if (party.location) p.set("location", party.location);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
// ---- avatars (a fantasy cast: each person can wear a creature) ----
const AVATARS = [
  ["wizard", "🧙", "Wizard"], ["fairy", "🧚", "Fairy"], ["elf", "🧝", "Elf"], ["genie", "🧞", "Genie"],
  ["merfolk", "🧜", "Merfolk"], ["vampire", "🧛", "Vampire"], ["zombie", "🧟", "Zombie"], ["hero", "🦸", "Hero"],
  ["unicorn", "🦄", "Unicorn"], ["dragon", "🐉", "Dragon"], ["ogre", "👹", "Ogre"], ["goblin", "👺", "Goblin"],
  ["ghost", "👻", "Ghost"], ["pumpkin", "🎃", "Pumpkin"], ["skull", "💀", "Skull"], ["bat", "🦇", "Bat"],
  ["cat", "🐈‍⬛", "Black cat"], ["spider", "🕷️", "Spider"], ["owl", "🦉", "Owl"], ["wolf", "🐺", "Wolf"],
  ["frog", "🐸", "Toad"], ["snake", "🐍", "Serpent"], ["mushroom", "🍄", "Toadstool"], ["oracle", "🔮", "Oracle"],
];
const AV_EMOJI = Object.fromEntries(AVATARS.map(([k, e]) => [k, e]));
function avatarSeedHue(seed) { const s = String(seed || "?"); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
// Render a person's avatar: an uploaded image, a built-in creature tile, or a
// colored initials fallback. size in px.
function avatarHtml(p, size) {
  size = size || 40;
  const av = p && p.avatar;
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px`;
  if (av && av.slice(0, 5) === "data:") return `<span class="avatar" style="${st}"><img src="${av}" alt="${esc((p && p.name) || "")}"/></span>`;
  if (av && av.slice(0, 3) === "fx:") { const h = avatarSeedHue(av); return `<span class="avatar avatar-fx" style="${st};background:linear-gradient(135deg,hsl(${h} 72% 63%),hsl(${(h + 45) % 360} 68% 50%))">${AV_EMOJI[av.slice(3)] || "🎭"}</span>`; }
  const initials = (String((p && p.name) || "?").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2) || "?").toUpperCase();
  const h = avatarSeedHue(p && p.name);
  return `<span class="avatar avatar-init" style="${st};background:hsl(${h} 55% 90%);color:hsl(${h} 45% 30%)">${esc(initials)}</span>`;
}
// ---- events ----
const EVENT_KINDS = [["movie", "🎬", "Movie night"], ["craft", "✂️", "Craft day"], ["pumpkin", "🎃", "Pumpkin day"], ["setup", "🔨", "Setup"], ["dayof", "🎉", "Day-of"], ["teardown", "🧹", "Tear-down"], ["other", "📌", "Other"]];
const EK_EMOJI = Object.fromEntries(EVENT_KINDS.map(([k, e]) => [k, e]));
const EK_LABEL = Object.fromEntries(EVENT_KINDS.map(([k, e, l]) => [k, l]));
// A Google Calendar "add event" link for a dated event (all-day).
function eventGCalUrl(ev, party) {
  if (!ev.event_date) return null;
  const ymd = ev.event_date.replace(/-/g, "");
  const [y, m, d] = ev.event_date.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + 1));
  const end = `${nd.getUTCFullYear()}${String(nd.getUTCMonth() + 1).padStart(2, "0")}${String(nd.getUTCDate()).padStart(2, "0")}`;
  const p = new URLSearchParams();
  p.set("action", "TEMPLATE");
  p.set("text", `${EK_EMOJI[ev.kind] || "🎃"} ${ev.title}`);
  p.set("dates", `${ymd}/${end}`);
  const det = [ev.start_time ? `Time: ${ev.start_time}${ev.end_time ? "–" + ev.end_time : ""}` : "", ev.notes || ""].filter(Boolean).join("\n");
  if (det) p.set("details", det);
  if (ev.location || (party && party.location)) p.set("location", ev.location || party.location);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
// ---- ideas ----
const IDEA_STAGES = ["submitted", "screening", "approved", "promoted", "declined", "parked"];
const IS_LABEL = { submitted: "Submitted", screening: "Screening", approved: "Approved", promoted: "Promoted", declined: "Declined", parked: "Parked" };
const IS_EMOJI = { submitted: "💡", screening: "🔍", approved: "✅", promoted: "🎯", declined: "🚫", parked: "🅿️" };
const IS_COLOR = { submitted: "#b45309", screening: "#1d4ed8", approved: "#15803d", promoted: "#7c3aed", declined: "#b42318", parked: "#5c6470" };
function voterKey() { let k = localStorage.getItem("ptp_voter"); if (!k) { k = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem("ptp_voter", k); } return k; }
let ideasData = [];
let ideasLoaded = false; // have we fetched ideas at least once (so render can redraw from cache)?
let fbData = null;       // cached feedback list, so a re-render doesn't wipe it back to "Loading…"
// Shrink an image file to a data URL — keeps photos small enough to store inline.
function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); let w = img.width, h = img.height; const s = Math.min(1, maxDim / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s); const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); resolve(c.toDataURL("image/jpeg", quality)); };
    img.onerror = reject; img.src = url;
  });
}
// A distinct identity color per planning area/phase (feedback: colored pills, not grey).
const AREA_PALETTE = ["#ea6a1e", "#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#dc2626", "#db2777", "#4f46e5", "#0d9488"];
function areaColor(a) {
  if (!a) return "#9ca3af";
  let idx = a.sort_order ? a.sort_order - 1 : 0;
  if (!a.sort_order && state.data) idx = state.data.areas.findIndex((x) => x.id === a.id);
  return AREA_PALETTE[((idx % AREA_PALETTE.length) + AREA_PALETTE.length) % AREA_PALETTE.length];
}
const areaColorById = (id) => areaColor((state.data && state.data.areas.find((x) => x.id === id)) || null);

/* ---------------- state ---------------- */
const state = {
  data: null,
  screen: "work",            // work | people | feedback | settings
  dial: 1,                   // 0 overview, 1 working, 2 one-task
  view: "grid",              // grid | board | calendar
  filter: { areaId: null, saved: null, q: "" },
  selectedTaskId: null,
  panelOpen: false,
  collapsed: {},             // areaId -> true
  navOpen: false,
  calMonth: null,            // {y, m}
  showDone: false,           // hide completed tasks by default
};

/* ---------------- router ---------------- */
function route() {
  if (location.pathname.replace(/\/+$/, "") === "/ideas") return renderPublicIdeas();
  const m = location.pathname.match(/^\/me\/([a-z0-9]+)/i);
  if (m) return renderVolunteer(m[1]);
  return renderRoot();
}

// The root URL is tiered: hosts (with the PIN) get the full plan; everyone
// else gets the guest page — public info only (currently just date & time).
async function renderRoot() {
  if (getPin()) {
    try { state.data = await get("/api/state"); fab.hidden = false; applyHostIdentity(); loadMentions().then(render); render(); return; }
    catch (e) { if (e.status === 401) clearPin(); else { appEl.innerHTML = `<div class="boot">Couldn't load: ${esc(e.message)}</div>`; return; } }
  }
  return renderGuest();
}

// Guest page — shows only the fields the hosts have marked public.
async function renderGuest() {
  fab.hidden = false; fab.dataset.person = ""; fab.dataset.name = ""; window.__approverToken = null;
  let p = {}; try { p = await get("/api/public"); } catch {}
  const has = (k) => p[k] != null && p[k] !== "";
  const when = [has("event_date") ? fmtDate(p.event_date) : "", has("start_time") ? p.start_time : ""].filter(Boolean).join(" · ");
  const cd = has("event_date") ? countdown(p.event_date) : null;
  const gcal = googleCalUrl(p); // only populated when calStart is present (date is public)
  // Extra public facts beyond the headline date/time.
  const facts = [];
  if (has("location")) facts.push(["📍 Where", p.location]);
  if (has("theme")) facts.push(["🎭 Theme", p.theme]);
  if (has("headcount_target")) facts.push(["👥 Expected", `~${p.headcount_target} people`]);
  if (has("budget_target")) facts.push(["💸 Budget", `$${p.budget_target}`]);
  appEl.innerHTML = `
    <div class="vol-head"><h1>🎃 ${esc(has("name") ? p.name : "The Halloween Party")}</h1><p>Save the date — details are still coming together. 👻</p></div>
    <div class="vol-wrap">
      <div class="facts" style="margin-top:18px;text-align:center">
        ${when ? `<div style="font-size:26px;font-weight:800;letter-spacing:.3px;margin-bottom:6px">${esc(when)}</div>` : `<div style="font-size:20px;font-weight:700;margin-bottom:6px">Date coming soon</div>`}
        ${cd ? `<div class="countdown" style="display:inline-block">🎃 ${esc(cd.text)}</div>` : ""}
        ${gcal ? `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:16px">
          <a class="btn primary" href="${gcal}" target="_blank" rel="noopener">Add to Google Calendar</a>
          <a class="btn" href="/api/public/party.ics">Download for Apple / Outlook</a>
        </div>` : ""}
      </div>
      ${facts.length ? `<div class="facts" style="margin-top:14px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px">
        ${facts.map(([l, v]) => `<div><div style="font-size:12px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.05em">${l}</div><div style="font-size:16px;font-weight:600;margin-top:2px">${esc(v)}</div></div>`).join("")}
      </div></div>` : ""}
      ${has("notes") ? `<div class="facts" style="margin-top:14px"><p style="margin:0;color:var(--muted)">${esc(p.notes)}</p></div>` : ""}
      <div class="facts" style="margin-top:16px;text-align:center">
        <h2>💡 Have an idea?</h2>
        <p class="countdown" style="margin-bottom:12px">Costumes, food, music, decor — drop a suggestion. No account needed.</p>
        <a class="btn primary" href="/ideas">Share an idea</a>
      </div>
      <p class="empty" style="font-size:12px;margin-top:22px">Helping run the party? <a href="#" id="hostLogin" style="color:var(--accent);font-weight:600">Host login</a></p>
    </div>`;
  const hl = $("#hostLogin"); if (hl) hl.onclick = (e) => { e.preventDefault(); askPin(); };
}

/* ---------------- date helpers ---------------- */
function countdown(dateStr) {
  if (!dateStr) return null;
  const ev = new Date(dateStr + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.round((ev - now) / 86400000);
  if (isNaN(days)) return null;
  if (days < 0) return { text: `${-days} days ago`, days };
  if (days === 0) return { text: "Today! 🎃", days };
  return { text: `${days} days out`, days };
}
function fmtDate(d) { if (!d) return ""; const dt = new Date(d + "T00:00:00"); if (isNaN(dt)) return d; return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function isOverdue(t) { if (!t.due_date || t.status === "done") return false; const dt = new Date(t.due_date + "T23:59:59"); return dt < new Date(); }

/* ---------------- host app ---------------- */
async function refresh() { state.data = await get("/api/state"); }

function tasksAll() { return state.data.tasks; }
function areaById(id) { return state.data.areas.find((a) => a.id == id); }
function personById(id) { return state.data.people.find((p) => p.id == id); }
function childrenOf(id) { return tasksAll().filter((t) => t.parent_id == id); }
function displayPct(t) {
  const kids = childrenOf(t.id);
  if (kids.length) return Math.round((kids.filter((k) => k.status === "done").length / kids.length) * 100);
  if (t.status === "done") return 100;
  return t.percent || 0;
}
const taskTags = (t) => String((t && t.tags) || "").split(",").map((s) => s.trim()).filter(Boolean);
function matchesFilter(t) {
  const f = state.filter;
  if (f.q) { const q = f.q.toLowerCase(); if (!((t.title || "").toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q))) return false; }
  // Owner filter combines (AND) with area/saved/tag: "only mine" resolves to
  // whoever is set in "I'm posting as"; a specific id filters to that person.
  if (f.assignee) { const who = f.assignee === "me" ? getHostId() : f.assignee; if (who && t.assignee_id != who) return false; }
  if (f.tag) return taskTags(t).includes(f.tag);
  if (f.areaId) return t.area_id == f.areaId;
  if (f.saved === "unassigned") return !t.assignee_id && t.status !== "done";
  if (f.saved === "blocked") return t.status === "blocked";
  if (f.saved === "week") { const c = countdown(t.due_date); return c && c.days >= 0 && c.days <= 7; }
  return true;
}

// Which host is signed in on this device (for comment / feedback attribution).
// Stored per-device so a host is remembered between visits.
function getHostId() { try { return localStorage.getItem("hostPersonId") || ""; } catch { return ""; } }
// The planning team who can post as themselves: anyone with admin access
// (approvers) plus hosts/co-hosts/PM roles — i.e. everyone but plain volunteers.
function hostPeople() { return ((state.data && state.data.people) || []).filter((p) => p.is_approver || ["host", "co-host", "pm"].includes(String(p.role || "").toLowerCase())); }
// Compact "tag a host" chip row for comment boxes — toggling a chip notifies
// that host. You can't tag yourself. Returns "" when there's no one to tag.
function hostTagChips() {
  const me = getHostId();
  const others = hostPeople().filter((p) => String(p.id) !== String(me));
  if (!others.length) return "";
  return `<div class="taghosts"><span class="taghint">🔔 Tag:</span>${others.map((p) => `<button type="button" class="chip taghost" data-taghost="${p.id}">${esc(p.name)}</button>`).join("")}</div>`;
}
function wireHostTagChips(root) { if (root) root.querySelectorAll(".taghost").forEach((b) => (b.onclick = () => b.classList.toggle("sel"))); }
function collectTaggedHosts(root) { return root ? [...root.querySelectorAll(".taghost.sel")].map((b) => Number(b.dataset.taghost)) : []; }
// Planning-areas nav section folds up; folded by default until the host opens it.
function areasFolded() { try { const v = localStorage.getItem("areasFolded"); return v === null ? true : v === "1"; } catch { return true; } }
function setAreasFolded(f) { try { localStorage.setItem("areasFolded", f ? "1" : "0"); } catch {} }
// Point fab.dataset (used as the comment/feedback author) at the stored host.
function applyHostIdentity() {
  const id = getHostId();
  const p = ((state.data && state.data.people) || []).find((x) => String(x.id) === String(id));
  fab.dataset.person = p ? String(p.id) : "";
  fab.dataset.name = p ? p.name : "";
}
function setHostIdentity(id) {
  try { id ? localStorage.setItem("hostPersonId", String(id)) : localStorage.removeItem("hostPersonId"); } catch {}
  applyHostIdentity();
  loadMentions().then(render);
}

/* ---------------- host mentions / notifications ---------------- */
let mentionsData = [];
async function loadMentions() {
  const pid = getHostId();
  if (!pid) { mentionsData = []; return; }
  try { mentionsData = await get("/api/mentions/" + pid); } catch { mentionsData = []; }
}
function unseenMentions() { return mentionsData.filter((m) => !m.seen); }
function mentionBanner() {
  const n = unseenMentions().length;
  if (!n) return "";
  return `<div class="mbanner"><span>🔔 You were tagged in <b>${n}</b> ${n === 1 ? "thing" : "things"}</span><div class="grow"></div><button class="btn small" data-mview>View</button><button class="btn small ghost" data-mdismiss title="Mark all read">✕</button></div>`;
}
async function markMentionsSeen() {
  const pid = getHostId(); if (!pid) return;
  try { await post("/api/mentions/" + pid + "/seen", {}); } catch {}
  mentionsData = mentionsData.map((m) => ({ ...m, seen: 1 }));
}
function openMention(kind, ref) {
  if (kind === "task_comment") { state.screen = "work"; state.dial = 1; selectTask(ref, true); }
  else if (kind === "idea_comment") { state.screen = "ideas"; render(); (async () => { if (!ideasLoaded) { try { ideasData = await get("/api/ideas"); ideasLoaded = true; } catch {} } openIdeaDetail(ref); })(); }
}
function openMentionsModal() {
  const list = mentionsData.slice();
  const kindLabel = { task_comment: "💬 a task comment", idea_comment: "💡 an idea comment" };
  modal(`<h3>🔔 Your mentions</h3>${list.length ? `<div>${list.map((m) => `<div class="fbrow" data-mopen="${m.kind}:${m.ref_id}" style="cursor:pointer">${m.seen ? "" : `<span class="mdot" title="new"></span>`}<div class="fm"><div>${esc(m.text || "")}</div><div class="meta">${esc(m.actor_name || "Someone")} tagged you in ${kindLabel[m.kind] || "something"} · ${esc((m.created_at || "").replace("T", " ").slice(0, 16))}</div></div></div>`).join("")}</div>` : `<div class="empty" style="padding:16px">Nothing yet — you'll see a note here when a co-host tags you.</div>`}`, null, { noFeedback: true });
  const box = document.body.lastElementChild;
  box.querySelectorAll("[data-mopen]").forEach((el) => (el.onclick = () => { const [kind, ref] = el.dataset.mopen.split(":"); box.remove(); openMention(kind, Number(ref)); }));
  markMentionsSeen().then(render); // opening the list clears the badge
}

function render() {
  const scrollY = ($(".canvas") || {}).scrollTop || 0;
  const d = state.data;
  const party = d.party || {};
  const cd = countdown(party.event_date);
  appEl.innerHTML = `
    <div class="shell ${state.panelOpen ? "panel-open" : ""}">
      ${state.navOpen ? `<div class="nav-backdrop" data-navclose></div>` : ""}
      ${sidebar()}
      <div class="main">
        ${mentionBanner()}
        ${topbar(party, cd)}
        <div class="canvas" id="canvas">${canvas()}</div>
      </div>
      ${state.panelOpen ? `<aside class="panel">${panel()}</aside>` : ""}
    </div>`;
  wire();
  // The Ideas & Feedback canvases are filled asynchronously. render() only lays
  // down their "Loading…" placeholder, so after every re-render (e.g. opening or
  // closing the mobile nav) we must repopulate them — from cache when we already
  // have the data (no re-fetch flash) — or they'd stay stuck on "Loading…".
  if (state.screen === "ideas") { if (ideasLoaded) drawIdeas(); else mountIdeas(); }
  else if (state.screen === "feedback") { if (fbData) drawFeedback(); else mountFeedback(); }
  else if (state.screen === "theme") { if (fpData) drawFloorplans(); else mountFloorplans(); if (zonePhotos) drawZonePhotos(); else mountZonePhotos(); }
  if (state.panelOpen && state.selectedTaskId) { if (taskExtras.id === state.selectedTaskId && taskExtras.comments) drawTaskExtras(); else mountTaskExtras(state.selectedTaskId); }
  const c = $(".canvas"); if (c) c.scrollTop = scrollY;
}

function sidebar() {
  const d = state.data;
  const folded = areasFolded();
  const areaItem = (a) => {
    const at = tasksAll().filter((t) => t.area_id === a.id);
    const done = at.filter((t) => t.status === "done").length;
    const pct = at.length ? Math.round((done / at.length) * 100) : 0;
    const active = state.screen === "work" && state.filter.areaId === a.id;
    return `<button class="nav-item ${active ? "active" : ""}" data-area="${a.id}"><span class="rollup" style="background:${areaColor(a)};margin-left:0;margin-right:2px"></span> ${esc(a.name)} <span class="count">${pct}%</span></button>`;
  };
  const viewItem = (key, emoji, label, count) =>
    `<button class="nav-item ${state.screen === "work" && state.filter.saved === key ? "active" : ""}" data-saved="${key}"><span class="emoji">${emoji}</span> ${label}${count != null ? `<span class="count">${count}</span>` : ""}</button>`;
  const unassigned = tasksAll().filter((t) => !t.assignee_id && t.status !== "done").length;
  const blocked = tasksAll().filter((t) => t.status === "blocked").length;
  return `
  <nav class="nav ${state.navOpen ? "open" : ""}">
    <div class="brand" style="display:flex;align-items:center;gap:8px"><span class="pk">🎃</span> Josephween${matchMedia("(max-width:1000px)").matches ? `<button data-navclose aria-label="Close menu" style="margin-left:auto;background:none;border:none;font-size:22px;line-height:1;cursor:pointer;color:var(--muted);padding:2px 6px">✕</button>` : ""}</div>
    <button class="nav-item ${state.screen === "work" && state.dial === 0 ? "active" : ""}" data-overview><span class="emoji">◱</span> Overview</button>
    <div class="nav-group"><button class="lbl" data-fold-areas style="display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;cursor:pointer;text-align:left">${folded ? "▸" : "▾"} Planning areas</button>
      ${folded ? "" : d.areas.map(areaItem).join("")}
    </div>
    <div class="nav-group"><div class="lbl">Views</div>
      ${viewItem(null, "▦", "All tasks")}
      ${viewItem("unassigned", "◎", "Needs owner", unassigned)}
      ${viewItem("blocked", "⊘", "Blocked", blocked)}
      ${viewItem("week", "◷", "Due this week")}
    </div>
    <div class="nav-spacer"></div>
    <div class="nav-group">
      <button class="nav-item ${state.screen === "people" ? "active" : ""}" data-screen="people"><span class="emoji">👥</span> People <span class="count">${d.people.length}</span></button>
      <button class="nav-item ${state.screen === "guests" ? "active" : ""}" data-screen="guests"><span class="emoji">🎟️</span> Guests${(d.guests && d.guests.length) ? ` <span class="count">${d.guests.length}</span>` : ""}</button>
      <button class="nav-item ${state.screen === "events" ? "active" : ""}" data-screen="events"><span class="emoji">📅</span> Events${(d.events && d.events.length) ? ` <span class="count">${d.events.length}</span>` : ""}</button>
      ${(() => { const n = (d.checklist || []).filter((c) => !c.done).length; return `<button class="nav-item ${state.screen === "checklist" ? "active" : ""}" data-screen="checklist"><span class="emoji">✅</span> Checklist${n ? ` <span class="count">${n}</span>` : ""}</button>`; })()}
      <button class="nav-item ${state.screen === "theme" ? "active" : ""}" data-screen="theme"><span class="emoji">🎨</span> Theme & Zones${(d.zones && d.zones.length) ? ` <span class="count">${d.zones.length}</span>` : ""}</button>
      <button class="nav-item ${state.screen === "ideas" ? "active" : ""}" data-screen="ideas"><span class="emoji">💡</span> Ideas${d.newIdeas ? ` <span class="count">${d.newIdeas}</span>` : ""}</button>
      <button class="nav-item ${state.screen === "feedback" ? "active" : ""}" data-screen="feedback"><span class="emoji">💬</span> Feedback${d.newFeedback ? ` <span class="count">${d.newFeedback}</span>` : ""}</button>
      <button class="nav-item ${state.screen === "settings" ? "active" : ""}" data-screen="settings"><span class="emoji">⚙️</span> Settings</button>
      ${(() => { const hosts = hostPeople(); if (!hosts.length) return ""; const cur = getHostId(); return `<div style="padding:8px 12px 4px"><label style="display:block;font-size:11px;color:var(--faint);margin-bottom:4px">💬 I'm posting as</label><select data-whoami style="width:100%;padding:7px 8px;border:1px solid var(--line-strong);border-radius:8px;font-size:13px;background:var(--bg)"><option value="">— pick your name —</option>${hosts.map((p) => `<option value="${p.id}" ${String(p.id) === cur ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>`; })()}
      <button class="nav-item" data-logout><span class="emoji">🔒</span> Log out (host)</button>
    </div>
  </nav>`;
}

function topbar(party, cd) {
  const showWork = state.screen === "work";
  let scope = state.filter.areaId ? (areaById(state.filter.areaId) || {}).name : state.filter.saved ? { unassigned: "Needs owner", blocked: "Blocked", week: "Due this week" }[state.filter.saved] : "All areas";
  if (state.filter.assignee) { const who = state.filter.assignee === "me" ? getHostId() : state.filter.assignee; const pn = who ? (personById(who) || {}).name : null; scope += ` · ${state.filter.assignee === "me" ? "mine" : (pn ? pn + "’s" : "assigned")}`; }
  const ownerFilter = () => {
    const cur = state.filter.assignee || "";
    const me = getHostId();
    const opts = [`<option value="">👤 Anyone</option>`, me ? `<option value="me" ${cur === "me" ? "selected" : ""}>👤 Only mine</option>` : ""]
      .concat((state.data.people || []).map((p) => `<option value="${p.id}" ${String(cur) === String(p.id) ? "selected" : ""}>${esc(p.name)}</option>`));
    return `<select class="ownerfilter" data-ownerfilter title="Filter by who it's assigned to">${opts.join("")}</select>`;
  };
  return `
  <div class="topbar">
    <div class="topbar-row">
      <button class="btn ghost navtoggle" data-navtoggle>☰</button>
      <div class="title-block">
        <h1>${esc(party.name || "The Party")}</h1>
        ${cd ? `<span class="countdown">🗓️ ${esc(party.event_date ? fmtDate(party.event_date) : "")} · <b>${esc(cd.text)}</b></span>` : `<span class="countdown">Set the date →</span>`}
      </div>
      <div class="grow"></div>
      ${showWork ? `<div class="search">🔍<input id="q" placeholder="Search tasks" value="${esc(state.filter.q)}"/></div>
      <button class="btn primary" data-add-task>+ Task</button>` : ""}
    </div>
    ${showWork ? `<div class="topbar-row">
      ${dialMarkup(state.dial, ["Overview", "Working", "One task"], "dial")}
      <div class="grow"></div>
      ${state.dial === 1 ? `<span class="countdown">${esc(scope)}</span>
      ${ownerFilter()}
      ${state.view !== "board" ? `<button class="btn small ghost" data-toggle-done>${state.showDone ? "☑ Showing done" : "☐ Show done"}</button>` : ""}
      <div class="viewswitch">
        ${["grid", "board", "calendar", "timeline", "gantt"].map((v) => `<button class="${state.view === v ? "on" : ""}" data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}
      </div>` : ""}
    </div>` : ""}
  </div>`;
}

function canvas() {
  if (state.screen === "people") return peopleView();
  if (state.screen === "guests") return guestsView();
  if (state.screen === "events") return eventsView();
  if (state.screen === "checklist") return checklistView();
  if (state.screen === "theme") return themeView();
  if (state.screen === "ideas") return `<div id="ideasmount"><div class="empty">Loading ideas…</div></div>`;
  if (state.screen === "feedback") return `<div id="fbmount"><div class="empty">Loading…</div></div>`;
  if (state.screen === "settings") return settingsView();
  if (state.dial === 0) return overview();
  if (state.dial === 2) return spotlight();
  if (state.view === "board") return boardView();
  if (state.view === "calendar") return calendarView();
  if (state.view === "timeline") return timelineView();
  if (state.view === "gantt") return ganttView();
  return gridView();
}

/* ---------------- GRID ---------------- */
function areaOrderedRows(areaId) {
  const all = tasksAll().filter((t) => t.area_id === areaId);
  const rows = [];
  all.filter((t) => !t.parent_id).forEach((t) => { rows.push({ t, depth: 0 }); all.filter((c) => c.parent_id === t.id).forEach((c) => rows.push({ t: c, depth: 1 })); });
  all.filter((t) => t.parent_id && !all.some((p) => p.id === t.parent_id)).forEach((c) => rows.push({ t: c, depth: 1 }));
  return rows.filter((r) => matchesFilter(r.t));
}

function gridView() {
  const d = state.data;
  const areas = state.filter.areaId ? d.areas.filter((a) => a.id === state.filter.areaId) : d.areas;
  let n = 0;
  const groups = areas.map((a) => {
    const rows = areaOrderedRows(a.id);
    if (!rows.length && (state.filter.saved || state.filter.q || state.filter.tag || state.filter.assignee)) return "";
    const done = rows.filter((r) => r.t.status === "done").length;
    const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
    const shown = state.showDone ? rows : rows.filter((r) => r.t.status !== "done");
    const hiddenDone = rows.length - shown.length;
    const collapsed = state.collapsed[a.id];
    const body = collapsed ? "" : (shown.length
      ? shown.map((r) => taskRow(r.t, ++n, r.depth)).join("") + (hiddenDone ? `<tr><td colspan="7" style="padding:6px 12px;color:var(--faint);font-size:12px">${hiddenDone} completed ${hiddenDone === 1 ? "task" : "tasks"} hidden</td></tr>` : "")
      : rows.length ? `<tr><td colspan="7"><div class="empty" style="padding:14px">🎉 All ${rows.length} done in ${esc(a.name)}.</div></td></tr>`
      : `<tr><td colspan="7"><div class="empty"><div>No tasks in ${esc(a.name)} yet.</div><button class="btn small" data-add-task data-area="${a.id}">+ Add one</button></div></td></tr>`);
    return `<tr class="grouphdr"><td colspan="7"><button class="gh" data-collapse="${a.id}"><span class="tri">${collapsed ? "▶" : "▼"}</span><span style="width:10px;height:10px;border-radius:3px;background:${areaColor(a)};display:inline-block"></span> ${a.emoji || ""} ${esc(a.name).toUpperCase()} <span class="gcount">${rows.length}</span><span class="growbar"><span class="mini-track"><div style="width:${pct}%"></div></span> <span class="gcount">${pct}%</span></span></button></td></tr>${body}`;
  }).join("");
  const tagBanner = state.filter.tag ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px"><span class="chip">🏷️ ${esc(state.filter.tag)}</span><span class="meta">Filtered to this tag</span><button class="btn small ghost" data-saved-clear>Clear</button></div>` : "";
  if (!groups.trim()) return `<div class="grid-wrap">${tagBanner}<div class="empty"><div class="big">Nothing matches this filter.</div><button class="btn" data-saved-clear>Show all tasks</button></div></div>`;
  return `<div class="grid-wrap">${tagBanner}<table class="gt">
    <thead><tr><th class="c-num">#</th><th>Task</th><th class="c-owner">Owner</th><th class="c-status">Status</th><th class="c-prio">Prio</th><th class="c-due">Due</th><th class="c-pct">%</th></tr></thead>
    <tbody>${groups}</tbody></table></div>`;
}

function taskRow(t, n, depth) {
  const p = displayPct(t);
  const kids = childrenOf(t.id).length;
  const sel = state.selectedTaskId === t.id ? "sel" : "";
  const blocked = t.status === "blocked" ? "blocked" : "";
  return `<tr class="task ${sel} ${blocked}" data-task="${t.id}">
    <td class="c-num">${n}</td>
    <td><div class="tasktitle ${depth ? "indent" : ""}" data-open="${t.id}">
      <span class="tt ${t.status === "done" ? "done" : ""}">${esc(t.title)}</span>
      ${t.links_field ? `<span class="fact-badge">🔗 ${esc((FACT_META[t.links_field] || {}).label || "fact")}</span>` : ""}
      ${kids ? `<span class="subcount">${childrenOf(t.id).filter((k) => k.status === "done").length}/${kids}</span>` : ""}
      ${taskTags(t).map((tg) => `<span class="chip" style="font-size:11px;padding:1px 7px">🏷️ ${esc(tg)}</span>`).join("")}
    </div></td>
    <td class="c-owner">${ownerSelect(t)}</td>
    <td class="c-status">${statusSelect(t)}</td>
    <td class="c-prio">${prioSelect(t)}</td>
    <td class="c-due"><div class="cell-date ${isOverdue(t) ? "overdue" : ""}"><input type="date" value="${esc(t.due_date || "")}" data-due="${t.id}"/></div></td>
    <td class="c-pct"><div class="pctcell"><span class="pct-track"><div style="width:${p}%"></div></span><span class="pct-num">${p}%</span></div></td>
  </tr>`;
}
function ownerSelect(t) {
  const opts = `<option value="">Unassigned</option>` + state.data.people.map((p) => `<option value="${p.id}" ${t.assignee_id == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  return `<select class="cell-sel cell-owner ${!t.assignee_id ? "unassigned" : ""}" data-owner="${t.id}">${opts}</select>`;
}
function statusSelect(t) {
  const opts = STATUSES.map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${ST_GLYPH[s]} ${ST_LABEL[s]}</option>`).join("");
  return `<select class="stsel st-${t.status}" data-status="${t.id}">${opts}</select>`;
}
function prioSelect(t) {
  const opts = PRIOS.map((s) => `<option value="${s}" ${s === t.priority ? "selected" : ""}>${PR_GLYPH[s]} ${PR_LABEL[s]}</option>`).join("");
  return `<select class="priosel prio-${t.priority}" data-prio="${t.id}" title="Priority">${opts}</select>`;
}

/* ---------------- BOARD ---------------- */
function boardView() {
  const tasks = tasksAll().filter((t) => !t.parent_id && matchesFilter(t));
  return `<div class="board">${STATUSES.map((s) => {
    const col = tasks.filter((t) => t.status === s);
    return `<div class="board-col"><h3>${ST_GLYPH[s]} ${ST_LABEL[s]} <span>${col.length}</span></h3>
      ${col.map((t) => `<div class="bcard" data-open="${t.id}">
        <div class="bt">${esc(t.title)}</div>
        <div class="brow">${t.area_emoji ? `<span>${t.area_emoji}</span>` : ""}${t.assignee_name ? `<span>🧍 ${esc(t.assignee_name)}</span>` : `<span style="color:var(--accent-strong)">unassigned</span>`}${t.due_date ? `<span>📅 ${fmtDate(t.due_date)}</span>` : ""}</div>
      </div>`).join("") || `<div class="empty" style="padding:10px;font-size:12px">—</div>`}
    </div>`;
  }).join("")}</div>`;
}

/* ---------------- CALENDAR ---------------- */
function calendarView() {
  const party = state.data.party || {};
  if (!state.calMonth) { const base = party.event_date ? new Date(party.event_date + "T00:00:00") : new Date(); state.calMonth = { y: base.getFullYear(), m: base.getMonth() }; }
  const { y, m } = state.calMonth;
  const first = new Date(y, m, 1); const startDow = first.getDay(); const dim = new Date(y, m + 1, 0).getDate();
  const monthName = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const tasks = tasksAll().filter((t) => matchesFilter(t) && t.due_date && (state.showDone || t.status !== "done"));
  const todayStr = new Date().toISOString().slice(0, 10);
  const evDay = party.event_date && new Date(party.event_date + "T00:00:00").getMonth() === m && new Date(party.event_date + "T00:00:00").getFullYear() === y ? new Date(party.event_date + "T00:00:00").getDate() : null;
  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="day empty-day"></div>`;
  for (let dnum = 1; dnum <= dim; dnum++) {
    const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(dnum).padStart(2, "0")}`;
    const dayTasks = tasks.filter((t) => t.due_date === ds);
    cells += `<div class="day ${ds === todayStr ? "today" : ""} ${dnum === evDay ? "event" : ""}">
      <div class="dn">${dnum}${dnum === evDay ? " 🎃" : ""}</div>
      ${dayTasks.map((t) => `<div class="ev ${t.status === "done" ? "done" : ""}" data-open="${t.id}" title="${esc(t.title)}" style="border-left:3px solid ${areaColorById(t.area_id)}">${esc(t.title)}</div>`).join("")}
    </div>`;
  }
  const nodate = tasksAll().filter((t) => matchesFilter(t) && !t.due_date && t.status !== "done");
  return `
    <div class="cal-head"><button class="btn small" data-cal="-1">←</button><h2>${monthName}</h2><button class="btn small" data-cal="1">→</button></div>
    <div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="dow">${d}</div>`).join("")}${cells}</div>
    ${nodate.length ? `<div class="section-title">No due date (${nodate.length})</div><div class="grid-wrap" style="padding:6px">${nodate.map((t) => `<div class="ev" style="margin:4px" data-open="${t.id}">${esc(t.title)}</div>`).join("")}</div>` : ""}`;
}

/* ---------------- TIMELINE (by deadline, ungrouped) ---------------- */
function timelineView() {
  const tasks = tasksAll().filter((t) => matchesFilter(t) && (state.showDone || t.status !== "done"));
  const withDate = tasks.filter((t) => t.due_date).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const noDate = tasks.filter((t) => !t.due_date);
  const b = { overdue: [], week: [], month: [], later: [] };
  withDate.forEach((t) => { const c = countdown(t.due_date); if (!c) return; if (c.days < 0) b.overdue.push(t); else if (c.days <= 7) b.week.push(t); else if (c.days <= 31) b.month.push(t); else b.later.push(t); });
  const sec = (label, list) => list.length ? `<div class="section-title">${label} · ${list.length}</div><div class="grid-wrap" style="padding:4px 12px;margin-bottom:6px">${list.map(timelineRow).join("")}</div>` : "";
  const body = sec("⚠️ Overdue", b.overdue) + sec("🔥 This week", b.week) + sec("📅 This month", b.month) + sec("Later", b.later) + sec("No date yet", noDate);
  return body || `<div class="empty panel" style="margin-top:14px">Nothing scheduled here.</div>`;
}
function timelineRow(t) {
  const a = areaById(t.area_id);
  return `<div class="fbrow" data-open="${t.id}" style="cursor:pointer;align-items:center">
    <div style="width:8px;height:38px;border-radius:3px;background:${areaColor(a)};flex:none"></div>
    <div class="fm"><div style="font-weight:600${t.status === "done" ? ";text-decoration:line-through;color:var(--faint)" : ""}">${esc(t.title)}${t.priority === "high" ? ` <span style="color:#dc2626;font-weight:800">▲</span>` : ""}</div>
      <div class="meta">${a ? `<span style="color:${areaColor(a)};font-weight:600">${a.emoji || ""} ${esc(a.name)}</span> · ` : ""}${t.assignee_name ? `🧍 ${esc(t.assignee_name)}` : `<span style="color:var(--accent-strong)">unassigned</span>`} · 📅 ${fmtDate(t.due_date) || "—"}</div></div>
    <span class="stsel st-${t.status}" style="pointer-events:none">${ST_GLYPH[t.status]} ${ST_LABEL[t.status]}</span>
  </div>`;
}

/* ---------------- GANTT (bars across a weekly time axis, grouped by area) ---------------- */
const GANTT_BAR = { todo: "#94a3b8", claimed: "#7c3aed", in_progress: "#ea6a1e", blocked: "#dc2626", done: "#15803d" };
function ganttView() {
  const tasks = tasksAll().filter((t) => matchesFilter(t) && (state.showDone || t.status !== "done"));
  const dated = tasks.filter((t) => t.due_date);
  const noDate = tasks.filter((t) => !t.due_date);
  const noDateBlock = noDate.length ? `<div class="section-title" style="margin-top:14px">No date yet · ${noDate.length}</div><div class="grid-wrap" style="padding:6px">${noDate.map((t) => `<div class="ev" style="margin:4px;display:inline-block" data-open="${t.id}">${esc(t.title)}</div>`).join("")}</div>` : "";
  if (!dated.length) return `<div class="empty panel" style="margin-top:14px"><div class="big">Nothing with a due date yet.</div><div class="meta">Add due dates and they'll lay out on the gantt.</div></div>${noDateBlock}`;

  const party = state.data.party || {};
  const DAY = 86400000;
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const toD = (s) => new Date(s + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const times = dated.map((t) => toD(t.due_date).getTime());
  if (party.event_date) times.push(toD(party.event_date).getTime());
  times.push(today.getTime());
  let minD = new Date(Math.min(...times)); minD.setHours(0, 0, 0, 0);
  minD = new Date(minD.getTime() - minD.getDay() * DAY); // back to the Sunday
  let maxMs = Math.max(...times) + 3 * DAY;
  // whole number of weeks across the range
  const weeksN = Math.max(1, Math.ceil((maxMs - minD.getTime()) / (7 * DAY)));
  const WEEK_PX = 84, NAME_PX = 168;
  const trackW = weeksN * WEEK_PX;
  const spanMs = weeksN * 7 * DAY;
  const px = (ms) => ((ms - minD.getTime()) / spanMs) * trackW;
  const weeks = []; for (let i = 0; i < weeksN; i++) weeks.push(new Date(minD.getTime() + i * 7 * DAY));
  const todayPx = px(today.getTime());
  const partyPx = party.event_date ? px(toD(party.event_date).getTime()) : null;
  const markers = `${todayPx >= 0 && todayPx <= trackW ? `<div class="gmark gmark-today" style="left:${todayPx.toFixed(1)}px"></div>` : ""}${partyPx != null && partyPx >= 0 && partyPx <= trackW ? `<div class="gmark gmark-party" style="left:${partyPx.toFixed(1)}px"></div>` : ""}`;
  const trackBg = `background-size:${WEEK_PX}px 100%;`;

  const header = `<div class="gantt-row gantt-head">
    <div class="gantt-name"></div>
    <div class="gantt-track" style="width:${trackW}px;${trackBg}">${markers}${weeks.map((d, i) => `<span class="glabel" style="left:${(i * WEEK_PX + 4)}px">${fmtDate(ymd(d))}</span>`).join("")}${partyPx != null ? `<span class="gflag" style="left:${partyPx.toFixed(1)}px">🎃 party</span>` : ""}</div>
  </div>`;

  const bar = (t) => {
    const due = toD(t.due_date).getTime();
    const leadDays = t.effort_hours ? Math.max(2, Math.round(t.effort_hours / 6)) : 4;
    const left = px(due - leadDays * DAY), right = px(due);
    const w = Math.max(10, right - left);
    const done = t.status === "done";
    return `<div class="gantt-track" style="width:${trackW}px;${trackBg}">${markers}
      <div class="gbar ${isOverdue(t) ? "overdue" : ""} ${done ? "done" : ""}" data-open="${t.id}" title="${esc(t.title)} · due ${esc(fmtDate(t.due_date))}" style="left:${Math.max(0, left).toFixed(1)}px;width:${w.toFixed(1)}px;background:${GANTT_BAR[t.status] || "#94a3b8"}"><span class="gbar-label">${esc(t.title)}</span></div>
    </div>`;
  };
  const areas = state.filter.areaId ? state.data.areas.filter((a) => a.id === state.filter.areaId) : state.data.areas;
  const groups = areas.map((a) => {
    const list = dated.filter((t) => t.area_id === a.id).sort((x, y) => (x.due_date < y.due_date ? -1 : 1));
    if (!list.length) return "";
    return `<div class="gantt-group-head"><span class="dot" style="background:${areaColor(a)}"></span> ${a.emoji || ""} ${esc(a.name).toUpperCase()} <span class="gcount">${list.length}</span></div>
      ${list.map((t) => `<div class="gantt-row"><div class="gantt-name ${t.status === "done" ? "done" : ""}" data-open="${t.id}" title="${esc(t.title)}">${esc(t.title)}</div>${bar(t)}</div>`).join("")}`;
  }).join("");
  const orphan = dated.filter((t) => !areas.some((a) => a.id === t.area_id));
  const orphanBlock = orphan.length ? `<div class="gantt-group-head"><span class="dot" style="background:#94a3b8"></span> UNFILED <span class="gcount">${orphan.length}</span></div>${orphan.sort((x, y) => (x.due_date < y.due_date ? -1 : 1)).map((t) => `<div class="gantt-row"><div class="gantt-name" data-open="${t.id}">${esc(t.title)}</div>${bar(t)}</div>`).join("")}` : "";

  return `<div class="gantt-legend"><span class="gl"><i style="background:${GANTT_BAR.todo}"></i>To do</span><span class="gl"><i style="background:${GANTT_BAR.claimed}"></i>Claimed</span><span class="gl"><i style="background:${GANTT_BAR.in_progress}"></i>In progress</span><span class="gl"><i style="background:${GANTT_BAR.blocked}"></i>Blocked</span><span class="gl"><i style="background:${GANTT_BAR.done}"></i>Done</span></div>
    <div class="gantt-scroll"><div class="gantt" style="min-width:${NAME_PX + trackW}px">${header}${groups}${orphanBlock}</div></div>${noDateBlock}`;
}

/* ---------------- OVERVIEW ---------------- */
function overview() {
  const d = state.data, party = d.party || {}, tasks = tasksAll();
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const unassigned = tasks.filter((t) => !t.assignee_id && t.status !== "done").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const cd = countdown(party.event_date);
  const budget = d.supplies.reduce((s, x) => s + (Number(x.estimated_cost) || 0), 0);
  const facts = [
    ["Date", party.event_date ? fmtDate(party.event_date) : null, "event_date"],
    ["Time", party.start_time, "start_time"],
    ["Location", party.location, "location"],
    ["Theme", party.theme, "theme"],
    ["Headcount", party.headcount_target, "headcount_target"],
    ["Budget", party.budget_target != null ? "$" + party.budget_target : null, "budget_target"],
  ];
  // status donut
  const counts = STATUSES.map((s) => tasks.filter((t) => t.status === s).length);
  const total = tasks.length || 1; let acc = 0; const segs = [];
  STATUSES.forEach((s, i) => { const frac = counts[i] / total; if (frac > 0) { segs.push(`${ST_COLOR[s]} ${(acc * 100).toFixed(1)}% ${((acc + frac) * 100).toFixed(1)}%`); acc += frac; } });
  const donut = `conic-gradient(${segs.join(", ")})`;
  return `<div class="dash">
    <div class="facts"><h2>🎃 Party at a glance</h2>
      <div class="factgrid">${facts.map(([k, v, lf]) => `<div class="fact" ${lf ? `data-open-fact="${lf}" style="cursor:pointer"` : ""}><div class="fk">${k}</div><div class="fv ${v == null ? "unset" : ""}">${v == null ? "Set it →" : esc(v)}</div></div>`).join("")}</div>
    </div>
    <div class="tiles">
      <div class="tile ${pct === 100 ? "good" : ""}"><div class="num">${pct}%</div><div class="lbl">${done}/${tasks.length} tasks done</div></div>
      <div class="tile ${unassigned ? "warn" : "good"}"><div class="num">${unassigned}</div><div class="lbl">need an owner</div></div>
      <div class="tile ${blocked ? "bad" : ""}"><div class="num">${blocked}</div><div class="lbl">blocked</div></div>
      <div class="tile"><div class="num">${cd ? (cd.days >= 0 ? cd.days : "—") : "—"}</div><div class="lbl">days to go</div></div>
    </div>
    <div class="twocol">
      <div class="donut-wrap"><div class="donut" style="background:${donut}"><div class="donut-center"><div class="p">${pct}%</div><div class="s">done</div></div></div>
        <div class="legend">${STATUSES.map((s, i) => counts[i] ? `<div><span style="background:${ST_COLOR[s]}"></span>${ST_LABEL[s]} · ${counts[i]}</div>` : "").join("")}</div>
      </div>
      <div class="areabars"><h2>Progress by area</h2>
        ${d.areas.map((a) => { const at = tasks.filter((t) => t.area_id === a.id); const ad = at.filter((t) => t.status === "done").length; const p = at.length ? Math.round((ad / at.length) * 100) : 0; return `<div class="arow"><div class="an">${a.emoji || ""} ${esc(a.name)}</div><div class="at"><div style="width:${p}%"></div></div><div class="ap">${ad}/${at.length}</div></div>`; }).join("")}
      </div>
    </div>
    ${party.event_date ? `<div class="facts"><h2>📅 Share the party calendar</h2>
      <div class="countdown" style="margin-bottom:10px">Anyone can add it — no login needed. Great to share alongside your invite graphic.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${googleCalUrl(party) ? `<a class="btn primary" href="${googleCalUrl(party)}" target="_blank" rel="noopener">Add to Google Calendar</a>` : ""}
        <a class="btn" href="/api/calendar/party.ics">Download .ics (Apple / Outlook)</a>
        <button class="btn ghost" data-copy-cal>Copy shareable link</button>
      </div></div>` : ""}
    <div class="facts"><h2>Jump to</h2><div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" data-saved="unassigned">◎ ${unassigned} need an owner</button>
      <button class="btn" data-saved="blocked">⊘ ${blocked} blocked</button>
      <button class="btn" data-saved="week">◷ Due this week</button>
      <button class="btn" data-screen="people">👥 The crew</button>
    </div></div>
  </div>`;
}

/* ---------------- SPOTLIGHT (dial 2) ---------------- */
function spotlightPool() { return tasksAll().filter((t) => matchesFilter(t)); }
function spotlight() {
  const pool = spotlightPool();
  let t = tasksAll().find((x) => x.id === state.selectedTaskId && matchesFilter(x));
  if (!t) t = pool.find((x) => x.status !== "done") || pool[0];
  if (!t) return `<div class="spot-shell"><div class="spotlight"><div class="empty big">Nothing to focus on here 🎉</div></div></div>`;
  state.selectedTaskId = t.id;
  const a = areaById(t.area_id);
  const idx = pool.findIndex((x) => x.id === t.id);
  const fm = t.links_field ? FACT_META[t.links_field] : null;
  const factVal = fm ? state.data.party[fm.field] : null;
  return `<div class="spot-shell"><div class="spotlight">
    ${a ? `<span class="area-chip">${a.emoji || ""} ${esc(a.name)}</span>` : ""}
    <h1>${esc(t.title)}</h1>
    ${t.description ? `<p class="sdesc">${esc(t.description)}</p>` : ""}
    ${fm ? `<div class="fact-box" style="text-align:left;max-width:420px;margin:0 auto 16px">
      <div class="fh">🔗 This sets the party's ${esc(fm.label)}</div>
      <div style="display:flex;gap:8px"><input id="spotFact" type="${fm.type}" value="${esc(factVal || "")}" placeholder="${esc(fm.ph || "")}" style="flex:1;padding:8px;border:1px solid var(--line-strong);border-radius:8px"/>
      <button class="btn primary" data-spot-fulfill="${t.id}">Save</button></div>
    </div>` : `<div class="spot-status">${[["in_progress", "Working on it"], ["blocked", "Blocked"], ["done", "Done ✓"]].map(([s, l]) => `<button class="btn ${t.status === s ? "primary" : ""}" data-spot-status="${s}" data-id="${t.id}">${l}</button>`).join("")}</div>`}
    <div><button class="btn small" data-open="${t.id}">Open full details</button></div>
    <div class="spot-nav">
      <button class="btn ghost" data-spot-nav="-1" ${idx <= 0 ? "disabled" : ""}>← Previous</button>
      <span class="countdown">${idx + 1} of ${pool.length}</span>
      <button class="btn ghost" data-spot-nav="1" ${idx >= pool.length - 1 ? "disabled" : ""}>Next →</button>
    </div>
    <p class="spot-hint">The only thing that matters right now. Zoom out with the dial when you're ready.</p>
  </div></div>`;
}

/* ---------------- DETAIL PANEL ---------------- */
function panel() {
  const t = tasksAll().find((x) => x.id === state.selectedTaskId);
  if (!t) return "";
  const d = state.data;
  const areaOpts = `<option value="">—</option>` + d.areas.map((a) => `<option value="${a.id}" ${t.area_id == a.id ? "selected" : ""}>${a.emoji || ""} ${esc(a.name)}</option>`).join("");
  const ownerOpts = `<option value="">Unassigned</option>` + d.people.map((p) => `<option value="${p.id}" ${t.assignee_id == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const stOpts = STATUSES.map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${ST_GLYPH[s]} ${ST_LABEL[s]}</option>`).join("");
  const prOpts = PRIOS.map((s) => `<option value="${s}" ${s === t.priority ? "selected" : ""}>${PR_GLYPH[s]} ${PR_LABEL[s]}</option>`).join("");
  const fm = t.links_field ? FACT_META[t.links_field] : null;
  const factVal = fm ? d.party[fm.field] : null;
  const kids = childrenOf(t.id);
  return `
    <div class="panel-head"><span class="pttl">${esc(t.title)}</span><button class="btn ghost" data-panel-close>✕</button></div>
    <div class="panel-body">
      ${fm ? `<div class="fact-box">
        <div class="fh">🔗 This task sets the party's ${esc(fm.label)}</div>
        <div style="display:flex;gap:8px"><input id="factInput" type="${fm.type}" value="${esc(factVal || "")}" placeholder="${esc(fm.ph || "")}"/>
        <button class="btn primary" data-fulfill="${t.id}">Save & done</button></div>
        ${factVal ? `<div style="font-size:12px;color:var(--muted);margin-top:6px">Currently: <b>${esc(factVal)}</b> — flows to the header, everyone's page & calendar.</div>` : ""}
      </div>` : ""}
      <label class="field"><span>Title</span><input id="pTitle" value="${esc(t.title)}"/></label>
      <label class="field"><span>Details</span><textarea id="pDesc" rows="2">${esc(t.description || "")}</textarea></label>
      <div class="field two">
        <label><span>Area</span><select id="pArea">${areaOpts}</select></label>
        <label><span>Owner</span><select id="pOwner">${ownerOpts}</select></label>
      </div>
      <div class="field two">
        <label><span>Status</span><select id="pStatus">${stOpts}</select></label>
        <label><span>Priority</span><select id="pPrio">${prOpts}</select></label>
      </div>
      <div class="field two">
        <label><span>Due</span><input id="pDue" type="date" value="${esc(t.due_date || "")}"/></label>
        <label><span>% complete</span><input id="pPct" type="number" min="0" max="100" value="${t.percent || 0}"/></label>
      </div>
      <label class="field"><span>Tags <span style="color:var(--faint);font-weight:400">(comma-separated)</span></span><input id="pTags" value="${esc(t.tags || "")}" placeholder="e.g. vendor sourcing"/></label>
      ${taskTags(t).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 8px">${taskTags(t).map((tg) => `<button class="chip" data-tagfilter="${esc(tg)}" style="cursor:pointer" title="Show all tasks tagged ${esc(tg)}">🏷️ ${esc(tg)}</button>`).join("")}</div>` : ""}
      <div class="subtasks">
        <div class="sh">Subtasks ${kids.length ? `(${kids.filter((k) => k.status === "done").length}/${kids.length})` : ""}</div>
        ${kids.map((k) => `<div class="subrow"><input type="checkbox" data-subcheck="${k.id}" ${k.status === "done" ? "checked" : ""}/><span class="sname ${k.status === "done" ? "done" : ""}" data-open="${k.id}">${esc(k.title)}</span><button class="btn ghost small danger" data-subdel="${k.id}">✕</button></div>`).join("")}
        <div style="display:flex;gap:6px;margin-top:8px"><input id="newSub" placeholder="Add a subtask…" style="flex:1;border:1px solid var(--line-strong);border-radius:8px;padding:7px 9px"/><button class="btn small" data-addsub="${t.id}">Add</button></div>
      </div>
      <div id="taskExtras" class="task-extras"></div>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn danger" data-deltask="${t.id}">Delete task</button></div>
    </div>`;
}
/* ---- task comments + attachments (loaded lazily per selected task) ---- */
let taskExtras = { id: null, comments: null, attachments: null };
async function mountTaskExtras(id) {
  const mount = $("#taskExtras"); if (!mount) return;
  if (taskExtras.id !== id) { taskExtras = { id, comments: null, attachments: null }; mount.innerHTML = `<div class="empty" style="padding:10px;font-size:13px">Loading…</div>`; }
  try {
    const [c, a] = await Promise.all([get(`/api/tasks/${id}/comments`), get(`/api/tasks/${id}/attachments`)]);
    taskExtras = { id, comments: c, attachments: a };
  } catch { taskExtras = { id, comments: [], attachments: [] }; }
  drawTaskExtras();
}
function attachmentChip(a) {
  const isImg = (a.mime || "").startsWith("image/") || (a.data && a.data.startsWith("data:image/"));
  if (isImg && a.data) return `<div class="att att-img"><img src="${a.data}" data-attzoom="${esc(a.data)}" alt="${esc(a.name || "")}"/><button class="att-x" data-attdel="${a.id}" title="Remove">✕</button></div>`;
  const href = a.url || a.data || "#";
  const icon = a.url ? "🔗" : "📄";
  const label = a.name || a.url || "attachment";
  return `<div class="att att-file"><a href="${esc(href)}" target="_blank" rel="noopener">${icon} ${esc(label)}</a><button class="att-x" data-attdel="${a.id}" title="Remove">✕</button></div>`;
}
function drawTaskExtras() {
  const mount = $("#taskExtras"); if (!mount || taskExtras.id !== state.selectedTaskId || !taskExtras.comments) return;
  const atts = taskExtras.attachments || [], comments = taskExtras.comments || [];
  mount.innerHTML = `
    <div class="section-title" style="margin-top:16px">Attachments ${atts.length ? `(${atts.length})` : ""}</div>
    ${atts.length ? `<div class="attgrid">${atts.map(attachmentChip).join("")}</div>` : `<div class="empty" style="padding:8px;font-size:13px">No files yet — add a photo, PDF, or link.</div>`}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      <label class="btn small" style="cursor:pointer">⬆ Upload<input type="file" id="taFile" accept="image/*,application/pdf" multiple hidden/></label>
      <input id="taUrl" placeholder="…or paste a link" style="flex:1;min-width:140px;border:1px solid var(--line-strong);border-radius:8px;padding:7px 9px"/>
      <button class="btn small" id="taAddUrl">Add link</button>
    </div>
    <div class="section-title" style="margin-top:16px">Comments ${comments.length ? `(${comments.length})` : ""}</div>
    <div>${comments.map((c) => `<div class="fbrow"><div class="fm"><div>${esc(c.body)}</div><div class="meta">${esc(c.person_name || c.author_name || "Anonymous")} · ${esc((c.created_at || "").replace("T", " ").slice(0, 16))}</div></div></div>`).join("") || `<div class="empty" style="padding:8px;font-size:13px">No comments yet.</div>`}</div>
    <div style="display:flex;gap:6px;margin-top:8px"><input id="taComment" placeholder="Add a comment…" style="flex:1;border:1px solid var(--line-strong);border-radius:8px;padding:8px"/><button class="btn small" id="taCommentBtn">Post</button></div>
    ${hostTagChips()}`;
  const id = taskExtras.id;
  wireHostTagChips(mount);
  mount.querySelectorAll("[data-attzoom]").forEach((im) => (im.onclick = () => openLightbox(im.dataset.attzoom)));
  mount.querySelectorAll("[data-attdel]").forEach((b) => (b.onclick = async () => { await del(`/api/tasks/${id}/attachment/${b.dataset.attdel}`); await mountTaskExtras(id); }));
  const file = $("#taFile"); if (file) file.onchange = async () => {
    const files = [...file.files]; file.value = ""; if (!files.length) return;
    toast("Uploading…");
    for (const f of files) {
      try {
        const data = f.type.startsWith("image/") ? await resizeImage(f, 1600, 0.8) : await fileToDataUrl(f);
        if (data.length > 1500000) { toast(`${f.name} is too big (max ~1.5 MB)`); continue; }
        await post(`/api/tasks/${id}/attachment`, { name: f.name, mime: f.type || null, data });
      } catch { toast("Couldn't add that file"); }
    }
    await mountTaskExtras(id); toast("Added");
  };
  const addUrl = async () => { const u = $("#taUrl").value.trim(); if (!u) return; await post(`/api/tasks/${id}/attachment`, { name: u, url: u }); $("#taUrl").value = ""; await mountTaskExtras(id); };
  const au = $("#taAddUrl"); if (au) au.onclick = addUrl;
  const tu = $("#taUrl"); if (tu) tu.onkeydown = (e) => { if (e.key === "Enter") addUrl(); };
  const postComment = async () => { const v = $("#taComment").value.trim(); if (!v) return; const mention_ids = collectTaggedHosts(mount); await post(`/api/tasks/${id}/comment`, { body: v, author_name: fab.dataset.name || null, author_person_id: fab.dataset.person || null, mention_ids }); await mountTaskExtras(id); if (mention_ids.length) toast("Comment posted · host tagged"); };
  const cb = $("#taCommentBtn"); if (cb) cb.onclick = postComment;
  const ci = $("#taComment"); if (ci) ci.onkeydown = (e) => { if (e.key === "Enter") postComment(); };
}
// Read any file (e.g. a PDF) as a data URL for storage.
function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }

/* ---------------- PEOPLE ---------------- */
/* ---------------- CHECKLIST (private, host-only) ---------------- */
function checklistView() {
  const items = state.data.checklist || [];
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const inp = "border:1px solid var(--line-strong);border-radius:7px;padding:7px 9px;font:inherit;background:var(--surface)";
  // group by section, preserving order
  const groups = [];
  items.forEach((it) => {
    let g = groups[groups.length - 1];
    if (!g || g.section !== (it.section || "")) { g = { section: it.section || "", items: [] }; groups.push(g); }
    g.items.push(it);
  });
  return `<div style="max-width:840px">
    <div class="facts"><h2>✅ Checklist <span style="color:var(--faint);font-weight:400;font-size:13px">— private to hosts</span></h2>
      <div class="countdown" style="margin-bottom:12px">Tick items off and jot the answer right on each one. Add your own items anytime.</div>
      <div style="display:flex;align-items:center;gap:10px"><div style="flex:1;height:8px;background:var(--surface-2);border-radius:5px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--accent-strong)"></div></div><div class="meta" style="white-space:nowrap">${done}/${items.length} done</div></div>
    </div>
    <div class="facts" style="margin-top:14px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="clSection" placeholder="Section (optional)" style="width:200px;${inp}"/>
        <input id="clLabel" placeholder="Add an item…" style="flex:1;min-width:180px;${inp}"/>
        <button class="btn primary" data-add-cl>Add</button>
      </div>
    </div>
    ${groups.length ? groups.map((g) => `<div class="facts" style="margin-top:14px">
      ${g.section ? `<h2 style="font-size:15px;margin:0 0 4px">${esc(g.section)}</h2>` : ""}
      ${g.items.map((it) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)">
        <input type="checkbox" data-cldone="${it.id}" ${it.done ? "checked" : ""} style="width:18px;height:18px;margin-top:3px;flex:none;cursor:pointer"/>
        <div style="flex:1;min-width:0">
          <input data-cllabel="${it.id}" value="${esc(it.label)}" style="width:100%;border:none;background:none;font-weight:600;font-size:14px;padding:2px 0;${it.done ? "text-decoration:line-through;color:var(--muted)" : ""}"/>
          <textarea data-clnote="${it.id}" rows="2" placeholder="Note / answer…" style="width:100%;margin-top:4px;${inp};resize:vertical;color:var(--muted)">${esc(it.note || "")}</textarea>
        </div>
        <button class="btn small ghost danger" data-cldel="${it.id}" title="Remove" style="flex:none">✕</button>
      </div>`).join("")}
    </div>`).join("") : `<div class="empty" style="padding:24px">No items yet — add one above.</div>`}
  </div>`;
}

/* ---------------- THEME & ZONES (host-only) ---------------- */
const VIBE_META = { cute: { label: "Cute", emoji: "💚", color: "#15803d", bg: "#e9f7ef" }, unsettling: { label: "Unsettling", emoji: "🌫️", color: "#b45309", bg: "#fdf3e7" }, scary: { label: "Scary", emoji: "💀", color: "#b42318", bg: "#fdeceb" } };
function vibeChip(v) { const m = VIBE_META[v]; return m ? `<span class="chip" style="color:${m.color};background:${m.bg}">${m.emoji} ${m.label}</span>` : ""; }
let fpData = null; // cached floor-plan images (fetched separately from state)
let zonePhotos = null; // cached [{zone_id, idea_id, title, thumb}] for the per-zone galleries

function themeView() {
  const p = state.data.party || {};
  const zones = state.data.zones || [];
  return `
    <div style="max-width:920px">
      <div><h1 style="margin:0;font-size:18px">🎨 Theme & Zones</h1><div class="countdown">The finalized look — the party theme and the decor concept for each part of the house. Hosts only.</div></div>

      <div class="facts" style="margin-top:14px">
        <h2>The theme</h2>
        <label class="field"><span>Concept</span><textarea id="thConcept" rows="2" placeholder="e.g. A fantasy forest upstairs melting into a swamp below…">${esc(p.theme_concept || "")}</textarea></label>
        <div class="field two"><label><span>Mood / aesthetic</span><input id="thMood" value="${esc(p.theme_mood || "")}" placeholder="Beautiful but unsettling"/></label><label><span>Inspirations</span><input id="thInspo" value="${esc(p.theme_inspiration || "")}" placeholder="LOTR, Game of Thrones, NeverEnding Story…"/></label></div>
        <button class="btn primary" data-save-theme>Save theme</button>
      </div>

      <div style="display:flex;align-items:center;gap:10px;margin:22px 0 10px"><h2 style="margin:0;font-size:15px">Zones</h2><span class="chip">${zones.length}</span><div class="grow"></div><button class="btn small primary" data-add-zone>+ Add zone</button></div>
      <div class="cards">${zones.length ? zones.map(zoneCard).join("") : `<div class="empty">No zones yet — add the first area of the house.</div>`}</div>

      <div style="display:flex;align-items:center;gap:10px;margin:24px 0 10px"><h2 style="margin:0;font-size:15px">Floor plans</h2><div class="grow"></div><label class="btn small" style="cursor:pointer">⬆ Upload<input type="file" id="fpUp" accept="image/*" multiple hidden/></label></div>
      <div id="fpmount"><div class="empty" style="padding:16px">Loading floor plans…</div></div>
    </div>`;
}
function zoneCard(z) {
  return `<div class="pcard" data-zonecard="${z.id}">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h3>${esc(z.name)}</h3>${vibeChip(z.vibe)}<div class="grow"></div><button class="btn ghost small" data-edit-zone="${z.id}">Edit</button></div>
    ${z.decor ? `<div style="font-size:13px;color:var(--muted);margin-top:8px;white-space:pre-wrap">${esc(z.decor)}</div>` : `<div style="font-size:13px;color:var(--faint);margin-top:8px">No decor notes yet.</div>`}
    <div class="zphotos" id="zph-${z.id}"></div>
    <div style="margin-top:10px"><button class="btn ghost small danger" data-del-zone="${z.id}">Remove</button></div>
  </div>`;
}
async function mountZonePhotos() {
  try { zonePhotos = await get("/api/zones/photos"); } catch { zonePhotos = []; }
  drawZonePhotos();
}
function drawZonePhotos() {
  if (!zonePhotos) return;
  const byZone = {};
  zonePhotos.forEach((p) => { if (p.thumb) (byZone[p.zone_id] = byZone[p.zone_id] || []).push(p); });
  (state.data.zones || []).forEach((z) => {
    const el = $("#zph-" + z.id); if (!el) return;
    const list = byZone[z.id] || [];
    el.innerHTML = list.length ? `<div class="section-title" style="margin:12px 0 6px">Idea photos · ${list.length}</div><div class="zstrip">${list.map((p) => `<img src="${p.thumb}" data-zoomidea="${p.idea_id}" title="${esc(p.title || "")}" alt="${esc(p.title || "")}"/>`).join("")}</div>` : "";
    el.querySelectorAll("[data-zoomidea]").forEach((im) => (im.onclick = async () => { if (!ideasLoaded) { try { ideasData = await get("/api/ideas"); ideasLoaded = true; } catch {} } openIdeaDetail(Number(im.dataset.zoomidea)); }));
  });
}
async function mountFloorplans() {
  const mount = $("#fpmount"); if (!mount) return;
  try { fpData = await get("/api/floorplans"); } catch (e) { mount.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  drawFloorplans();
}
function drawFloorplans() {
  const mount = $("#fpmount"); if (!mount) return;
  const fps = fpData || [];
  mount.innerHTML = fps.length
    ? `<div style="display:flex;gap:12px;flex-wrap:wrap">${fps.map((f) => `<div style="position:relative"><img src="${f.data}" data-zoom="${f.data}" title="${esc(f.name || "")}" style="max-width:220px;max-height:220px;border-radius:10px;border:1px solid var(--line);cursor:zoom-in;background:#fff"/><button class="btn ghost small danger" data-del-fp="${f.id}" title="Remove" style="position:absolute;top:6px;right:6px">✕</button></div>`).join("")}</div>`
    : `<div class="empty" style="padding:16px">No floor plans yet — upload an image (a photo, screenshot, or export of the plan). Tap to view full-screen once added.</div>`;
  mount.querySelectorAll("[data-zoom]").forEach((im) => (im.onclick = () => openLightbox(im.dataset.zoom)));
  mount.querySelectorAll("[data-del-fp]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this floor plan?")) return; await del("/api/floorplans/" + b.dataset.delFp); fpData = await get("/api/floorplans").catch(() => fpData); drawFloorplans(); }));
}
function openZoneModal(id) {
  const z = id ? (state.data.zones || []).find((x) => x.id == id) || {} : {};
  const vibeOpts = ["", "cute", "unsettling", "scary"].map((v) => `<option value="${v}" ${z.vibe === v ? "selected" : ""}>${v ? VIBE_META[v].emoji + " " + VIBE_META[v].label : "— vibe (optional) —"}</option>`).join("");
  modal(`<h3>${id ? "Edit zone" : "Add a zone"}</h3>
    <label class="field"><span>Area name</span><input id="zName" value="${esc(z.name || "")}" placeholder="e.g. Basement · Swamp"/></label>
    <label class="field"><span>Vibe</span><select id="zVibe">${vibeOpts}</select></label>
    <label class="field"><span>Decor notes</span><textarea id="zDecor" rows="6" placeholder="Props, colors, lighting, fog, reused materials, who's building it…">${esc(z.decor || "")}</textarea></label>`,
    async () => {
      const name = $("#zName").value.trim(); if (!name) return toast("Name the zone");
      const payload = { name, vibe: $("#zVibe").value || null, decor: $("#zDecor").value.trim() || null };
      if (id) await patch("/api/zones/" + id, payload); else await post("/api/zones", payload);
      await refresh(); render(); toast("Saved");
    });
}
function wireTheme() {
  const st = $("[data-save-theme]"); if (st) st.onclick = async () => { await patch("/api/party", { theme_concept: $("#thConcept").value.trim() || null, theme_mood: $("#thMood").value.trim() || null, theme_inspiration: $("#thInspo").value.trim() || null }); await refresh(); toast("Theme saved"); };
  const az = $("[data-add-zone]"); if (az) az.onclick = () => openZoneModal(null);
  appEl.querySelectorAll("[data-edit-zone]").forEach((b) => (b.onclick = () => openZoneModal(Number(b.dataset.editZone))));
  appEl.querySelectorAll("[data-del-zone]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this zone?")) return; await del("/api/zones/" + b.dataset.delZone); await refresh(); render(); }));
  const up = $("#fpUp"); if (up) up.onchange = async () => { const files = [...up.files]; up.value = ""; if (files.length) toast("Uploading…"); for (const f of files) { try { const data = await resizeImage(f, 1600, 0.8); await post("/api/floorplans", { name: f.name, data }); } catch {} } fpData = await get("/api/floorplans").catch(() => fpData); drawFloorplans(); toast("Uploaded"); };
}

/* ---------------- GUESTS (private, host-only) ---------------- */
const GUEST_STATUS = [["coming", "✅ Coming"], ["maybe", "🤔 Maybe"], ["invited", "✉️ Invited"], ["cant", "❌ Can't"]];
const GS_COLOR = { coming: "#15803d", maybe: "#b45309", invited: "#5c6470", cant: "#b42318" };
const guestHeads = (g) => 1 + (Number(g.plus_count) || 0);
function guestsView() {
  const gs = state.data.guests || [];
  const heads = (st) => gs.filter((g) => g.status === st).reduce((n, g) => n + guestHeads(g), 0);
  const inp = "border:1px solid var(--line-strong);border-radius:7px;padding:7px 9px;font:inherit;background:var(--surface)";
  return `<div style="max-width:860px">
    <div class="facts"><h2>🎟️ Guest list <span style="color:var(--faint);font-weight:400;font-size:13px">— private, just for planning</span></h2>
      <div class="countdown" style="margin-bottom:14px">The party's open — people just show up — so this is only a place to jot who you're expecting. Nobody but hosts sees this.</div>
      <div style="display:flex;gap:22px;flex-wrap:wrap">
        <div><div style="font-size:26px;font-weight:800;color:${GS_COLOR.coming}">${heads("coming")}</div><div class="meta">coming (heads)</div></div>
        <div><div style="font-size:26px;font-weight:800;color:${GS_COLOR.maybe}">${heads("maybe")}</div><div class="meta">maybe</div></div>
        <div><div style="font-size:26px;font-weight:800;color:var(--muted)">${heads("invited")}</div><div class="meta">invited</div></div>
        <div><div style="font-size:26px;font-weight:800">${gs.length}</div><div class="meta">on the list</div></div>
      </div>
    </div>
    <div class="facts" style="margin-top:14px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="gName" placeholder="Add a name…" style="flex:1;min-width:180px;${inp}"/>
        <input id="gPlus" type="number" min="0" placeholder="+guests" title="extra heads beyond this person" style="width:96px;${inp}"/>
        <button class="btn primary" data-add-guest>Add</button>
      </div>
    </div>
    <div class="facts" style="margin-top:14px">
      ${gs.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="text-align:left;color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.05em">
          <th style="padding:6px 8px">Name</th><th style="padding:6px 8px">Status</th><th style="padding:6px 8px">+Guests</th><th style="padding:6px 8px">Notes</th><th></th></tr></thead>
        <tbody>${gs.map((g) => `<tr style="border-top:1px solid var(--line)">
          <td style="padding:6px 8px"><input data-gname="${g.id}" value="${esc(g.name)}" style="width:100%;min-width:120px;${inp}"/></td>
          <td style="padding:6px 8px"><select data-gstatus="${g.id}" style="${inp};color:${GS_COLOR[g.status] || ""}">${GUEST_STATUS.map(([v, l]) => `<option value="${v}" ${g.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>
          <td style="padding:6px 8px"><input type="number" min="0" data-gplus="${g.id}" value="${Number(g.plus_count) || 0}" style="width:70px;${inp}"/></td>
          <td style="padding:6px 8px"><input data-gnotes="${g.id}" value="${esc(g.notes || "")}" placeholder="—" style="width:100%;min-width:120px;${inp}"/></td>
          <td style="padding:6px 8px"><button class="btn small ghost danger" data-gdel="${g.id}" title="Remove">✕</button></td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="empty" style="padding:24px">No one on the list yet — add the first name above.</div>`}
    </div>
  </div>`;
}

/* ---------------- EVENTS (host-only) ---------------- */
function eventsView() {
  const evs = state.data.events || [];
  const party = state.data.party || {};
  const dated = evs.filter((e) => e.event_date);
  const undated = evs.filter((e) => !e.event_date);
  const card = (e) => {
    const cd = e.event_date ? countdown(e.event_date) : null;
    const when = e.event_date ? `${fmtDate(e.event_date)}${cd ? ` · <b>${esc(cd.text)}</b>` : ""}` : "Not scheduled yet";
    const time = e.start_time ? `${esc(e.start_time)}${e.end_time ? "–" + esc(e.end_time) : ""}` : "";
    const gcal = eventGCalUrl(e, party);
    return `<div class="evcard">
      <div class="evkind">${EK_EMOJI[e.kind] || "📌"}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0;font-size:15px">${esc(e.title)}</h3>${e.kind ? `<span class="chip">${esc(EK_LABEL[e.kind] || e.kind)}</span>` : ""}</div>
        <div class="evwhen">🗓️ ${when}${time ? ` · ⏰ ${time}` : ""}${e.location ? ` · 📍 ${esc(e.location)}` : ""}</div>
        ${e.notes ? `<div class="evnotes">${esc(e.notes)}</div>` : ""}
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <button class="btn small ghost" data-edit-event="${e.id}">Edit</button>
          ${gcal ? `<a class="btn small ghost" href="${gcal}" target="_blank" rel="noopener">📅 Add to calendar</a>` : ""}
          <button class="btn small ghost danger" data-del-event="${e.id}">Remove</button>
        </div>
      </div>
    </div>`;
  };
  return `<div style="max-width:760px">
    <div style="display:flex;align-items:center;margin-bottom:14px"><div><h1 style="margin:0;font-size:18px">📅 Events</h1><div class="countdown">Everything on the way to the party — movie nights, craft &amp; pumpkin days, setup, day-of, and tear-down.</div></div><div class="grow"></div><button class="btn primary" data-add-event>+ Add event</button></div>
    ${evs.length ? `
      ${dated.length ? `<div class="evlist">${dated.map(card).join("")}</div>` : ""}
      ${undated.length ? `<div class="section-title" style="margin:18px 0 8px">Not scheduled yet</div><div class="evlist">${undated.map(card).join("")}</div>` : ""}
    ` : `<div class="empty panel" style="padding:30px">
        <div class="big">No events yet.</div>
        <div class="meta" style="margin:6px 0 14px">Add them one at a time, or drop in a starter timeline you can fill in later.</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" data-add-event>+ Add event</button><button class="btn" data-seed-events>✨ Add starter timeline</button></div>
      </div>`}</div>`;
}
function openEventModal(id) {
  const e = id ? (state.data.events || []).find((x) => x.id == id) || {} : {};
  const kindOpts = `<option value="">—</option>` + EVENT_KINDS.map(([k, em, l]) => `<option value="${k}" ${e.kind === k ? "selected" : ""}>${em} ${l}</option>`).join("");
  modal(`<h3>${id ? "Edit event" : "Add event"}</h3>
    <label class="field"><span>Name</span><input id="evName" value="${esc(e.title || "")}" placeholder="e.g. Pumpkin carving day"/></label>
    <div class="field two"><label><span>Type</span><select id="evKind">${kindOpts}</select></label><label><span>Date</span><input id="evDate" type="date" value="${esc(e.event_date || "")}"/></label></div>
    <div class="field two"><label><span>Start time</span><input id="evStart" value="${esc(e.start_time || "")}" placeholder="e.g. 6:00 PM"/></label><label><span>End time</span><input id="evEnd" value="${esc(e.end_time || "")}" placeholder="optional"/></label></div>
    <label class="field"><span>Location</span><input id="evLoc" value="${esc(e.location || "")}" placeholder="optional"/></label>
    <label class="field"><span>Notes</span><textarea id="evNotes" rows="2" placeholder="What's happening, what to bring…">${esc(e.notes || "")}</textarea></label>`,
    async () => {
      const payload = { title: $("#evName").value.trim(), kind: $("#evKind").value || null, event_date: $("#evDate").value || null, start_time: $("#evStart").value.trim() || null, end_time: $("#evEnd").value.trim() || null, location: $("#evLoc").value.trim() || null, notes: $("#evNotes").value.trim() || null };
      if (!payload.title) return toast("Add a name");
      if (id) await patch("/api/events/" + id, payload); else await post("/api/events", payload);
      await refresh(); render(); toast("Saved");
    });
}
async function seedStarterEvents() {
  const seed = [
    { title: "Movie night", kind: "movie" },
    { title: "Craft day #1", kind: "craft" },
    { title: "Craft day #2", kind: "craft" },
    { title: "Pumpkin carving day", kind: "pumpkin" },
    { title: "Setup #1", kind: "setup" },
    { title: "Setup #2", kind: "setup" },
    { title: "Day-of activities", kind: "dayof" },
    { title: "Tear-down", kind: "teardown" },
  ];
  await post("/api/events", { seed });
  await refresh(); render(); toast("Starter timeline added — fill in the dates");
}

function peopleView() {
  const d = state.data;
  return `<div style="display:flex;align-items:center;margin-bottom:14px"><div><h1 style="margin:0;font-size:18px">The crew</h1><div class="countdown">Each person gets a private link showing only their tasks, on their channel.</div></div><div class="grow"></div><button class="btn primary" data-add-person>+ Add person</button></div>
  <div class="cards">${d.people.length ? d.people.map(personCard).join("") : `<div class="empty">No one yet — add your co-hosts and volunteers.</div>`}</div>`;
}
function personCard(p) {
  const n = tasksAll().filter((t) => t.assignee_id == p.id).length;
  return `<div class="pcard">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${avatarHtml(p, 46)}<h3>${esc(p.name)}</h3>${p.role && p.role !== "volunteer" ? `<span class="role">${esc(p.role)}</span>` : ""}${p.is_approver ? `<span class="role" style="background:#f3efff;color:var(--accent-purple)">✓ Approver</span>` : ""}<div class="grow"></div><button class="btn ghost small" data-edit-person="${p.id}">Edit</button></div>
    <div class="chan">Prefers <b>${channelLabel(p.preferred_channel)}</b>${p.platform ? ` · ${esc(PLATFORMS[p.platform] || p.platform)}` : ""}</div>
    <div style="font-size:13px;color:var(--muted)">${p.email ? `📧 ${esc(p.email)}<br>` : ""}${p.phone ? `📱 ${esc(p.phone)}<br>` : ""}${p.channel_notes ? `📝 ${esc(p.channel_notes)}` : ""}</div>
    ${p.notes ? `<div class="pnote">${esc(p.notes)}</div>` : ""}
    <div style="margin-top:10px"><span class="chip">${n} task${n === 1 ? "" : "s"}</span></div>
    <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap"><button class="btn small" data-copy="${esc(p.share_token)}">🔗 Copy link</button><button class="btn ghost small" data-vcard="${p.id}" title="Save to your phone's contacts (iPhone & Android)">👤 Add to contacts</button><button class="btn ghost small danger" data-del-person="${p.id}">Remove</button></div>
  </div>`;
}

// Build a vCard (.vcf). Tapping the downloaded file opens the native
// "Add to Contacts" screen on both iOS and Android.
function personVCard(p) {
  const clean = (s) => String(s || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const name = (p.name || "").trim();
  const parts = name.split(/\s+/);
  const last = parts.length > 1 ? parts.pop() : "";
  const first = parts.join(" ");
  const org = (state.data.party && state.data.party.name) || "The party";
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${clean(last)};${clean(first)};;;`, `FN:${clean(name)}`, `ORG:${clean(org)}`];
  if (p.role && p.role !== "volunteer") lines.push(`TITLE:${clean(p.role)}`);
  if (p.phone) lines.push(`TEL;TYPE=CELL:${clean(p.phone)}`);
  if (p.email) lines.push(`EMAIL;TYPE=INTERNET:${clean(p.email)}`);
  if (p.channel_notes) lines.push(`NOTE:${clean(p.channel_notes)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}
function downloadVCard(id) {
  const p = (state.data.people || []).find((x) => x.id == id);
  if (!p) return;
  const blob = new Blob([personVCard(p)], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(p.name || "contact").replace(/[^a-z0-9]+/gi, "-")}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Opening contact card…");
}

/* ---------------- SETTINGS ---------------- */
function settingsView() {
  const p = state.data.party || {};
  return `<div style="max-width:560px">
    <div class="facts"><h2>Party details</h2>
      <label class="field"><span>Party name</span><input id="stName" value="${esc(p.name || "")}"/></label>
      <div class="field two"><label><span>Date</span><input id="stDate" type="date" value="${esc(p.event_date || "")}"/></label><label><span>Start time</span><input id="stTime" value="${esc(p.start_time || "")}"/></label></div>
      <label class="field"><span>Location</span><input id="stLoc" value="${esc(p.location || "")}"/></label>
      <div class="field two"><label><span>Theme</span><input id="stTheme" value="${esc(p.theme || "")}"/></label><label><span>Headcount target</span><input id="stHead" type="number" value="${p.headcount_target != null ? esc(p.headcount_target) : ""}"/></label></div>
      <label class="field"><span>Budget ($)</span><input id="stBudget" type="number" value="${p.budget_target != null ? esc(p.budget_target) : ""}"/></label>
      <label class="field"><span>Note to the crew</span><textarea id="stNotes" rows="2">${esc(p.notes || "")}</textarea></label>
      <label class="field"><span>📅 Calendar event details</span><textarea id="stCal" rows="6" placeholder="This is exactly what shows up when anyone adds the party to their calendar — address, timing, costume note, parking, ride plan, etc.">${esc(p.cal_details || "")}</textarea><div style="font-size:11px;color:var(--faint);margin-top:4px">Shows in the "Add to calendar" event (Google, Apple, Outlook). Edit freely — it updates every link.</div></label>
      <button class="btn primary" data-save-party>Save details</button>
    </div>
    ${publicInfoSection(p)}
    <div class="facts" style="margin-top:14px"><h2>Admin PIN</h2>
      <div class="countdown" style="margin-bottom:10px">Protects editing. Volunteers never need it. ${state.data.pinConfigured ? "" : "<b>No PIN set — anyone can edit.</b>"}</div>
      <label class="field"><span>Set / change PIN</span><input id="stPin" placeholder="${state.data.pinConfigured ? "New PIN" : "Choose a PIN"}"/></label>
      <button class="btn" data-save-pin>Save PIN</button>
    </div></div>`;
}

// Which party fields guests are allowed to see. Hosts pick these.
const PUBLIC_FIELD_OPTS = [
  ["name", "Party name"],
  ["event_date", "Date"],
  ["start_time", "Start time"],
  ["location", "Location / address"],
  ["theme", "Theme"],
  ["headcount_target", "Headcount target"],
  ["budget_target", "Budget"],
  ["notes", "Note to the crew"],
  ["cal_details", "Calendar event details"],
];
function publicSetClient(p) { return new Set(String((p && p.public_fields != null) ? p.public_fields : "name,event_date,start_time").split(",").map((s) => s.trim()).filter(Boolean)); }
function publicInfoSection(p) {
  const on = publicSetClient(p);
  return `<div class="facts" style="margin-top:14px"><h2>👀 Public info — what guests see</h2>
    <div class="countdown" style="margin-bottom:12px">Anyone with the link, without the PIN, sees only what you check here. Everything else — tasks, people, the plan — stays host-only. Volunteers also see their own tasks.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px 16px">
      ${PUBLIC_FIELD_OPTS.map(([k, l]) => `<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer"><input type="checkbox" data-pub="${k}" ${on.has(k) ? "checked" : ""} style="width:auto"/> ${esc(l)}</label>`).join("")}
    </div>
    <div style="margin-top:12px"><button class="btn primary" data-save-public>Save public info</button></div>
  </div>`;
}

/* ---------------- WIRING ---------------- */
function selectTask(id, openPanel) { state.selectedTaskId = id; if (openPanel) state.panelOpen = true; render(); }

function wire() {
  // nav
  appEl.querySelectorAll("[data-area]").forEach((b) => (b.onclick = () => { state.screen = "work"; state.dial = 1; state.filter = { areaId: Number(b.dataset.area), saved: null, q: state.filter.q, assignee: state.filter.assignee }; state.navOpen = false; render(); }));
  appEl.querySelectorAll("[data-saved]").forEach((b) => (b.onclick = () => { state.screen = "work"; state.dial = 1; state.filter = { areaId: null, saved: b.dataset.saved || null, q: state.filter.q, assignee: state.filter.assignee }; state.navOpen = false; render(); }));
  const ov = $("[data-overview]"); if (ov) ov.onclick = () => { state.screen = "work"; state.dial = 0; state.filter = { areaId: null, saved: null, q: "" }; state.navOpen = false; render(); };
  appEl.querySelectorAll("[data-screen]").forEach((b) => (b.onclick = () => { state.screen = b.dataset.screen; state.navOpen = false; render(); }));
  const lo = $("[data-logout]"); if (lo) lo.onclick = () => { clearPin(); state.data = null; state.navOpen = false; renderGuest(); };
  const who = $("[data-whoami]"); if (who) who.onchange = () => { setHostIdentity(who.value); toast(who.value ? `Posting as ${who.options[who.selectedIndex].text}` : "Name cleared"); };
  const owf = $("[data-ownerfilter]"); if (owf) owf.onchange = () => { state.filter.assignee = owf.value || null; render(); };
  const mv = $("[data-mview]"); if (mv) mv.onclick = openMentionsModal;
  const md = $("[data-mdismiss]"); if (md) md.onclick = () => markMentionsSeen().then(render);
  const sc = $("[data-saved-clear]"); if (sc) sc.onclick = () => { state.filter = { areaId: null, saved: null, q: "" }; render(); };
  const nt = $("[data-navtoggle]"); if (nt) nt.onclick = () => { state.navOpen = !state.navOpen; render(); };
  appEl.querySelectorAll("[data-navclose]").forEach((b) => (b.onclick = () => { state.navOpen = false; render(); }));
  const fa = $("[data-fold-areas]"); if (fa) fa.onclick = () => { setAreasFolded(!areasFolded()); render(); };

  // topbar
  const q = $("#q"); if (q) q.oninput = () => { state.filter.q = q.value; const c = $("#canvas"); if (c) c.innerHTML = canvas(); wireCanvas(); };
  appEl.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => { state.view = b.dataset.view; render(); }));
  const td = $("[data-toggle-done]"); if (td) td.onclick = () => { state.showDone = !state.showDone; render(); };
  appEl.querySelectorAll("[data-add-task]").forEach((b) => (b.onclick = () => openTaskModal(null, b.dataset.area ? Number(b.dataset.area) : state.filter.areaId)));
  const dialEl = $("#dial"); if (dialEl) wireDial(dialEl, state.dial, 3, (l) => { state.dial = l; render(); });

  wireCanvas();
  wirePanel();
}

function wireCanvas() {
  // open detail / select
  appEl.querySelectorAll("[data-open]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); selectTask(Number(b.dataset.open), true); }));
  appEl.querySelectorAll("[data-open-fact]").forEach((b) => (b.onclick = () => { const t = tasksAll().find((x) => x.links_field === b.dataset.openFact); if (t) selectTask(t.id, true); else { state.screen = "settings"; render(); } }));
  // inline edits
  appEl.querySelectorAll("[data-owner]").forEach((s) => (s.onchange = async (e) => { await patch("/api/tasks/" + s.dataset.owner, { assignee_id: e.target.value || null }); await refresh(); render(); }));
  appEl.querySelectorAll("[data-status]").forEach((s) => (s.onchange = async (e) => { await patch("/api/tasks/" + s.dataset.status, { status: e.target.value }); await refresh(); render(); }));
  appEl.querySelectorAll("[data-prio]").forEach((s) => (s.onchange = async (e) => { await patch("/api/tasks/" + s.dataset.prio, { priority: e.target.value }); const t = tasksAll().find((x) => x.id == s.dataset.prio); if (t) t.priority = e.target.value; render(); }));
  appEl.querySelectorAll("[data-due]").forEach((i) => (i.onchange = async (e) => { await patch("/api/tasks/" + i.dataset.due, { due_date: e.target.value || null }); const t = tasksAll().find((x) => x.id == i.dataset.due); if (t) t.due_date = e.target.value || null; render(); }));
  appEl.querySelectorAll("[data-collapse]").forEach((b) => (b.onclick = () => { const id = b.dataset.collapse; state.collapsed[id] = !state.collapsed[id]; render(); }));
  // board/calendar
  appEl.querySelectorAll("[data-cal]").forEach((b) => (b.onclick = () => { let { y, m } = state.calMonth; m += Number(b.dataset.cal); if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } state.calMonth = { y, m }; render(); }));
  // overview jumps handled by data-saved/data-screen above (re-query)
  appEl.querySelectorAll("[data-screen]").forEach((b) => (b.onclick = () => { state.screen = b.dataset.screen; render(); if (state.screen === "feedback") mountFeedback(); if (state.screen === "ideas") mountIdeas(); }));
  appEl.querySelectorAll("[data-saved]").forEach((b) => (b.onclick = () => { state.screen = "work"; state.dial = 1; state.filter = { areaId: null, saved: b.dataset.saved || null, q: "" }; render(); }));
  const cc = $("[data-copy-cal]"); if (cc) cc.onclick = () => { const url = location.origin + "/api/calendar/party.ics"; navigator.clipboard.writeText(url).then(() => toast("Calendar link copied")).catch(() => prompt("Copy:", url)); };
  // spotlight
  appEl.querySelectorAll("[data-spot-status]").forEach((b) => (b.onclick = async () => { await patch("/api/tasks/" + b.dataset.id, { status: b.dataset.spotStatus }); await refresh(); render(); toast("Updated"); }));
  appEl.querySelectorAll("[data-spot-nav]").forEach((b) => (b.onclick = () => { const pool = spotlightPool(); const idx = pool.findIndex((x) => x.id === state.selectedTaskId); const nx = pool[idx + Number(b.dataset.spotNav)]; if (nx) { state.selectedTaskId = nx.id; render(); } }));
  const sf = appEl.querySelector("[data-spot-fulfill]"); if (sf) sf.onclick = async () => { await post("/api/tasks/" + sf.dataset.spotFulfill + "/fulfill", { value: $("#spotFact").value }); await refresh(); render(); toast("Saved ✓"); };
  // people
  const ap = $("[data-add-person]"); if (ap) ap.onclick = () => openPersonModal();
  appEl.querySelectorAll("[data-edit-person]").forEach((b) => (b.onclick = () => openPersonModal(Number(b.dataset.editPerson))));
  appEl.querySelectorAll("[data-del-person]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this person?")) return; await del("/api/people/" + b.dataset.delPerson); await refresh(); render(); }));
  appEl.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => { const url = location.origin + "/me/" + b.dataset.copy; navigator.clipboard.writeText(url).then(() => toast("Link copied")).catch(() => prompt("Copy:", url)); }));
  appEl.querySelectorAll("[data-vcard]").forEach((b) => (b.onclick = () => downloadVCard(b.dataset.vcard)));
  // guests
  const agb = $("[data-add-guest]"); if (agb) { const addG = async () => { const name = $("#gName").value.trim(); if (!name) return; const plus = $("#gPlus").value ? Number($("#gPlus").value) : 0; await post("/api/guests", { name, plus_count: plus }); await refresh(); render(); }; agb.onclick = addG; const gn = $("#gName"); if (gn) gn.onkeydown = (e) => { if (e.key === "Enter") addG(); }; }
  appEl.querySelectorAll("[data-gname]").forEach((i) => (i.onchange = async () => { await patch("/api/guests/" + i.dataset.gname, { name: i.value.trim() || "(unnamed)" }); }));
  appEl.querySelectorAll("[data-gnotes]").forEach((i) => (i.onchange = async () => { await patch("/api/guests/" + i.dataset.gnotes, { notes: i.value.trim() || null }); }));
  appEl.querySelectorAll("[data-gstatus]").forEach((s) => (s.onchange = async () => { await patch("/api/guests/" + s.dataset.gstatus, { status: s.value }); await refresh(); render(); }));
  appEl.querySelectorAll("[data-gplus]").forEach((i) => (i.onchange = async () => { await patch("/api/guests/" + i.dataset.gplus, { plus_count: i.value ? Number(i.value) : 0 }); await refresh(); render(); }));
  appEl.querySelectorAll("[data-gdel]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this guest?")) return; await del("/api/guests/" + b.dataset.gdel); await refresh(); render(); }));
  // events
  const aev = $("[data-add-event]"); if (aev) aev.onclick = () => openEventModal();
  const sev = $("[data-seed-events]"); if (sev) sev.onclick = seedStarterEvents;
  appEl.querySelectorAll("[data-edit-event]").forEach((b) => (b.onclick = () => openEventModal(Number(b.dataset.editEvent))));
  appEl.querySelectorAll("[data-del-event]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this event?")) return; await del("/api/events/" + b.dataset.delEvent); await refresh(); render(); }));
  // checklist
  const acb = $("[data-add-cl]"); if (acb) { const addC = async () => { const label = $("#clLabel").value.trim(); if (!label) return; const section = $("#clSection").value.trim() || null; await post("/api/checklist", { label, section }); await refresh(); render(); }; acb.onclick = addC; const cll = $("#clLabel"); if (cll) cll.onkeydown = (e) => { if (e.key === "Enter") addC(); }; }
  appEl.querySelectorAll("[data-cldone]").forEach((c) => (c.onchange = async () => { await patch("/api/checklist/" + c.dataset.cldone, { done: c.checked ? 1 : 0 }); await refresh(); render(); }));
  appEl.querySelectorAll("[data-cllabel]").forEach((i) => (i.onchange = async () => { await patch("/api/checklist/" + i.dataset.cllabel, { label: i.value.trim() || "(untitled)" }); }));
  appEl.querySelectorAll("[data-clnote]").forEach((t) => (t.onchange = async () => { await patch("/api/checklist/" + t.dataset.clnote, { note: t.value.trim() || null }); }));
  appEl.querySelectorAll("[data-cldel]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this item?")) return; await del("/api/checklist/" + b.dataset.cldel); await refresh(); render(); }));
  // settings
  const spb = $("[data-save-party]"); if (spb) spb.onclick = async () => { await patch("/api/party", { name: $("#stName").value.trim(), event_date: $("#stDate").value || null, start_time: $("#stTime").value.trim() || null, location: $("#stLoc").value.trim() || null, theme: $("#stTheme").value.trim() || null, headcount_target: $("#stHead").value ? Number($("#stHead").value) : null, budget_target: $("#stBudget").value ? Number($("#stBudget").value) : null, notes: $("#stNotes").value.trim() || null, cal_details: $("#stCal").value.trim() || null }); await refresh(); render(); toast("Saved"); };
  const pubb = $("[data-save-public]"); if (pubb) pubb.onclick = async () => { const fields = [...appEl.querySelectorAll("[data-pub]:checked")].map((c) => c.dataset.pub).join(","); await patch("/api/party", { public_fields: fields }); await refresh(); render(); toast("Public info updated"); };
  const pinb = $("[data-save-pin]"); if (pinb) pinb.onclick = async () => { const v = $("#stPin").value.trim(); if (!v) return toast("Type a PIN"); await patch("/api/party", { admin_pin: v }); setPin(v); await refresh(); render(); toast("PIN saved"); };
  // theme & zones
  if (state.screen === "theme") wireTheme();
}

function wirePanel() {
  const pc = $("[data-panel-close]"); if (pc) pc.onclick = () => { state.panelOpen = false; render(); };
  const commit = async (field, val) => { await patch("/api/tasks/" + state.selectedTaskId, { [field]: val }); await refresh(); render(); };
  const bind = (sel, field, transform) => { const el = $(sel); if (el) el.onchange = () => commit(field, transform ? transform(el.value) : (el.value || null)); };
  bind("#pTitle", "title"); bind("#pDesc", "description"); bind("#pArea", "area_id", (v) => v || null); bind("#pOwner", "assignee_id", (v) => v || null);
  bind("#pStatus", "status"); bind("#pPrio", "priority"); bind("#pDue", "due_date", (v) => v || null); bind("#pPct", "percent", (v) => Number(v) || 0);
  bind("#pTags", "tags", (v) => v.trim() || null);
  appEl.querySelectorAll("[data-tagfilter]").forEach((b) => (b.onclick = () => { state.panelOpen = false; state.screen = "work"; state.dial = 1; state.filter = { areaId: null, saved: null, tag: b.dataset.tagfilter, q: "" }; render(); }));
  const ff = $("[data-fulfill]"); if (ff) ff.onclick = async () => { await post("/api/tasks/" + ff.dataset.fulfill + "/fulfill", { value: $("#factInput").value }); await refresh(); render(); toast("Saved ✓ — it's now everywhere"); };
  const dt = $("[data-deltask]"); if (dt) dt.onclick = async () => { if (!confirm("Delete this task?")) return; await del("/api/tasks/" + dt.dataset.deltask); state.panelOpen = false; state.selectedTaskId = null; await refresh(); render(); };
  const addsub = $("[data-addsub]"); if (addsub) addsub.onclick = async () => { const v = $("#newSub").value.trim(); if (!v) return; const t = tasksAll().find((x) => x.id === state.selectedTaskId); await post("/api/tasks", { title: v, parent_id: t.id, area_id: t.area_id }); await refresh(); render(); };
  appEl.querySelectorAll("[data-subcheck]").forEach((c) => (c.onchange = async (e) => { await patch("/api/tasks/" + c.dataset.subcheck, { status: e.target.checked ? "done" : "todo", percent: e.target.checked ? 100 : 0 }); await refresh(); render(); }));
  appEl.querySelectorAll("[data-subdel]").forEach((b) => (b.onclick = async () => { await del("/api/tasks/" + b.dataset.subdel); await refresh(); render(); }));
}

/* ---------------- lightbox (full-screen image) ---------------- */
function openLightbox(src) {
  const back = document.createElement("div");
  Object.assign(back.style, { position: "fixed", inset: "0", zIndex: "100000", background: "rgba(0,0,0,0.86)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out", padding: "24px" });
  back.innerHTML = `<img src="${src}" style="max-width:96vw;max-height:92vh;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.5)"/><button aria-label="Close" style="position:fixed;top:14px;right:18px;background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:50%;width:38px;height:38px;font-size:20px;cursor:pointer">✕</button>`;
  const close = () => { back.remove(); document.removeEventListener("keydown", key); };
  const key = (e) => { if (e.key === "Escape") close(); };
  back.onclick = close;
  document.addEventListener("keydown", key);
  document.body.appendChild(back);
}

/* ---------------- tag input (chips + type-to-add + suggestions) ---------------- */
function tagChipsHtml(tags) {
  const list = String(tags || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? `<span style="display:inline-flex;gap:4px;flex-wrap:wrap">${list.map((t) => `<span class="chip" style="background:var(--surface-2)">#${esc(t)}</span>`).join("")}</span>` : "";
}
// All tags already in use — across ideas AND tasks — for one-click reuse.
function collectIdeaTags() {
  const out = [];
  const add = (csv) => String(csv || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((t) => { if (!out.includes(t)) out.push(t); });
  (ideasData || []).forEach((i) => add(i.tags));
  try { (typeof tasksAll === "function" ? tasksAll() : []).forEach((t) => add(t.tags)); } catch {}
  return out.sort();
}
// Turns an empty container into a live tag editor. Read the result with root._getTags().
function mountTagInput(root, initial, suggestions) {
  if (!root) return;
  const norm = (s) => String(s).trim().toLowerCase().replace(/[,]/g, "");
  let tags = (initial || []).map(norm).filter(Boolean);
  const add = (raw, refocus) => { String(raw).split(",").map(norm).filter(Boolean).forEach((t) => { if (!tags.includes(t)) tags.push(t); }); draw(); if (refocus) { const el = root.querySelector("[data-taginput]"); if (el) el.focus(); } };
  const draw = () => {
    const sugg = (suggestions || []).filter((s) => !tags.includes(s));
    root.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${tags.length ? tags.map((t) => `<span class="chip" style="display:inline-flex;align-items:center;gap:4px;background:var(--surface-2)">#${esc(t)} <button type="button" data-rmtag="${esc(t)}" title="Remove" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;line-height:1;padding:0">✕</button></span>`).join("") : `<span style="color:var(--faint);font-size:12px">No tags yet</span>`}</div>
      <input data-taginput placeholder="Type a tag, press Enter…" style="width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px"/>
      ${sugg.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><span style="color:var(--faint);font-size:11px;align-self:center">Existing:</span>${sugg.slice(0, 14).map((s) => `<button type="button" data-addtag="${esc(s)}" class="chip" style="cursor:pointer;background:transparent;border:1px solid var(--line-strong)">+ ${esc(s)}</button>`).join("")}</div>` : ""}`;
    const inp = root.querySelector("[data-taginput]");
    inp.onkeydown = (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(inp.value, true); inp.value = ""; } };
    inp.onblur = () => { if (inp.value.trim()) { add(inp.value); inp.value = ""; } };
    root.querySelectorAll("[data-addtag]").forEach((b) => (b.onclick = () => add(b.dataset.addtag, true)));
    root.querySelectorAll("[data-rmtag]").forEach((b) => (b.onclick = () => { tags = tags.filter((t) => t !== b.dataset.rmtag); draw(); }));
  };
  root._getTags = () => tags.slice();
  draw();
}

/* ---------------- modals ---------------- */
function modal(inner, onSave, opts = {}) {
  const back = document.createElement("div"); back.className = "modal-back";
  // A modal's backdrop sits above the floating 💬 button, so give every dialog
  // its own in-context feedback affordance — you can react to what you're
  // looking at (e.g. the edit-person view) without closing it first.
  const fbBtn = opts.noFeedback ? "" : `<button class="btn ghost small modal-fb" type="button" data-modal-fb>💬 Feedback</button>`;
  back.innerHTML = `<div class="modal"><div class="modal-xrow"><button class="modal-x" data-close aria-label="Close">✕</button></div>${inner}<div class="modal-actions">${fbBtn}<button class="btn ghost" data-close>Cancel</button>${onSave ? `<button class="btn primary" data-save>Save</button>` : ""}</div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.querySelectorAll("[data-close]").forEach((b) => (b.onclick = close));
  const mfb = back.querySelector("[data-modal-fb]");
  if (mfb) mfb.onclick = () => { const h = back.querySelector("h3"); const label = h ? h.textContent.trim() : ""; openFeedback({ target: label ? `“${label}” dialog` : "A pop-up dialog" }); };
  const sv = back.querySelector("[data-save]"); if (sv) sv.onclick = async () => { try { await onSave(); close(); } catch (e) { toast(e.message || "Error"); } };
  // Autofocus the first field on desktop; skip on touch so the on-screen
  // keyboard doesn't spring up every time a modal opens.
  const f = back.querySelector("input,textarea,select");
  if (f && !matchMedia("(pointer: coarse)").matches) f.focus();
  // Draggable: grab any non-interactive part of the dialog to move it aside.
  const dlg = back.querySelector(".modal");
  let drag = false, sx = 0, sy = 0, ox = 0, oy = 0;
  dlg.addEventListener("pointerdown", (e) => {
    // Touch: don't drag — it would hijack scrolling the modal on a phone.
    if (e.pointerType === "touch") return;
    // Don't start a drag on interactive bits or images — capturing the pointer
    // here would steal the click (e.g. from a zoomable photo's onclick).
    if (e.target.closest("input,textarea,select,button,a,label,img,[data-zoom]")) return;
    drag = true; sx = e.clientX; sy = e.clientY; dlg.style.cursor = "grabbing";
    try { dlg.setPointerCapture(e.pointerId); } catch {}
  });
  dlg.addEventListener("pointermove", (e) => { if (drag) dlg.style.transform = `translate(${ox + e.clientX - sx}px, ${oy + e.clientY - sy}px)`; });
  dlg.addEventListener("pointerup", (e) => { if (!drag) return; drag = false; ox += e.clientX - sx; oy += e.clientY - sy; dlg.style.cursor = ""; });
  close.el = back; // handle to this dialog's root, so callers can scope queries when modals stack
  return close;
}
function openTaskModal(id, presetArea) {
  const d = state.data, t = id ? tasksAll().find((x) => x.id == id) : {};
  const areaOpts = `<option value="">— area —</option>` + d.areas.map((a) => `<option value="${a.id}" ${(t.area_id || presetArea) == a.id ? "selected" : ""}>${a.emoji || ""} ${esc(a.name)}</option>`).join("");
  const ownerOpts = `<option value="">Unassigned</option>` + d.people.map((p) => `<option value="${p.id}" ${t.assignee_id == p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  modal(`<h3>${id ? "Edit task" : "New task"}</h3>
    <label class="field"><span>Title</span><input id="mTitle" value="${esc(t.title || "")}" placeholder="What needs doing?"/></label>
    <label class="field"><span>Details</span><textarea id="mDesc" rows="2">${esc(t.description || "")}</textarea></label>
    <div class="field two"><label><span>Area</span><select id="mArea">${areaOpts}</select></label><label><span>Owner</span><select id="mOwner">${ownerOpts}</select></label></div>
    <div class="field two"><label><span>Priority</span><select id="mPrio"><option value="normal">Med</option><option value="high" ${t.priority === "high" ? "selected" : ""}>High</option><option value="low" ${t.priority === "low" ? "selected" : ""}>Low</option></select></label><label><span>Due</span><input id="mDue" type="date" value="${esc(t.due_date || "")}"/></label></div>
    <label class="field"><span>Tags <span style="color:var(--faint);font-weight:400">(comma-separated)</span></span><input id="mTags" value="${esc(t.tags || "")}" placeholder="e.g. vendor sourcing, diy"/></label>`,
    async () => {
      const payload = { title: $("#mTitle").value.trim(), description: $("#mDesc").value.trim() || null, area_id: $("#mArea").value || null, assignee_id: $("#mOwner").value || null, priority: $("#mPrio").value, due_date: $("#mDue").value || null, tags: $("#mTags").value.trim() || null };
      if (!payload.title) return toast("Add a title");
      if (id) await patch("/api/tasks/" + id, payload); else await post("/api/tasks", payload);
      await refresh(); render(); toast("Saved");
    });
}
function openPersonModal(id) {
  const p = id ? state.data.people.find((x) => x.id == id) : {};
  const chanOpts = Object.entries(CHANNELS).map(([v, l]) => `<option value="${v}" ${p.preferred_channel === v ? "selected" : ""}>${l}</option>`).join("");
  const platOpts = `<option value="">—</option>` + Object.entries(PLATFORMS).map(([v, l]) => `<option value="${v}" ${p.platform === v ? "selected" : ""}>${l}</option>`).join("");
  let picked = p.avatar || null; // read by the onSave closure below
  modal(`<h3>${id ? "Edit person" : "Add person"}</h3>
    <label class="field"><span>Name</span><input id="pName" value="${esc(p.name || "")}"/></label>
    <div class="field"><span>Avatar <span style="color:var(--faint);font-weight:400">— pick a fantasy creature or upload a photo</span></span>
      <div class="avpicker">
        <div class="avpreview" id="avPreview"></div>
        <div class="avgrid">${AVATARS.map(([k, e, l]) => `<button type="button" class="avtile" data-av="fx:${k}" title="${l}">${e}</button>`).join("")}</div>
        <div class="avactions"><label class="btn small" style="cursor:pointer">⬆ Upload photo<input type="file" id="avFile" accept="image/*" hidden/></label><button type="button" class="btn small ghost" id="avClear">Use initials</button></div>
      </div>
    </div>
    <div class="field two"><label><span>Email</span><input id="pEmail" value="${esc(p.email || "")}"/></label><label><span>Phone</span><input id="pPhone" value="${esc(p.phone || "")}"/></label></div>
    <div class="field two"><label><span>Preferred channel</span><select id="pChan">${chanOpts}</select></label><label><span>Their world</span><select id="pPlat">${platOpts}</select></label></div>
    <div class="field two"><label><span>Role</span><select id="pRole">${["volunteer", "lead", "co-host", "host", "PM"].map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></label><label><span>Contact notes</span><input id="pNotes" value="${esc(p.channel_notes || "")}"/></label></div>
    <label class="field"><span>Notes for co-hosts</span><textarea id="pAbout" rows="2" placeholder="What they're into, what they've offered to help with, anything handy to remember…">${esc(p.notes || "")}</textarea></label>
    <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pApprover" ${p.is_approver ? "checked" : ""} style="width:auto"/> <span style="margin:0">Idea approver — can moderate the ideas pipeline from their own link</span></label>`,
    async () => {
      const payload = { name: $("#pName").value.trim(), email: $("#pEmail").value.trim() || null, phone: $("#pPhone").value.trim() || null, preferred_channel: $("#pChan").value, platform: $("#pPlat").value || null, role: $("#pRole").value, channel_notes: $("#pNotes").value.trim() || null, notes: $("#pAbout").value.trim() || null, avatar: picked, is_approver: $("#pApprover").checked ? 1 : 0 };
      if (!payload.name) return toast("Add a name");
      if (id) await patch("/api/people/" + id, payload); else await post("/api/people", payload);
      await refresh(); render(); toast("Saved");
    });
  const box = document.body.lastElementChild;
  const drawAv = () => {
    const nm = (box.querySelector("#pName").value || p.name);
    box.querySelector("#avPreview").innerHTML = avatarHtml({ name: nm, avatar: picked }, 60);
    box.querySelectorAll(".avtile").forEach((b) => b.classList.toggle("sel", b.dataset.av === picked));
  };
  box.querySelectorAll(".avtile").forEach((b) => (b.onclick = () => { picked = (picked === b.dataset.av) ? null : b.dataset.av; drawAv(); }));
  box.querySelector("#avClear").onclick = () => { picked = null; drawAv(); };
  box.querySelector("#avFile").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { picked = await resizeImage(f, 256, 0.82); drawAv(); toast("Avatar set"); } catch { toast("Couldn't load that image"); } };
  box.querySelector("#pName").oninput = () => { if (!picked || picked.slice(0, 3) !== "fx:") drawAv(); };
  drawAv();
}

/* ---------------- feedback (admin triage) ---------------- */
async function mountFeedback() {
  const mount = $("#fbmount"); if (!mount) return;
  try { fbData = await get("/api/feedback"); } catch (e) { mount.innerHTML = `<div class="empty">${esc(e.message)}${e.status === 401 ? ` — <button class="btn small" id="pinBtn">Enter PIN</button>` : ""}</div>`; const pb = $("#pinBtn"); if (pb) pb.onclick = askPin; return; }
  drawFeedback();
}
function drawFeedback() {
  const mount = $("#fbmount"); if (!mount || !fbData) return;
  const items = fbData;
  const icon = { love: "❤️", idea: "💡", confusing: "😕", bug: "🐞" };
  mount.innerHTML = `<div class="section-title">What people are telling us (${items.length})</div>
    <div class="grid-wrap" style="padding:14px">${items.length ? items.map((f) => `<div class="fbrow"><div class="fm"><div>${icon[f.sentiment] || "💬"} ${esc(f.message)}</div>${f.target ? `<div class="meta" style="color:var(--accent-strong)">🎯 ${esc(f.target)}</div>` : ""}<div class="meta">${esc(f.person_name || f.author_name || "Anonymous")} · ${esc((f.created_at || "").replace("T", " ").slice(0, 16))} ${f.page ? `· ${esc(f.page)}` : ""}</div></div>
      <select class="cell-sel" style="width:auto" data-fb="${f.id}">${["new", "reviewed", "done"].map((s) => `<option ${s === f.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>`).join("") : `<div class="empty">No feedback yet — it shows up the moment someone taps 💬.</div>`}</div>`;
  mount.querySelectorAll("[data-fb]").forEach((s) => (s.onchange = async (e) => { await patch("/api/feedback/" + s.dataset.fb, { status: e.target.value }); toast("Updated"); }));
}

/* ---------------- ideas pipeline ---------------- */
async function mountIdeas() {
  const mount = $("#ideasmount"); if (!mount) return;
  try { ideasData = await get("/api/ideas"); ideasLoaded = true; } catch (e) { mount.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  drawIdeas();
}
function drawIdeas() {
  const mount = $("#ideasmount"); if (!mount) return;
  const view = state.ideasView || "gallery";
  const body = view === "board" ? ideasBoard() : view === "list" ? ideasList() : ideasGallery();
  mount.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div><h1 style="margin:0;font-size:18px">💡 Ideas</h1><div class="countdown">Anyone can suggest something. Ideas move Submitted → Screening → Approved, and an approved idea can be <b>promoted into a real task</b>.</div></div>
      <div class="grow"></div>
      <div class="viewswitch">${["gallery", "board", "list"].map((v) => `<button class="${view === v ? "on" : ""}" data-iview="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
      <button class="btn primary" data-add-idea>+ Share an idea</button>
    </div>
    ${ideasData.length ? body : `<div class="empty panel" style="padding:30px">No ideas yet — share the first one.</div>`}`;
  wireIdeas(mount);
}
// Pinterest-style masonry — photo-first, filling the page.
function ideasGallery() {
  // Most-voted first (feedback: surface the hottest ideas at the top), then
  // most-discussed, then photo-rich pins.
  const items = ideasData.slice().sort((a, b) => (b.votes || 0) - (a.votes || 0) || (b.comments || 0) - (a.comments || 0) || (b.images || 0) - (a.images || 0));
  return `<div class="idea-masonry">${items.map(ideaPin).join("")}</div>`;
}
// A warm "hot" pill for ideas that have discussion — comments = an idea people
// are actually talking about, so make them pop instead of hiding in grey meta.
function hotPill(i) { return i.comments ? `<span class="hotpill">💬 ${i.comments}</span>` : ""; }
function ideaPin(i) {
  return `<div class="ipin" data-idea="${i.id}">
    ${i.thumb ? `<img src="${i.thumb}" loading="lazy" alt="${esc(i.title)}"/>` : ""}
    <div class="ipin-body">
      <div class="ipin-title">${esc(i.title)}</div>
      ${i.tags ? `<div style="margin-top:5px">${tagChipsHtml(i.tags)}</div>` : ""}
      <div class="ipin-meta"><span style="color:${IS_COLOR[i.stage]}">${IS_EMOJI[i.stage]}</span> · 👍 ${i.votes || 0}${i.images > 1 ? ` · 📷 ${i.images}` : ""}${i.admin_only ? " · 🔒" : ""}${i.comments ? " " + hotPill(i) : ""}</div>
    </div>
  </div>`;
}
function ideasBoard() {
  const cols = ["submitted", "screening", "approved", "promoted"];
  ["declined", "parked"].forEach((s) => { if (ideasData.some((i) => i.stage === s)) cols.push(s); });
  return `<div class="board">${cols.map((s) => {
    const list = ideasData.filter((i) => i.stage === s);
    return `<div class="board-col"><h3>${IS_EMOJI[s]} ${IS_LABEL[s]} <span>${list.length}</span></h3>${list.map(ideaCard).join("") || `<div class="empty" style="padding:8px;font-size:12px">—</div>`}</div>`;
  }).join("")}</div>`;
}
function ideasList() {
  const sorted = ideasData.slice().sort((a, b) => (b.votes || 0) - (a.votes || 0));
  return `<div class="grid-wrap" style="padding:6px 14px">${sorted.map((i) => `
    <div class="fbrow" data-idea="${i.id}" style="cursor:pointer;align-items:center">
      <button class="btn small ghost" data-vote="${i.id}">👍 ${i.votes || 0}</button>
      ${i.thumb ? `<img src="${i.thumb}" class="ithumb" alt="" loading="lazy"/>` : ""}
      <div class="fm"><div style="font-weight:600">${esc(i.title)} <span class="chip" style="color:${IS_COLOR[i.stage]}">${IS_EMOJI[i.stage]} ${IS_LABEL[i.stage]}</span>${i.images > 1 ? ` <span class="chip">📷 ${i.images}</span>` : ""}</div>
        <div class="meta">${i.area_emoji ? `${i.area_emoji} ${esc(i.area_name || "")} · ` : ""}${esc(i.submitter_person_name || i.submitter_name || "Anonymous")}${i.comments ? "" : " · 💬 0"}</div></div>
      ${hotPill(i)}
    </div>`).join("")}</div>`;
}
function ideaCard(i) {
  return `<div class="bcard" data-idea="${i.id}">
    ${i.thumb ? `<img src="${i.thumb}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-bottom:6px"/>` : ""}
    <div class="bt">${esc(i.title)}</div>
    <div class="brow">${i.area_emoji ? `<span>${i.area_emoji} ${esc(i.area_name || "")}</span>` : ""}<span>${esc(i.submitter_person_name || i.submitter_name || "Anon")}</span></div>
    ${i.tags ? `<div style="margin-top:6px">${tagChipsHtml(i.tags)}</div>` : ""}
    <div class="brow" style="margin-top:6px">
      <button class="btn small ghost" data-vote="${i.id}">👍 ${i.votes || 0}</button>
      <span class="chip">💬 ${i.comments || 0}</span>
      ${i.images ? `<span class="chip">📷 ${i.images}</span>` : ""}
      ${i.link ? `<span class="chip" title="has a reference link">🔗</span>` : ""}
      ${i.admin_only ? `<span class="chip" style="color:#b42318" title="Hosts only — hidden from public & volunteer lists">🔒</span>` : ""}
      ${i.impact || i.effort ? `<span class="chip" title="impact / effort">I${i.impact || "–"}·E${i.effort || "–"}</span>` : ""}
      ${i.stage === "promoted" && i.promoted_task_id ? `<span class="chip" style="color:var(--accent-purple)">→ task</span>` : ""}
    </div>
  </div>`;
}
async function doVote(id) {
  const r = await post(`/api/ideas/${id}/vote`, { voter_key: voterKey() });
  const i = ideasData.find((x) => x.id == id); if (i) i.votes = r.votes;
  return r;
}
function wireIdeas(mount) {
  mount.querySelectorAll("[data-iview]").forEach((b) => (b.onclick = () => { state.ideasView = b.dataset.iview; drawIdeas(); }));
  const add = mount.querySelector("[data-add-idea]"); if (add) add.onclick = () => openIdeaModal();
  mount.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); await doVote(b.dataset.vote); drawIdeas(); }));
  mount.querySelectorAll("[data-idea]").forEach((c) => (c.onclick = () => openIdeaDetail(Number(c.dataset.idea))));
}
function openIdeaModal(personId, personName, onDone) {
  let photos = [];
  const areasSrc = (state.data ? state.data.areas : (volCtx.data && volCtx.data.areas)) || [];
  const areaOpts = `<option value="">— area (optional) —</option>` + areasSrc.map((a) => `<option value="${a.id}">${a.emoji || ""} ${esc(a.name)}</option>`).join("");
  const hasAreas = areasSrc.length > 0;
  const zonesSrc = (state.data && state.data.zones) || []; // zones are a host-only concept
  const canFlag = (!!getPin() && !!state.data) || !!window.__approverToken; // host or approver
  modal(`<h3>Share an idea</h3><p class="hint">A suggestion for the party — decor, food, a bit of theatre, anything. It enters the pipeline for review.</p>
    <label class="field"><span>Idea <span style="color:var(--faint);font-weight:400">(optional if you add a photo or link)</span></span><input id="iTitle" placeholder="One line — what's the idea?"/></label>
    <label class="field"><span>Details (optional)</span><textarea id="iDesc" rows="3" placeholder="Anything that helps explain it"></textarea></label>
    <label class="field"><span>Link (optional)</span><input id="iLink" type="url" inputmode="url" placeholder="Paste a URL — a build, product, or inspo photo"/></label>
    <label class="field"><span>Photos (optional)</span><input id="iPhotos" type="file" accept="image/*" multiple/><div id="iPrev" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"></div></label>
    <div class="field ${hasAreas ? "two" : ""}">${hasAreas ? `<label><span>Area (optional)</span><select id="iArea">${areaOpts}</select></label>` : ""}${personId ? "" : `<label><span>Your name (optional)</span><input id="iName" value="${esc(personName || "")}"/></label>`}</div>
    ${zonesSrc.length ? `<label class="field"><span>House zone (optional)</span><select id="iZone"><option value="">— none —</option>${zonesSrc.map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join("")}</select></label>` : ""}
    <label class="field"><span>Tags (optional)</span><div id="iTags"></div></label>
    ${canFlag ? `<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;margin-top:2px"><input type="checkbox" id="iAdminOnly" style="width:auto"/> 🔒 Hosts only <span style="color:var(--faint);font-size:12px">— hidden from the public &amp; volunteer lists</span></label>` : ""}`,
    async () => {
      const title = $("#iTitle").value.trim();
      const descV = $("#iDesc").value.trim(), linkV = $("#iLink").value.trim();
      if (!title && !descV && !linkV && !photos.length) throw new Error("Add a photo, a link, or a note first");
      const tg = $("#iTags"); const tags = tg && tg._getTags ? tg._getTags() : [];
      await post("/api/ideas", { title: title || null, description: descV || null, link: linkV || null, area_id: ($("#iArea") ? $("#iArea").value : "") || null, zone_id: ($("#iZone") ? $("#iZone").value : "") || null, submitter_person_id: personId || null, submitter_name: personId ? null : ($("#iName") ? $("#iName").value.trim() : null), thumb: photos[0] ? photos[0].thumb : null, images: photos.map((p) => p.full), admin_only: ($("#iAdminOnly") && $("#iAdminOnly").checked) ? 1 : 0, tags });
      zonePhotos = null; // a new idea may belong to a zone — refresh that gallery next visit
      toast("Idea shared 🎉"); if (onDone) onDone(); else await mountIdeas();
    });
  const box = document.body.lastElementChild;
  mountTagInput(box.querySelector("#iTags"), [], collectIdeaTags());
  const inp = box.querySelector("#iPhotos"), prev = box.querySelector("#iPrev");
  const renderPrev = () => { prev.innerHTML = photos.map((p, idx) => `<div style="position:relative"><img src="${p.thumb}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"/><button type="button" data-rmp="${idx}" style="position:absolute;top:-6px;right:-6px;background:#b42318;color:#fff;border:none;border-radius:50%;width:18px;height:18px;line-height:1;cursor:pointer;font-size:12px">×</button></div>`).join(""); prev.querySelectorAll("[data-rmp]").forEach((b) => (b.onclick = () => { photos.splice(Number(b.dataset.rmp), 1); renderPrev(); })); };
  if (inp) inp.onchange = async () => {
    const files = [...inp.files].slice(0, 6 - photos.length); inp.value = "";
    prev.insertAdjacentHTML("beforeend", `<span class="meta" id="iUp" style="align-self:center">adding…</span>`);
    for (const f of files) { try { const full = await resizeImage(f, 1400, 0.75); const thumb = await resizeImage(f, 240, 0.6); photos.push({ full, thumb }); } catch {} }
    renderPrev();
  };
}
async function openIdeaDetail(id) {
  const i = ideasData.find((x) => x.id == id); if (!i) return;
  let comments = []; try { comments = await get(`/api/ideas/${id}/comments`); } catch {}
  let images = []; try { images = await get(`/api/ideas/${id}/images`); } catch {}
  const admin = !!getPin() && !!state.data;
  const areaOpts = state.data ? `<option value="">—</option>` + state.data.areas.map((a) => `<option value="${a.id}" ${i.area_id == a.id ? "selected" : ""}>${a.emoji || ""} ${esc(a.name)}</option>`).join("") : "";
  const zoneOpts = state.data ? `<option value="">— none —</option>` + (state.data.zones || []).map((z) => `<option value="${z.id}" ${i.zone_id == z.id ? "selected" : ""}>${esc(z.name)}</option>`).join("") : "";
  modal(`
    <h3 style="margin-bottom:4px">${esc(i.title)}</h3>
    ${i.description ? `<p class="hint">${esc(i.description)}</p>` : ""}
    ${i.link ? `<p style="margin:2px 0 10px"><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer" style="font-weight:600;word-break:break-all">🔗 ${esc(i.link)}</a></p>` : ""}
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn small" id="dVote">👍 ${i.votes || 0}</button>
      <span class="chip" style="color:${IS_COLOR[i.stage]}">${IS_EMOJI[i.stage]} ${IS_LABEL[i.stage]}</span>
      ${i.admin_only ? `<span class="chip" style="color:#b42318" title="Hidden from public & volunteer lists">🔒 Hosts only</span>` : ""}
      ${i.area_emoji ? `<span class="chip">${i.area_emoji} ${esc(i.area_name || "")}</span>` : ""}
      ${i.zone_name ? `<span class="chip" style="background:#f3efff;color:var(--accent-purple)">🏠 ${esc(i.zone_name)}</span>` : ""}
      <span style="color:var(--muted);font-size:12px">by ${esc(i.submitter_person_name || i.submitter_name || "Anonymous")}</span>
    </div>
    ${i.tags ? `<div style="margin-bottom:12px">${tagChipsHtml(i.tags)}</div>` : ""}
    ${images.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${images.map((im) => `<img src="${im.data}" data-zoom="${im.data}" style="max-width:150px;max-height:150px;border-radius:8px;border:1px solid var(--line);cursor:zoom-in"/>`).join("")}</div>` : ""}
    ${admin ? `<div class="fact-box" style="background:var(--surface-2);border-color:var(--line)">
      <div class="field two"><label><span>Stage</span><select id="dStage">${IDEA_STAGES.map((s) => `<option value="${s}" ${i.stage === s ? "selected" : ""}>${IS_EMOJI[s]} ${IS_LABEL[s]}</option>`).join("")}</select></label><label><span>Area</span><select id="dArea">${areaOpts}</select></label></div>
      <label class="field"><span>House zone <span style="color:var(--faint);font-weight:400">— groups its photos on Theme &amp; Zones</span></span><select id="dZone">${zoneOpts}</select></label>
      <div class="field two"><label><span>Impact (1-5)</span><input id="dImpact" type="number" min="1" max="5" value="${i.impact || ""}"/></label><label><span>Effort (1-5)</span><input id="dEffort" type="number" min="1" max="5" value="${i.effort || ""}"/></label></div>
      <label class="field"><span>Link</span><input id="dLink" value="${esc(i.link || "")}" placeholder="Reference URL"/></label>
      <label class="field"><span>Decision note</span><input id="dNote" value="${esc(i.decision_note || "")}" placeholder="Why approved / declined"/></label>
      <label class="field"><span>Tags</span><div id="dTags"></div></label>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer"><input type="checkbox" id="dAdminOnly" ${i.admin_only ? "checked" : ""} style="width:auto"/> 🔒 Hosts only <span style="color:var(--faint);font-size:12px">— hidden from public &amp; volunteer lists</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="dSave">Save</button>
        ${i.stage === "promoted" ? `<span class="chip" style="color:var(--accent-purple)">Promoted → task #${i.promoted_task_id || ""}</span>` : `<button class="btn small primary" id="dPromote">🎯 Promote to task</button>`}
        <button class="btn small ghost danger" id="dDel">Delete</button>
      </div>
    </div>` : ""}
    <div class="section-title" style="margin-top:14px">Comments (${comments.length})</div>
    <div>${comments.map((c) => `<div class="fbrow"><div class="fm"><div>${esc(c.body)}</div><div class="meta">${esc(c.person_name || c.author_name || "Anonymous")} · ${esc((c.created_at || "").replace("T", " ").slice(0, 16))}</div></div></div>`).join("") || `<div class="empty" style="padding:8px;font-size:13px">No comments yet.</div>`}</div>
    <div style="display:flex;gap:6px;margin-top:8px"><input id="dComment" placeholder="Add a comment…" style="flex:1;border:1px solid var(--line-strong);border-radius:8px;padding:8px"/><button class="btn small" id="dCommentBtn">Post</button></div>
    ${hostTagChips()}`,
    null);
  const box = document.body.lastElementChild;
  const q = (s) => box.querySelector(s);
  wireHostTagChips(box);
  box.querySelectorAll("[data-zoom]").forEach((im) => (im.onclick = () => openLightbox(im.dataset.zoom)));
  q("#dVote").onclick = async () => { const r = await doVote(id); q("#dVote").textContent = `👍 ${r.votes}`; };
  q("#dCommentBtn").onclick = async () => { const v = q("#dComment").value.trim(); if (!v) return; const mention_ids = collectTaggedHosts(box); await post(`/api/ideas/${id}/comment`, { body: v, author_name: fab.dataset.name || null, author_person_id: fab.dataset.person || null, mention_ids }); box.remove(); ideasData = await get("/api/ideas").catch(() => ideasData); if ($("#ideasmount")) drawIdeas(); else if ($("#pubIdeas")) mountPublicIdeas(); else if ($("#volIdeas")) mountVolIdeas(); openIdeaDetail(id); };
  if (admin) {
    mountTagInput(q("#dTags"), String(i.tags || "").split(",").map((s) => s.trim()).filter(Boolean), collectIdeaTags());
    q("#dSave").onclick = async () => { await patch(`/api/ideas/${id}`, { stage: q("#dStage").value, area_id: q("#dArea").value || null, zone_id: q("#dZone").value || null, link: q("#dLink").value.trim() || null, impact: q("#dImpact").value ? Number(q("#dImpact").value) : null, effort: q("#dEffort").value ? Number(q("#dEffort").value) : null, decision_note: q("#dNote").value.trim() || null, admin_only: q("#dAdminOnly").checked ? 1 : 0, tags: q("#dTags")._getTags() }); zonePhotos = null; box.remove(); await mountIdeas(); toast("Saved"); };
    const pr = q("#dPromote"); if (pr) pr.onclick = () => { box.remove(); openPromoteModal(i); };
    q("#dDel").onclick = async () => { if (!confirm("Delete this idea?")) return; await del(`/api/ideas/${id}`); box.remove(); await mountIdeas(); };
  }
}
function openPromoteModal(idea) {
  const areaOpts = state.data.areas.map((a) => `<option value="${a.id}" ${idea.area_id == a.id ? "selected" : ""}>${a.emoji || ""} ${esc(a.name)}</option>`).join("");
  const ownerOpts = `<option value="">Unassigned</option>` + state.data.people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  modal(`<h3>🎯 Promote to task</h3><p class="hint">Creates a real task from "<b>${esc(idea.title)}</b>" and marks the idea Promoted.</p>
    <div class="field two"><label><span>Area / phase</span><select id="prArea">${areaOpts}</select></label><label><span>Owner</span><select id="prOwner">${ownerOpts}</select></label></div>
    <div class="field two"><label><span>Priority</span><select id="prPrio"><option value="normal">Med</option><option value="high">High</option><option value="low">Low</option></select></label><label><span>Due</span><input id="prDue" type="date"/></label></div>`,
    async () => {
      await post(`/api/ideas/${idea.id}/promote`, { area_id: $("#prArea").value || null, assignee_id: $("#prOwner").value || null, priority: $("#prPrio").value, due_date: $("#prDue").value || null });
      await refresh(); await mountIdeas(); toast("Promoted → task created 🎯");
    });
}

/* ---------------- public idea drop-box (/ideas) ---------------- */
async function renderPublicIdeas() {
  fab.hidden = false; fab.dataset.person = ""; fab.dataset.name = ""; window.__approverToken = null;
  appEl.innerHTML = `<div class="vol-head"><h1>💡 Josephween — Ideas</h1><p>Got an idea for the party? Drop it here — no account needed. Every idea is reviewed by the hosts.</p></div>
    <div class="vol-wrap"><div id="pubIdeas"><div class="boot">Loading ideas…</div></div></div>`;
  await mountPublicIdeas();
}
async function mountPublicIdeas() {
  const host = $("#pubIdeas"); if (!host) return;
  let list = []; try { list = await get("/api/ideas"); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  ideasData = list;
  const shown = list.filter((i) => i.stage !== "promoted"); // promoted ideas live in the tasks now
  host.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;margin:16px 0;flex-wrap:wrap"><div class="countdown" style="flex:1;min-width:180px">Ideas move Submitted → Screening → Approved, and an approved idea can become a real party task.</div><button class="btn primary" id="pubAdd">+ Share an idea</button></div>
    <div class="grid-wrap" style="padding:6px 14px">${shown.length ? shown.slice().sort((a, b) => (b.votes || 0) - (a.votes || 0)).map((i) => `
      <div class="fbrow" data-pidea="${i.id}" style="cursor:pointer;align-items:center"><button class="btn small ghost" data-pvote="${i.id}">👍 ${i.votes || 0}</button>
        ${i.thumb ? `<img src="${i.thumb}" style="width:46px;height:46px;object-fit:cover;border-radius:8px;flex:none"/>` : ""}
        <div class="fm"><div style="font-weight:600">${esc(i.title)}</div><div class="meta">${esc(i.submitter_person_name || i.submitter_name || "Anonymous")} · <span style="color:${IS_COLOR[i.stage]}">${IS_EMOJI[i.stage]} ${IS_LABEL[i.stage]}</span> · 💬 ${i.comments || 0}${i.images ? ` · 📷 ${i.images}` : ""}${i.link ? " · 🔗" : ""}</div></div></div>`).join("") : `<div class="empty">No ideas yet — be the first!</div>`}</div>
    <p class="empty" style="font-size:13px">Tap an idea to read it, vote, or comment.</p>`;
  $("#pubAdd").onclick = () => openIdeaModal(null, "", () => mountPublicIdeas());
  host.querySelectorAll("[data-pvote]").forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); await doVote(b.dataset.pvote); mountPublicIdeas(); }));
  host.querySelectorAll("[data-pidea]").forEach((c) => (c.onclick = () => openIdeaDetail(Number(c.dataset.pidea))));
}

/* ---------------- feedback widget (with element picker) ---------------- */
let fbState = null, fbCloseModal = null;
function openFeedback(prefill) {
  fbState = { sentiment: (prefill && prefill.sentiment) || null, message: (prefill && prefill.text) || "", target: (prefill && prefill.target) || null, authorName: fab.dataset.name || "" };
  showFeedbackModal();
}
function saveFbInputs() { const m = $("#fbMsg"); if (m) fbState.message = m.value; const n = $("#fbName"); if (n) fbState.authorName = n.value; }
function showFeedbackModal(sent) {
  const person = fab.dataset.person;
  const sents = [["love", "❤️ Love"], ["idea", "💡 Idea"], ["confusing", "😕 Confusing"], ["bug", "🐞 Bug"]];
  fbCloseModal = modal(`
    ${sent ? `<div style="background:#dcfce7;color:#15803d;font-weight:600;border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:13px">✓ Sent — thank you! Add another below, or tap Done.</div>` : ""}
    <h3>How's this working?</h3><p class="hint">Confusing, broken, an idea, or just love — goes straight to the coordinator. Send as many as you like.</p>
    <label class="field"><span>Your feedback</span><textarea id="fbMsg" rows="3" placeholder="Tell me what you're seeing…">${esc(fbState.message)}</textarea></label>
    <div class="sentiments">${sents.map(([v, l]) => `<button type="button" class="btn ${fbState.sentiment === v ? "sel" : ""}" data-sent="${v}">${l}</button>`).join("")}</div>
    <label class="field"><span>What's this about?</span>
      <div style="display:flex;gap:8px;align-items:center">
        <div id="fbTgt" style="flex:1;font-size:13px;color:${fbState.target ? "var(--ink)" : "var(--muted)"};background:var(--surface-2);border-radius:8px;padding:8px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fbState.target ? "🎯 " + esc(fbState.target) : "The whole page"}</div>
        <button type="button" class="btn small" id="fbPick">🎯 Point to it</button>
        ${fbState.target ? `<button type="button" class="btn small ghost" id="fbClr">✕</button>` : ""}
      </div>
      <div style="font-size:11px;color:var(--faint);margin-top:5px">Use 🎯 to click what's behind this window — or just drag this window aside.</div>
    </label>
    ${person ? "" : `<label class="field"><span>Your name (optional)</span><input id="fbName" value="${esc(fbState.authorName)}"/></label>`}`,
    async () => {
      saveFbInputs();
      if (!fbState.message.trim()) throw new Error("Type your feedback in the box first 🙂");
      await post("/api/feedback", { message: fbState.message.trim(), sentiment: fbState.sentiment, page: location.pathname, target: fbState.target, person_id: person || null, author_name: person ? null : (fbState.authorName || null) });
      if (state.screen === "feedback") mountFeedback();
      const keepName = fbState.authorName;
      fbState = { sentiment: null, message: "", target: null, authorName: keepName };
      fbCloseModal();
      showFeedbackModal(true); // reopen cleared so they can add another
    }, { noFeedback: true });
  // Scope to THIS modal — the feedback dialog can stack on top of another modal
  // (e.g. edit-person), so a document-wide query would relabel the wrong buttons.
  const root = fbCloseModal.el || document;
  const sv = root.querySelector(".modal-actions [data-save]"); if (sv) sv.textContent = "Send";
  const cx = root.querySelector(".modal-actions [data-close]"); if (cx) cx.textContent = "Done";
  document.querySelectorAll(".sentiments [data-sent]").forEach((b) => (b.onclick = () => { fbState.sentiment = b.dataset.sent; document.querySelectorAll(".sentiments [data-sent]").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); }));
  const pick = $("#fbPick"); if (pick) pick.onclick = () => { saveFbInputs(); fbCloseModal(); startElementPick(); };
  const clr = $("#fbClr"); if (clr) clr.onclick = () => { saveFbInputs(); fbState.target = null; fbCloseModal(); showFeedbackModal(); };
  const msg = $("#fbMsg"); if (msg) { msg.focus(); msg.setSelectionRange(msg.value.length, msg.value.length); }
}
function describeEl(el) {
  const txt = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
  const tag = el.tagName.toLowerCase();
  const path = []; let n = el, depth = 0;
  while (n && n.nodeType === 1 && n !== document.body && depth < 4) {
    let s = n.tagName.toLowerCase();
    if (n.id) s += "#" + n.id;
    else if (typeof n.className === "string" && n.className.trim()) s += "." + n.className.trim().split(/\s+/)[0];
    path.unshift(s); n = n.parentElement; depth++;
  }
  return (txt ? `"${txt}" ` : "") + `[${tag} · ${path.join(">")}]`;
}
function startElementPick() {
  const hint = document.createElement("div");
  hint.textContent = "Click the thing you want feedback about  ·  Esc to cancel";
  Object.assign(hint.style, { position: "fixed", bottom: "0", left: "0", right: "0", zIndex: "99999", background: "#7c3aed", color: "#fff", font: "600 13px -apple-system,sans-serif", padding: "11px", textAlign: "center", pointerEvents: "none" });
  const hl = document.createElement("div");
  Object.assign(hl.style, { position: "fixed", zIndex: "99998", background: "rgba(124,58,237,0.14)", border: "2px solid #7c3aed", borderRadius: "4px", pointerEvents: "none", display: "none" });
  document.body.appendChild(hint); document.body.appendChild(hl);
  document.body.style.cursor = "crosshair";
  let cur = null;
  const move = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); if (!el || el === hint || el === hl || el === fab) return; cur = el; const r = el.getBoundingClientRect(); Object.assign(hl.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", display: "block" }); };
  const cleanup = () => { document.removeEventListener("mousemove", move, true); document.removeEventListener("click", click, true); document.removeEventListener("keydown", key, true); hint.remove(); hl.remove(); document.body.style.cursor = ""; };
  const click = (e) => { e.preventDefault(); e.stopImmediatePropagation(); if (cur) fbState.target = describeEl(cur); cleanup(); showFeedbackModal(); };
  const key = (e) => { if (e.key === "Escape") { e.preventDefault(); cleanup(); showFeedbackModal(); } };
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
}
function askPin() { modal(`<h3>Host login</h3><p class="hint">Enter the shared host PIN to open the full plan.</p><label class="field"><span>PIN</span><input id="pinInput" type="password"/></label>`, async () => { const v = $("#pinInput").value.trim(); if (!v) return; setPin(v); try { await get("/api/state"); } catch (e) { clearPin(); throw new Error("That PIN didn't work."); } await renderRoot(); }); }

/* ---------------- dial component ---------------- */
function dialMarkup(level, labels, id) {
  const n = labels.length, cx = 70, cy = 40, r = 32, step = 180 / (n - 1);
  const pt = (a, rr) => [cx + rr * Math.cos((a * Math.PI) / 180), cy - rr * Math.sin((a * Math.PI) / 180)];
  const [nx, ny] = pt(180 - level * step, r - 4);
  let ticks = ""; for (let i = 0; i < n; i++) { const [tx, ty] = pt(180 - i * step, r); ticks += `<circle class="dial-tick ${i === level ? "on" : ""}" data-level="${i}" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="5"></circle>`; }
  return `<div class="dialbar" id="${id}">
    <button class="dial-arrow" data-dir="-1" title="Zoom out">–</button>
    <svg viewBox="0 0 140 46" class="dial-svg" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${level}" aria-label="Focus: ${esc(labels[level])}">
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" class="dial-arc"/>
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="dial-needle"/>
      <circle cx="${cx}" cy="${cy}" r="5" class="dial-hub"/>${ticks}
    </svg>
    <button class="dial-arrow" data-dir="1" title="Zoom in">+</button>
    <div class="dial-label">${esc(labels[level])}<small>zoom ${level === 0 ? "· widest" : level === n - 1 ? "· one thing" : ""}</small></div>
  </div>`;
}
function wireDial(root, level, n, onChange) {
  const svg = root.querySelector(".dial-svg"), cx = 70, cy = 40, step = 180 / (n - 1);
  const set = (l) => { l = Math.max(0, Math.min(n - 1, Math.round(l))); if (l !== level) onChange(l); };
  root.querySelectorAll("[data-dir]").forEach((b) => (b.onclick = () => set(level + Number(b.dataset.dir))));
  root.querySelectorAll(".dial-tick").forEach((t) => t.addEventListener("pointerdown", (e) => { e.stopPropagation(); set(Number(t.dataset.level)); }));
  function fromEvent(e) { const rect = svg.getBoundingClientRect(); const vx = ((e.clientX - rect.left) / rect.width) * 140; const vy = ((e.clientY - rect.top) / rect.height) * 46; let a = (Math.atan2(cy - vy, vx - cx) * 180) / Math.PI; if (a < 0) a += 360; a = Math.max(0, Math.min(180, a)); set((180 - a) / step); }
  let drag = false;
  svg.addEventListener("pointerdown", (e) => { drag = true; try { svg.setPointerCapture(e.pointerId); } catch {} fromEvent(e); });
  svg.addEventListener("pointermove", (e) => { if (drag) fromEvent(e); });
  svg.addEventListener("pointerup", () => (drag = false));
  svg.addEventListener("pointercancel", () => (drag = false));
  svg.addEventListener("keydown", (e) => { if (["ArrowLeft", "ArrowDown"].includes(e.key)) { set(level - 1); e.preventDefault(); } if (["ArrowRight", "ArrowUp"].includes(e.key)) { set(level + 1); e.preventDefault(); } });
}

/* ---------------- volunteer view ---------------- */
const VOL_LEVELS = ["Everything", "My tasks", "One thing"];
let volCtx = { token: null, data: null, level: 0 };
async function renderVolunteer(token) {
  fab.hidden = false; fab.dataset.person = "";
  appEl.innerHTML = `<div class="boot">Loading your tasks…</div>`;
  let d; try { d = await get("/api/me/" + encodeURIComponent(token)); } catch (e) { appEl.innerHTML = `<div class="vol-wrap"><div class="facts" style="margin-top:40px"><h2>This link didn't work</h2><p class="countdown">Ask your coordinator for a fresh link.</p></div></div>`; return; }
  fab.dataset.person = d.person.id; fab.dataset.name = d.person.name;
  volCtx = { token, data: d, level: 0 };
  window.__approverToken = d.person.is_approver ? token : null;
  const party = d.party || {};
  const when = [party.event_date ? fmtDate(party.event_date) : "", party.start_time].filter(Boolean).join(" · ");
  appEl.innerHTML = `<div class="vol-head"><div style="display:flex;align-items:center;gap:12px;justify-content:center">${avatarHtml(d.person, 52)}<h1 style="margin:0">🎃 ${esc(party.name || "Halloween Party")}</h1></div><p>Hey ${esc(d.person.name)} — here's just your part${when ? " · " + esc(when) : ""}${party.location ? " · " + esc(party.location) : ""}</p></div>
    <div class="vol-dial" id="volDialMount"></div><div class="vol-wrap">${volCalendarCard()}<div id="volBody"></div><div id="volIdeas"></div></div>`;
  mountVolDial(); drawVol(); wireVolCalendar(); mountVolIdeas();
}
async function mountVolIdeas() {
  const host = $("#volIdeas"); if (!host) return;
  const isApprover = volCtx.data && volCtx.data.person && volCtx.data.person.is_approver;
  let list = []; try { list = await get("/api/ideas"); } catch { return; }
  host.innerHTML = `<div class="section-title">💡 Party ideas${isApprover ? " · you're an approver" : ""}</div>
    <div class="facts" style="margin-top:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap"><div class="countdown" style="flex:1;min-width:160px">Got a suggestion? Share it${isApprover ? " — and as an approver, you can move ideas through the pipeline right here." : " — the coordinator reviews every idea."}</div><button class="btn primary small" id="volAddIdea">+ Share an idea</button></div>
      ${(() => { const shown = list.filter((i) => i.stage !== "promoted"); return shown.length ? shown.sort((a, b) => (b.votes || 0) - (a.votes || 0)).slice(0, 20).map((i) => `
        <div class="fbrow" style="align-items:center"><button class="btn small ghost" data-volvote="${i.id}">👍 ${i.votes || 0}</button>
          ${i.thumb ? `<img src="${i.thumb}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;flex:none"/>` : ""}
          <div class="fm"><div style="font-weight:600">${esc(i.title)}</div><div class="meta">${esc(i.submitter_person_name || i.submitter_name || "Anon")} · 💬 ${i.comments || 0}${i.images ? ` · 📷 ${i.images}` : ""}${i.link ? " · 🔗" : ""}</div></div>
          ${isApprover ? `<select class="stsel" data-volstage="${i.id}">${IDEA_STAGES.map((s) => `<option value="${s}" ${i.stage === s ? "selected" : ""}>${IS_EMOJI[s]} ${IS_LABEL[s]}</option>`).join("")}</select>` : `<span class="chip" style="color:${IS_COLOR[i.stage]}">${IS_EMOJI[i.stage]} ${IS_LABEL[i.stage]}</span>`}</div>`).join("") : `<div class="empty" style="font-size:13px">No ideas yet — be the first.</div>`; })()}
    </div>`;
  const add = $("#volAddIdea"); if (add) add.onclick = () => openIdeaModal(volCtx.data.person.id, volCtx.data.person.name, () => mountVolIdeas());
  host.querySelectorAll("[data-volvote]").forEach((b) => (b.onclick = async () => { await doVote(b.dataset.volvote); mountVolIdeas(); }));
  host.querySelectorAll("[data-volstage]").forEach((sel) => (sel.onchange = async (e) => { await patch(`/api/ideas/${sel.dataset.volstage}`, { stage: e.target.value }); toast("Idea updated"); }));
}

function volCalendarCard() {
  const d = volCtx.data, party = d.party || {};
  if (!party.event_date) return "";
  const g = googleCalUrl(party);
  const mins = reminderSet(d.person.reminder_minutes);
  return `<div class="facts" style="margin-top:14px">
    <h2>📅 Add the party to your calendar</h2>
    <div class="countdown" style="margin-bottom:10px">🎃 ${esc(fmtDate(party.event_date))}${party.start_time ? " · " + esc(party.start_time) : ""}${party.location ? " · " + esc(party.location) : ""}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${g ? `<a class="btn primary" href="${g}" target="_blank" rel="noopener">Add to Google Calendar</a>` : ""}
      <a class="btn" href="/api/me/${esc(volCtx.token)}/calendar.ics">Download for Apple / Outlook</a>
    </div>
    <div style="font-size:12px;color:var(--muted);font-weight:600;margin-bottom:6px">Remind me <span style="font-weight:400">(applies to the downloaded calendar + your tasks)</span></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      ${REMIND_OPTS.map(([v, l]) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" data-remind="${v}" ${mins.includes(v) ? "checked" : ""} style="width:auto"/> ${l}</label>`).join("")}
    </div>
    <div style="margin-top:12px"><button class="btn ghost small" data-cal-issue>Calendar not working? Tell us →</button></div>
  </div>`;
}
function wireVolCalendar() {
  const host = $(".vol-wrap");
  if (!host) return;
  host.querySelectorAll("[data-remind]").forEach((c) => (c.onchange = async () => {
    const mins = [...host.querySelectorAll("[data-remind]:checked")].map((x) => x.dataset.remind).join(",");
    const r = await post(`/api/me/${volCtx.token}/reminders`, { minutes: mins });
    volCtx.data.person.reminder_minutes = r.reminder_minutes;
    toast("Reminder saved");
  }));
  const ci = host.querySelector("[data-cal-issue]"); if (ci) ci.onclick = () => openFeedback({ sentiment: "bug", text: "Calendar issue: " });
}
function mountVolDial() { const m = $("#volDialMount"); m.innerHTML = dialMarkup(volCtx.level, VOL_LEVELS, "volDial"); wireDial($("#volDial"), volCtx.level, 3, (l) => { volCtx.level = l; mountVolDial(); drawVol(); }); }
function drawVol() {
  const body = $("#volBody"); if (!body) return;
  const { token, data: d, level } = volCtx;
  const open = d.tasks.filter((t) => t.status !== "done");
  if (level === 2) {
    const t = open[0] || d.tasks[0];
    body.innerHTML = t ? `<div class="spotlight" style="margin-top:6px">${t.area_emoji ? `<span class="area-chip">${t.area_emoji} ${esc(t.area_name || "")}</span>` : ""}<h1>${esc(t.title)}</h1>${t.description ? `<p class="sdesc">${esc(t.description)}</p>` : ""}<div class="spot-status">${[["in_progress", "On it"], ["blocked", "Stuck"], ["done", "Done ✓"]].map(([s, l]) => `<button class="btn ${t.status === s ? "primary" : ""}" data-vs="${s}" data-id="${t.id}">${l}</button>`).join("")}</div><p class="spot-hint">${open.length > 1 ? `${open.length - 1} more after this — one at a time.` : "Last one. You've got it. 🎉"}</p></div>`
      : `<div class="empty">All done — you're a legend! 🎉</div>`;
    body.querySelectorAll("[data-vs]").forEach((b) => (b.onclick = async () => { await post(`/api/me/${token}/task/${b.dataset.id}`, { status: b.dataset.vs }); const x = d.tasks.find((t) => t.id == b.dataset.id); if (x) x.status = b.dataset.vs; toast("Thanks!"); drawVol(); }));
    return;
  }
  const tasks = level === 1 ? open : d.tasks;
  body.innerHTML = `<div class="section-title">✅ ${level === 1 ? "What's left" : "Your tasks"}</div>
    <div class="grid-wrap" style="padding:6px 14px">${tasks.length ? tasks.map((t) => volRow(t, token)).join("") : `<div class="empty">No tasks yet — you're all clear! 🎉</div>`}</div>
    ${level === 0 && d.supplies.length ? `<div class="section-title">🛒 Things to grab</div><div class="grid-wrap" style="padding:6px 14px">${d.supplies.map((s) => volSupply(s, token)).join("")}</div>` : ""}
    <p class="empty" style="font-size:13px">Something off, or want a different job? Tap 💬 Feedback.</p>`;
  wireVolRows();
}
function volRow(t, token) {
  const opts = { todo: "Not started", claimed: "I'll do it", in_progress: "In progress", blocked: "Blocked", done: "Done" };
  return `<div class="fbrow"><div class="fm"><div style="font-weight:600 ${t.status === "done" ? ";color:var(--faint);text-decoration:line-through" : ""}">${esc(t.title)}</div><div class="meta">${t.area_emoji ? `${t.area_emoji} ${esc(t.area_name || "")}` : ""}${t.due_date ? ` · 📅 ${fmtDate(t.due_date)}` : ""}${t.description ? `<br>${esc(t.description)}` : ""}</div></div>
    <select class="stsel st-${t.status}" data-vtask="${t.id}" data-token="${esc(token)}">${STATUSES.map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${opts[s]}</option>`).join("")}</select></div>`;
}
function volSupply(s, token) {
  const opts = { needed: "Still need it", claimed: "I've got it", purchased: "Bought ✓" };
  return `<div class="fbrow"><div class="fm"><div style="font-weight:600">${esc(s.item)}${s.quantity ? ` <span class="meta">(${esc(s.quantity)})</span>` : ""}</div><div class="meta">${s.area_emoji ? `${s.area_emoji} ${esc(s.area_name || "")}` : ""}${s.estimated_cost != null ? ` · ~$${esc(s.estimated_cost)}` : ""}</div></div>
    <select class="stsel" data-vsupply="${s.id}" data-token="${esc(token)}">${["needed", "claimed", "purchased"].map((o) => `<option value="${o}" ${o === s.status ? "selected" : ""}>${opts[o]}</option>`).join("")}</select></div>`;
}
function wireVolRows() {
  $("#volBody").querySelectorAll("[data-vtask]").forEach((s) => (s.onchange = async (e) => { await post(`/api/me/${s.dataset.token}/task/${s.dataset.vtask}`, { status: e.target.value }); const x = volCtx.data.tasks.find((t) => t.id == s.dataset.vtask); if (x) x.status = e.target.value; toast("Thanks!"); if (volCtx.level === 1) drawVol(); }));
  $("#volBody").querySelectorAll("[data-vsupply]").forEach((s) => (s.onchange = async (e) => { await post(`/api/me/${s.dataset.token}/supply/${s.dataset.vsupply}`, { status: e.target.value }); toast("Thanks!"); }));
}

/* ---------------- boot ---------------- */
fab.addEventListener("click", openFeedback);
window.addEventListener("popstate", route);
route();
