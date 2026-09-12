// PlanThatParty — Cloudflare Worker
// Serves a JSON API under /api/* and hands everything else to the static SPA.

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function err(message, status = 400) {
  return json({ error: message }, status);
}

// ---- helpers -------------------------------------------------------------

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function getParty(env) {
  return await env.DB.prepare("SELECT * FROM party WHERE id = 1").first();
}

// Admin write endpoints require the shared PIN (sent as X-Admin-Pin).
// If no PIN is configured on the party row, writes are open (dev convenience).
async function requireAdmin(request, env) {
  const party = await getParty(env);
  const pin = party && party.admin_pin;
  if (!pin) return null; // no gate configured
  const given = request.headers.get("x-admin-pin");
  if (given && given === pin) return null;
  return err("Wrong or missing admin PIN.", 401);
}

// Hosts and co-hosts always carry host-level (approver) permissions — the
// role grants it, so no one has to remember to tick a box.
const HOST_ROLES = ["host", "co-host"];
const hostRole = (role) => HOST_ROLES.includes(String(role || "").toLowerCase());

// Idea moderation is allowed for the admin PIN OR any approver's share token.
async function requireApprover(request, env) {
  const gate = await requireAdmin(request, env);
  if (!gate) return null;
  const tok = request.headers.get("x-approver-token");
  if (tok) {
    const p = await env.DB.prepare("SELECT is_approver, role FROM people WHERE share_token = ?").bind(tok).first();
    if (p && (p.is_approver || hostRole(p.role))) return null;
  }
  return gate;
}

// Boolean form of requireApprover — true when the request carries the admin
// PIN or a valid approver token.
async function isApprover(request, env) {
  return !(await requireApprover(request, env));
}

// Look up a person by their private share token.
async function personByToken(env, token) {
  if (!token) return null;
  return await env.DB.prepare("SELECT * FROM people WHERE share_token = ?")
    .bind(token)
    .first();
}

function newToken() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

// ---- calendar helpers ----------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");

// Best-effort parse of a free-text start_time ("8:00 PM – 3:00 AM", "7pm",
// "6:30 PM to 11 PM") into structured start/end for a given event_date.
// Falls back to an all-day event if it can't read a time.
// Party fields a host may choose to reveal to guests (nothing else is public).
const PUBLIC_FIELDS = ["name", "event_date", "start_time", "location", "theme", "headcount_target", "budget_target", "notes", "cal_details"];
function publicSet(party) {
  const raw = party && party.public_fields != null ? party.public_fields : "name,event_date,start_time";
  return new Set(String(raw).split(",").map((s) => s.trim()).filter(Boolean));
}

function parseEventTimes(party) {
  if (!party || !party.event_date) return null;
  const [y, mo, d] = party.event_date.split("-").map(Number);
  const nextDate = (addDay) => { const dt = new Date(Date.UTC(y, mo - 1, d + (addDay ? 1 : 0))); return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`; };
  const raw = (party.start_time || "").trim();
  const re = /(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/gi;
  const ms = [...raw.matchAll(re)].filter((m) => m[1]);
  const to24 = (h, min, ap) => { h = +h; min = min ? +min : 0; ap = (ap || "").toLowerCase(); if (ap[0] === "p" && h < 12) h += 12; if (ap[0] === "a" && h === 12) h = 0; return [h, min]; };
  if (ms.length >= 1) {
    const [sh, sm] = to24(ms[0][1], ms[0][2], ms[0][3]);
    let eh, em;
    if (ms.length >= 2) [eh, em] = to24(ms[1][1], ms[1][2], ms[1][3]);
    else { eh = (sh + 3) % 24; em = sm; }
    const startMin = sh * 60 + sm, endMin = eh * 60 + em;
    const nextDay = endMin <= startMin;
    return { allDay: false, start: `${nextDate(false)}T${pad(sh)}${pad(sm)}00`, end: `${nextDate(nextDay)}T${pad(eh)}${pad(em)}00` };
  }
  return { allDay: true, start: nextDate(false), end: nextDate(true) };
}

// Attach client-friendly calendar fields to a party object (non-destructive copy).
function partyClient(party) {
  if (!party) return party;
  const cal = parseEventTimes(party);
  return Object.assign({}, party, cal ? { calStart: cal.start, calEnd: cal.end, calAllDay: cal.allDay } : {});
}

function reminderList(csv) {
  return String(csv || "").split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n) && n >= 0);
}

const icsEsc = (s) => (s == null ? "" : String(s)).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

// The party is in Denver — pin timed events to Mountain time so the wall-clock
// is correct in everyone's calendar regardless of where they add it from.
const PARTY_TZ = "America/Denver";
const VTIMEZONE_DENVER = [
  "BEGIN:VTIMEZONE", "TZID:America/Denver",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0600", "TZNAME:MDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0700", "TZNAME:MST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

function icsEvent({ uid, cal, summary, description, location, alarms }) {
  if (!cal) return "";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const dtS = cal.allDay ? `DTSTART;VALUE=DATE:${cal.start}` : `DTSTART;TZID=${PARTY_TZ}:${cal.start}`;
  const dtE = cal.allDay ? `DTEND;VALUE=DATE:${cal.end}` : `DTEND;TZID=${PARTY_TZ}:${cal.end}`;
  const L = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, dtS, dtE, `SUMMARY:${icsEsc(summary)}`];
  if (location) L.push(`LOCATION:${icsEsc(location)}`);
  if (description) L.push(`DESCRIPTION:${icsEsc(description)}`);
  (alarms || []).forEach((min) => L.push("BEGIN:VALARM", `TRIGGER:-PT${min}M`, "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(summary)}`, "END:VALARM"));
  L.push("END:VEVENT");
  return L.join("\r\n");
}

function icsCalendar(events) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PlanThatParty//EN", "CALSCALE:GREGORIAN", VTIMEZONE_DENVER, ...events.filter(Boolean), "END:VCALENDAR"].join("\r\n");
}

function icsResponse(body, filename) {
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` } });
}

function partyEvent(party, alarms) {
  const cal = parseEventTimes(party);
  return icsEvent({ uid: "party-1@planthatparty", cal, summary: party.name || "Halloween Party", description: party.cal_details || party.notes || "", location: party.location || "", alarms });
}

// Accept a user-typed link. Add https:// if no scheme; only http(s) survive.
function normalizeUrl(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try { const u = new URL(s); return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null; }
  catch { return null; }
}

// Normalize tags to a clean, de-duped, lowercase CSV. Accepts a string or an
// array; returns null when empty.
function normalizeTags(raw) {
  if (raw == null) return null;
  const parts = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  const seen = [];
  for (const p of parts) if (!seen.includes(p)) seen.push(p);
  return seen.length ? seen.join(",") : null;
}

// Only allow known columns through for a table (guards against bad keys).
function pick(obj, allowed) {
  const out = {};
  for (const k of allowed) if (k in obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function updateRow(env, table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k]);
  await env.DB.prepare(`UPDATE ${table} SET ${set} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

// Create a notification row for each tagged host (best-effort; skips blanks).
async function addMentions(env, ids, kind, refId, actorName, text) {
  if (!Array.isArray(ids)) return;
  for (const pid of ids) {
    if (!pid) continue;
    await env.DB.prepare("INSERT INTO mentions (person_id, kind, ref_id, actor_name, text) VALUES (?,?,?,?,?)")
      .bind(pid, kind, refId, actorName || null, (text || "").slice(0, 400)).run();
  }
}

// ---- API routing ---------------------------------------------------------

// Parse a pasted / Notes-app guest list: one guest per line, name first,
// optional phone and/or email anywhere on the line. Tolerates bullets & numbering.
function parseGuestLines(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((raw) => {
    let line = raw.replace(/^\s*[-*•]\s*/, "").replace(/^\s*\d+[.)]\s*/, "");
    let email = null, phone = null;
    const em = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/); if (em) { email = em[0]; line = line.replace(em[0], " "); }
    const ph = line.match(/\+?\(?\d[\d\s().-]{6,}\d/); if (ph) { phone = ph[0].trim(); line = line.replace(ph[0], " "); }
    const name = line.split(/[,\t|]/)[0].replace(/\s+/g, " ").trim();
    return { name, phone: phone || null, email: email || null };
  }).filter((g) => g.name);
}

async function api(request, env, path) {
  const method = request.method;
  const seg = path.split("/").filter(Boolean); // e.g. ["api","people","3"]
  const resource = seg[1];
  const id = seg[2];

  // ---------- Volunteer self-serve view (token-gated, no PIN) ----------
  if (resource === "me") {
    const token = seg[2];
    const person = await personByToken(env, token);
    if (!person) return err("Unknown link.", 404);

    // GET /api/me/:token  -> that person's tasks + supplies + party info
    if (method === "GET" && !seg[3]) {
      const party = await getParty(env);
      const tasks = (
        await env.DB.prepare(
          `SELECT t.*, a.name AS area_name, a.emoji AS area_emoji
             FROM tasks t LEFT JOIN areas a ON a.id = t.area_id
            WHERE t.assignee_id = ? ORDER BY t.status, t.due_date`
        )
          .bind(person.id)
          .all()
      ).results;
      const supplies = (
        await env.DB.prepare(
          `SELECT s.*, a.name AS area_name, a.emoji AS area_emoji
             FROM supplies s LEFT JOIN areas a ON a.id = s.area_id
            WHERE s.assignee_id = ? ORDER BY s.status`
        )
          .bind(person.id)
          .all()
      ).results;
      const pc = partyClient(party);
      // Minimal roster (for @-tagging people from a comment) + this person's mentions.
      const people = (await env.DB.prepare("SELECT id, name, avatar FROM people ORDER BY name").all()).results;
      const mentions = (await env.DB.prepare("SELECT * FROM mentions WHERE person_id = ? ORDER BY seen, created_at DESC LIMIT 30").bind(person.id).all()).results;
      return json({
        person: { id: person.id, name: person.name, role: person.role, avatar: person.avatar || null, is_approver: (person.is_approver || hostRole(person.role)) ? 1 : 0, reminder_minutes: person.reminder_minutes || "" },
        party: party
          ? { name: pc.name, event_date: pc.event_date, start_time: pc.start_time, location: pc.location, notes: pc.notes, calStart: pc.calStart, calEnd: pc.calEnd, calAllDay: pc.calAllDay }
          : null,
        tasks,
        supplies,
        people,
        mentions,
      });
    }

    // POST /api/me/:token/mentions/seen — clear this volunteer's notification badge.
    if (method === "POST" && seg[3] === "mentions" && seg[4] === "seen") {
      await env.DB.prepare("UPDATE mentions SET seen = 1 WHERE person_id = ?").bind(person.id).run();
      return json({ ok: true });
    }

    // GET /api/me/:token/calendar.ics — the party + this person's due-dated tasks,
    // with their personal reminder alarms baked in.
    if (method === "GET" && seg[3] === "calendar.ics") {
      const party = await getParty(env);
      const alarms = reminderList(person.reminder_minutes || "");
      const events = [partyEvent(party, alarms)];
      const dueTasks = (await env.DB.prepare("SELECT * FROM tasks WHERE assignee_id = ? AND due_date IS NOT NULL AND status != 'done'").bind(person.id).all()).results;
      for (const t of dueTasks) {
        const [ty, tm, td] = t.due_date.split("-").map(Number);
        const nd = new Date(Date.UTC(ty, tm - 1, td + 1));
        events.push(icsEvent({ uid: `task-${t.id}@planthatparty`, cal: { allDay: true, start: `${ty}${pad(tm)}${pad(td)}`, end: `${nd.getUTCFullYear()}${pad(nd.getUTCMonth() + 1)}${pad(nd.getUTCDate())}` }, summary: `🎃 ${t.title}`, description: t.description || "", location: party.location || "", alarms }));
      }
      return icsResponse(icsCalendar(events), "my-halloween-tasks.ics");
    }

    // POST /api/me/:token/reminders { minutes: "1440,60" }
    if (method === "POST" && seg[3] === "reminders") {
      const { minutes } = await body(request);
      const clean = reminderList(minutes).join(",");
      await env.DB.prepare("UPDATE people SET reminder_minutes = ? WHERE id = ?").bind(clean, person.id).run();
      return json({ ok: true, reminder_minutes: clean });
    }

    // POST /api/me/:token/task/:tid  { status }
    if (method === "POST" && seg[3] === "task" && seg[4]) {
      const { status } = await body(request);
      const ok = ["todo", "claimed", "in_progress", "blocked", "done"];
      if (!ok.includes(status)) return err("Bad status.");
      await env.DB.prepare(
        "UPDATE tasks SET status = ? WHERE id = ? AND assignee_id = ?"
      )
        .bind(status, seg[4], person.id)
        .run();
      return json({ ok: true });
    }

    // POST /api/me/:token/supply/:sid  { status }
    if (method === "POST" && seg[3] === "supply" && seg[4]) {
      const { status } = await body(request);
      const ok = ["needed", "claimed", "purchased"];
      if (!ok.includes(status)) return err("Bad status.");
      await env.DB.prepare(
        "UPDATE supplies SET status = ? WHERE id = ? AND assignee_id = ?"
      )
        .bind(status, seg[4], person.id)
        .run();
      return json({ ok: true });
    }
    return err("Not found.", 404);
  }

  // ---------- Public (guest) info — open to everyone, minimal ----------
  // Guest-safe calendar: honors the host's public-fields whitelist.
  if (resource === "public" && id === "party.ics") {
    const party = await getParty(env);
    const pub = publicSet(party);
    if (!party || !party.event_date || !pub.has("event_date")) return err("No public date yet.", 404);
    const ev = icsEvent({
      uid: "party-1@planthatparty",
      cal: pub.has("start_time") ? parseEventTimes(party) : parseEventTimes({ event_date: party.event_date }),
      summary: pub.has("name") ? (party.name || "Halloween Party") : "Halloween Party",
      location: pub.has("location") ? (party.location || "") : "",
      description: pub.has("cal_details") ? (party.cal_details || "") : "",
    });
    return icsResponse(icsCalendar([ev]), "halloween-party.ics");
  }
  if (resource === "public" && method === "GET") {
    const party = await getParty(env);
    // Guests get ONLY the fields the hosts have marked public.
    const pub = publicSet(party);
    const out = {};
    for (const f of PUBLIC_FIELDS) out[f] = party && pub.has(f) ? party[f] : null;
    if (party && pub.has("event_date")) {
      // Only expose the wall-clock time when start_time is also public;
      // otherwise hand back an all-day (date-only) calendar entry.
      const cal = pub.has("start_time") ? parseEventTimes(party) : parseEventTimes({ event_date: party.event_date });
      if (cal) { out.calStart = cal.start; out.calEnd = cal.end; out.calAllDay = cal.allDay; }
    }
    return json(out);
  }

  // ---------- Public party calendar (.ics), open to everyone ----------
  if (resource === "calendar") {
    const party = await getParty(env);
    if (!party) return err("No party yet.", 404);
    const url = new URL(request.url);
    const alarms = reminderList(url.searchParams.get("remind"));
    return icsResponse(icsCalendar([partyEvent(party, alarms)]), "halloween-party.ics");
  }

  // ---------- Feedback (open to everyone — the whole point) ----------
  if (resource === "feedback") {
    if (method === "POST" && !id) {
      const b = await body(request);
      if (!b.message || !b.message.trim()) return err("Say something first 🙂");
      await env.DB.prepare(
        "INSERT INTO feedback (page, target, person_id, author_name, message, sentiment) VALUES (?,?,?,?,?,?)"
      )
        .bind(b.page || null, b.target || null, b.person_id || null, b.author_name || null, b.message.trim(), b.sentiment || null)
        .run();
      return json({ ok: true }, 201);
    }
    // reading & triaging feedback is admin-only
    const gate = await requireAdmin(request, env);
    if (gate) return gate;
    if (method === "GET") {
      const rows = (
        await env.DB.prepare(
          `SELECT f.*, p.name AS person_name FROM feedback f
             LEFT JOIN people p ON p.id = f.person_id ORDER BY f.created_at DESC`
        ).all()
      ).results;
      return json(rows);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      await updateRow(env, "feedback", id, pick(b, ["status"]));
      return json({ ok: true });
    }
  }

  // ---------- Ideas pipeline (open capture, admin moderation) ----------
  if (resource === "ideas") {
    if (method === "GET" && !id) {
      // Host-only ideas are hidden unless the requester is an admin/approver.
      const authed = await isApprover(request, env);
      const rows = (await env.DB.prepare(
        `SELECT i.*, a.name AS area_name, a.emoji AS area_emoji, z.name AS zone_name, p.name AS submitter_person_name,
           (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id) AS votes,
           (SELECT COUNT(*) FROM idea_comments c WHERE c.idea_id = i.id) AS comments,
           (SELECT COUNT(*) FROM idea_images im WHERE im.idea_id = i.id) AS images
         FROM ideas i LEFT JOIN areas a ON a.id = i.area_id LEFT JOIN zones z ON z.id = i.zone_id LEFT JOIN people p ON p.id = i.submitter_person_id
         ${authed ? "" : "WHERE i.admin_only = 0"}
         ORDER BY i.created_at DESC`
      ).all()).results;
      return json(rows);
    }
    if (method === "GET" && id && seg[3] === "comments") {
      const rows = (await env.DB.prepare(
        `SELECT c.*, p.name AS person_name FROM idea_comments c LEFT JOIN people p ON p.id = c.author_person_id WHERE c.idea_id = ? ORDER BY c.created_at`
      ).bind(id).all()).results;
      return json(rows);
    }
    if (method === "GET" && id && seg[3] === "images") {
      const rows = (await env.DB.prepare("SELECT id, data FROM idea_images WHERE idea_id = ? ORDER BY id").bind(id).all()).results;
      return json(rows);
    }
    if (method === "POST" && !id) {
      const b = await body(request);
      // A title is optional as long as there's something else — a note, a
      // link, or a photo. Blank titles fall back to a friendly placeholder.
      const title = (b.title || "").trim();
      const hasPhoto = (Array.isArray(b.images) && b.images.length) || b.thumb;
      const link = normalizeUrl(b.link);
      if (!title && !(b.description && b.description.trim()) && !link && !hasPhoto) return err("Add a photo, a link, or a note.");
      const finalTitle = title || (hasPhoto ? "Photo idea" : link ? "Shared link" : "Untitled idea");
      // Only an admin/approver may file an idea as host-only.
      const adminOnly = b.admin_only && (await isApprover(request, env)) ? 1 : 0;
      // Idempotency: a repeated submit carries the same client_token, so a
      // double-tap / retry returns the first idea instead of creating a second.
      const token = b.client_token || null;
      if (token) { const dup = await env.DB.prepare("SELECT id FROM ideas WHERE client_token = ?").bind(token).first(); if (dup) return json({ id: dup.id, duplicate: true }); }
      let ideaId;
      try {
        const r = await env.DB.prepare(
          `INSERT INTO ideas (title, description, link, submitter_name, submitter_person_id, area_id, zone_id, category, thumb, admin_only, tags, client_token) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(finalTitle, b.description || null, link, b.submitter_name || null, b.submitter_person_id || null, b.area_id || null, b.zone_id || null, b.category || null, b.thumb || null, adminOnly, normalizeTags(b.tags), token).run();
        ideaId = r.meta.last_row_id;
      } catch (e) {
        // Concurrent double-submit lost the race to the unique index — return the winner.
        if (token && /UNIQUE|constraint/i.test(String(e && e.message))) { const dup = await env.DB.prepare("SELECT id FROM ideas WHERE client_token = ?").bind(token).first(); if (dup) return json({ id: dup.id, duplicate: true }); }
        throw e;
      }
      if (Array.isArray(b.images)) { for (const img of b.images.slice(0, 6)) { if (typeof img === "string" && img.length < 900000) await env.DB.prepare("INSERT INTO idea_images (idea_id, data) VALUES (?,?)").bind(ideaId, img).run(); } }
      return json({ id: ideaId }, 201);
    }
    if (method === "POST" && id && seg[3] === "vote") {
      const { voter_key } = await body(request);
      if (!voter_key) return err("Missing voter key.");
      const existing = await env.DB.prepare("SELECT id FROM idea_votes WHERE idea_id = ? AND voter_key = ?").bind(id, voter_key).first();
      if (existing) await env.DB.prepare("DELETE FROM idea_votes WHERE id = ?").bind(existing.id).run();
      else await env.DB.prepare("INSERT OR IGNORE INTO idea_votes (idea_id, voter_key) VALUES (?,?)").bind(id, voter_key).run();
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM idea_votes WHERE idea_id = ?").bind(id).first();
      return json({ voted: !existing, votes: c ? c.n : 0 });
    }
    if (method === "POST" && id && seg[3] === "comment") {
      const b = await body(request);
      if (!b.body || !b.body.trim()) return err("Say something.");
      await env.DB.prepare("INSERT INTO idea_comments (idea_id, author_name, author_person_id, body) VALUES (?,?,?,?)").bind(id, b.author_name || null, b.author_person_id || null, b.body.trim()).run();
      await addMentions(env, b.mention_ids, "idea_comment", id, b.author_name, b.body.trim());
      return json({ ok: true }, 201);
    }
    // moderation: admin PIN or an approver's token
    const gate = await requireApprover(request, env);
    if (gate) return gate;
    if (method === "PATCH" && id) {
      const b = await body(request);
      if ("link" in b) b.link = normalizeUrl(b.link);
      if ("admin_only" in b) b.admin_only = b.admin_only ? 1 : 0;
      if ("tags" in b) b.tags = normalizeTags(b.tags);
      await updateRow(env, "ideas", id, pick(b, ["title", "description", "link", "area_id", "zone_id", "category", "stage", "impact", "effort", "decision_note", "admin_only", "tags"]));
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM idea_votes WHERE idea_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM idea_comments WHERE idea_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM idea_images WHERE idea_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM ideas WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    if (method === "POST" && id && seg[3] === "promote") {
      const idea = await env.DB.prepare("SELECT * FROM ideas WHERE id = ?").bind(id).first();
      if (!idea) return err("No such idea.", 404);
      const b = await body(request);
      const r = await env.DB.prepare(
        `INSERT INTO tasks (area_id, title, description, status, priority, due_date, assignee_id) VALUES (?,?,?,?,?,?,?)`
      ).bind(b.area_id || idea.area_id || null, idea.title, idea.description || null, "todo", b.priority || "normal", b.due_date || null, b.assignee_id || null).run();
      const taskId = r.meta.last_row_id;
      await env.DB.prepare("UPDATE ideas SET stage = 'promoted', promoted_task_id = ? WHERE id = ?").bind(taskId, id).run();
      return json({ ok: true, task_id: taskId });
    }
  }

  // ---------- Everything below is the admin surface ----------
  // Reads are open; writes need the PIN.
  const isWrite = method !== "GET";
  if (isWrite) {
    const gate = await requireAdmin(request, env);
    if (gate) return gate;
  }

  // ---------- mentions (host notifications — host-only) ----------
  if (resource === "mentions") {
    // GET /api/mentions/:personId — that host's notifications, unseen first.
    if (method === "GET" && id) {
      const rows = (await env.DB.prepare("SELECT * FROM mentions WHERE person_id = ? ORDER BY seen, created_at DESC LIMIT 50").bind(id).all()).results;
      return json(rows);
    }
    // POST /api/mentions/:personId/seen — clear the badge for that host.
    if (method === "POST" && id && seg[3] === "seen") {
      await env.DB.prepare("UPDATE mentions SET seen = 1 WHERE person_id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // Full dashboard snapshot
  if (resource === "state" && method === "GET") {
    // Host-only: the full plan (tasks, people, everything) requires the admin PIN.
    const gate = await requireAdmin(request, env);
    if (gate) return gate;
    const [party, areas, people, tasks, supplies, fb, ni, gu, cl, zn, ev, inv] = await Promise.all([
      getParty(env),
      env.DB.prepare("SELECT * FROM areas ORDER BY sort_order, id").all(),
      env.DB.prepare("SELECT * FROM people ORDER BY name").all(),
      env.DB
        .prepare(
          `SELECT t.*, a.name AS area_name, a.emoji AS area_emoji, p.name AS assignee_name
             FROM tasks t LEFT JOIN areas a ON a.id = t.area_id
             LEFT JOIN people p ON p.id = t.assignee_id
            ORDER BY a.sort_order, t.id`
        )
        .all(),
      env.DB
        .prepare(
          `SELECT s.*, a.name AS area_name, a.emoji AS area_emoji, p.name AS assignee_name
             FROM supplies s LEFT JOIN areas a ON a.id = s.area_id
             LEFT JOIN people p ON p.id = s.assignee_id
            ORDER BY a.sort_order, s.id`
        )
        .all(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'").first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM ideas WHERE stage = 'submitted'").first(),
      env.DB.prepare("SELECT g.*, p.name AS invited_by_name FROM guests g LEFT JOIN people p ON p.id = g.invited_by_person_id ORDER BY g.created_at DESC").all(),
      env.DB.prepare("SELECT * FROM checklist ORDER BY sort_order, id").all(),
      env.DB.prepare("SELECT * FROM zones ORDER BY sort_order, id").all(),
      env.DB.prepare("SELECT * FROM events ORDER BY (event_date IS NULL), event_date, start_time, sort_order, id").all(),
      env.DB.prepare(`SELECT i.*, p.name AS holder_person_name, a.name AS area_name, a.emoji AS area_emoji FROM inventory i LEFT JOIN people p ON p.id = i.holder_person_id LEFT JOIN areas a ON a.id = i.area_id ORDER BY i.created_at DESC`).all(),
    ]);
    return json({
      party: partyClient(party),
      pinConfigured: !!(party && party.admin_pin),
      areas: areas.results,
      people: people.results,
      tasks: tasks.results,
      supplies: supplies.results,
      guests: gu.results,
      checklist: cl.results,
      zones: zn.results,
      events: ev.results,
      inventory: inv.results,
      newFeedback: fb ? fb.n : 0,
      newIdeas: ni ? ni.n : 0,
    });
  }

  // ---------- party ----------
  if (resource === "party" && method === "PATCH") {
    const b = await body(request);
    await updateRow(env, "party", 1, pick(b, ["name", "event_date", "start_time", "location", "theme", "headcount_target", "budget_target", "notes", "cal_details", "public_fields", "theme_concept", "theme_mood", "theme_inspiration", "message_group", "admin_pin"]));
    return json({ ok: true });
  }

  // ---------- checklist (private, host-only) ----------
  if (resource === "checklist") {
    if (method === "GET") {
      const gate = await requireAdmin(request, env);
      if (gate) return gate;
      const rows = (await env.DB.prepare("SELECT * FROM checklist ORDER BY sort_order, id").all()).results;
      return json(rows);
    }
    if (method === "POST") {
      const b = await body(request);
      if (!b.label || !b.label.trim()) return err("Item text required.");
      const r = await env.DB.prepare(
        "INSERT INTO checklist (section, label, note, done, sort_order) VALUES (?,?,?,?,?)"
      ).bind(b.section || null, b.label.trim(), b.note || null, b.done ? 1 : 0, b.sort_order || 0).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      if ("done" in b) b.done = b.done ? 1 : 0;
      await updateRow(env, "checklist", id, pick(b, ["section", "label", "note", "done", "sort_order"]));
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM checklist WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- zones (decor concept per house area — host-only) ----------
  if (resource === "zones") {
    const gate = await requireAdmin(request, env);
    if (gate) return gate;
    // GET /api/zones/photos — ideas tagged to a zone that carry a photo, for the
    // per-zone photo collection on the Theme & Zones page.
    if (method === "GET" && id === "photos") {
      const rows = (await env.DB.prepare(
        `SELECT i.id AS idea_id, i.zone_id, i.title, i.thumb,
           (SELECT COUNT(*) FROM idea_images im WHERE im.idea_id = i.id) AS images
         FROM ideas i
         WHERE i.zone_id IS NOT NULL AND (i.thumb IS NOT NULL OR EXISTS (SELECT 1 FROM idea_images im WHERE im.idea_id = i.id))
         ORDER BY i.created_at DESC`
      ).all()).results;
      return json(rows);
    }
    if (method === "POST") {
      const b = await body(request);
      if (!b.name || !b.name.trim()) return err("Zone name required.");
      const r = await env.DB.prepare(
        "INSERT INTO zones (name, vibe, decor, sort_order) VALUES (?,?,?,?)"
      ).bind(b.name.trim(), b.vibe || null, b.decor || null, b.sort_order || 0).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      await updateRow(env, "zones", id, pick(b, ["name", "vibe", "decor", "sort_order"]));
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM zones WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- events (movie night, setup days, day-of, tear-down — host-only) ----------
  if (resource === "events") {
    const gate = await requireAdmin(request, env);
    if (gate) return gate;
    const EV_FIELDS = ["title", "kind", "event_date", "start_time", "end_time", "location", "notes", "sort_order"];
    if (method === "GET") {
      const rows = (await env.DB.prepare("SELECT * FROM events ORDER BY (event_date IS NULL), event_date, start_time, sort_order, id").all()).results;
      return json(rows);
    }
    if (method === "POST") {
      const b = await body(request);
      // Bulk seed of the starter timeline (POST /api/events { seed: [ {...}, ... ] }).
      if (Array.isArray(b.seed)) {
        let n = 0;
        for (const e of b.seed) { if (e && e.title) { await env.DB.prepare("INSERT INTO events (title, kind, event_date, start_time, end_time, location, notes, sort_order) VALUES (?,?,?,?,?,?,?,?)").bind(e.title, e.kind || null, e.event_date || null, e.start_time || null, e.end_time || null, e.location || null, e.notes || null, e.sort_order || n).run(); n++; } }
        return json({ ok: true, added: n }, 201);
      }
      if (!b.title || !b.title.trim()) return err("Event name required.");
      const r = await env.DB.prepare(
        "INSERT INTO events (title, kind, event_date, start_time, end_time, location, notes, sort_order) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(b.title.trim(), b.kind || null, b.event_date || null, b.start_time || null, b.end_time || null, b.location || null, b.notes || null, b.sort_order || 0).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      await updateRow(env, "events", id, pick(b, EV_FIELDS));
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- floor plans (uploaded images — host-only) ----------
  if (resource === "floorplans") {
    const gate = await requireAdmin(request, env);
    if (gate) return gate;
    if (method === "GET") {
      const rows = (await env.DB.prepare("SELECT * FROM floorplans ORDER BY sort_order, id").all()).results;
      return json(rows);
    }
    if (method === "POST") {
      const b = await body(request);
      if (!b.data || typeof b.data !== "string") return err("Image required.");
      if (b.data.length > 1500000) return err("Image too large.");
      const r = await env.DB.prepare(
        "INSERT INTO floorplans (name, data, sort_order) VALUES (?,?,?)"
      ).bind(b.name || null, b.data, b.sort_order || 0).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM floorplans WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- guests (private, host-only) ----------
  if (resource === "guests") {
    // Bulk export as plain text (name, phone, email) — for copy-out & the Shortcut pull.
    if (id === "export" && method === "GET") {
      const gate = await requireAdmin(request, env);
      if (gate) return gate;
      const rows = (await env.DB.prepare("SELECT name, phone, email FROM guests ORDER BY lower(name)").all()).results;
      const text = rows.map((r) => [r.name, r.phone, r.email].filter(Boolean).join(", ")).join("\n");
      return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    // Bulk import: accepts JSON {guests:[{name,phone,email}], invited_by_person_id|invited_by_name|by}
    // OR a raw text list (Notes / paste). Upserts by name — never duplicates, only fills gaps.
    if (id === "import" && method === "POST") {
      const gate = await requireAdmin(request, env);
      if (gate) return gate;
      const raw = await request.text();
      const url = new URL(request.url);
      let items = [], byField = url.searchParams.get("by"), status = "invited";
      try {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) items = j;
        else if (j && Array.isArray(j.guests)) items = j.guests;
        else if (j && typeof j.text === "string") items = parseGuestLines(j.text);
        else items = parseGuestLines(raw);
        if (j && !Array.isArray(j)) { byField = j.invited_by_person_id || j.invited_by_name || j.by || byField; if (j.status) status = j.status; }
      } catch { items = parseGuestLines(raw); }
      // resolve "who invited" to a person id (accepts an id or a name)
      let byId = null;
      if (byField != null && String(byField).trim() !== "") {
        if (/^\d+$/.test(String(byField))) byId = Number(byField);
        else { const pr = await env.DB.prepare("SELECT id FROM people WHERE lower(name)=lower(?) LIMIT 1").bind(String(byField).trim()).first(); byId = pr ? pr.id : null; }
      }
      const existing = (await env.DB.prepare("SELECT id, lower(trim(name)) AS k, phone, email, invited_by_person_id FROM guests").all()).results;
      const byName = new Map(existing.map((r) => [r.k, r]));
      let added = 0, updated = 0;
      for (const it of items) {
        const name = (it.name || "").trim(); if (!name) continue;
        const key = name.toLowerCase();
        const phone = it.phone ? String(it.phone).trim() : null;
        const email = it.email ? String(it.email).trim() : null;
        const ex = byName.get(key);
        if (ex) {
          const sets = [], binds = [];
          if (phone && !ex.phone) { sets.push("phone=?"); binds.push(phone); }
          if (email && !ex.email) { sets.push("email=?"); binds.push(email); }
          if (byId && !ex.invited_by_person_id) { sets.push("invited_by_person_id=?"); binds.push(byId); }
          if (sets.length) { binds.push(ex.id); await env.DB.prepare(`UPDATE guests SET ${sets.join(",")} WHERE id=?`).bind(...binds).run(); updated++; }
        } else {
          await env.DB.prepare("INSERT INTO guests (name, status, plus_count, phone, email, invited_by_person_id) VALUES (?,?,?,?,?,?)").bind(name, status, 0, phone, email, byId).run();
          byName.set(key, { id: -1, k: key, phone, email, invited_by_person_id: byId });
          added++;
        }
      }
      return json({ added, updated, total: items.length });
    }
    if (method === "GET") {
      const gate = await requireAdmin(request, env);
      if (gate) return gate;
      const rows = (await env.DB.prepare("SELECT g.*, p.name AS invited_by_name FROM guests g LEFT JOIN people p ON p.id = g.invited_by_person_id ORDER BY g.created_at DESC").all()).results;
      return json(rows);
    }
    if (method === "POST") {
      const b = await body(request);
      if (!b.name || !b.name.trim()) return err("Name required.");
      const r = await env.DB.prepare(
        "INSERT INTO guests (name, status, plus_count, contact, phone, email, notes, invited_by_person_id, confirmed) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(b.name.trim(), b.status || "invited", b.plus_count ? Number(b.plus_count) : 0, b.contact || null, b.phone || null, b.email || null, b.notes || null, b.invited_by_person_id || null, b.confirmed ? 1 : 0).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      if ("plus_count" in b) b.plus_count = b.plus_count ? Number(b.plus_count) : 0;
      if ("confirmed" in b) b.confirmed = b.confirmed ? 1 : 0;
      await updateRow(env, "guests", id, pick(b, ["name", "status", "plus_count", "contact", "phone", "email", "notes", "invited_by_person_id", "confirmed"]));
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM guests WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- areas ----------
  if (resource === "areas") {
    if (method === "POST") {
      const b = await body(request);
      if (!b.name) return err("Name required.");
      const r = await env.DB.prepare(
        "INSERT INTO areas (name, emoji, description, sort_order) VALUES (?,?,?,?)"
      )
        .bind(b.name, b.emoji || "📌", b.description || null, b.sort_order || 99)
        .run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      await updateRow(env, "areas", id, pick(b, ["name", "emoji", "description", "sort_order"]));
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM areas WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- people ----------
  if (resource === "people") {
    if (method === "POST") {
      const b = await body(request);
      if (!b.name) return err("Name required.");
      // Idempotency: a repeated submit (double-tap / retry) carries the same
      // client_token and returns the first person instead of adding a twin.
      const ct = b.client_token || null;
      if (ct) { const dup = await env.DB.prepare("SELECT id, share_token FROM people WHERE client_token = ?").bind(ct).first(); if (dup) return json({ id: dup.id, share_token: dup.share_token, duplicate: true }); }
      const token = newToken();
      const role = b.role || "volunteer";
      try {
        const r = await env.DB.prepare(
          `INSERT INTO people (name, email, phone, preferred_channel, platform, channel_notes, notes, avatar, role, is_approver, share_token, client_token)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            b.name,
            b.email || null,
            b.phone || null,
            b.preferred_channel || "email",
            b.platform || null,
            b.channel_notes || null,
            b.notes || null,
            b.avatar || null,
            role,
            hostRole(role) || b.is_approver ? 1 : 0,
            token,
            ct
          )
          .run();
        return json({ id: r.meta.last_row_id, share_token: token }, 201);
      } catch (e) {
        if (ct && /UNIQUE|constraint/i.test(String(e && e.message))) { const dup = await env.DB.prepare("SELECT id, share_token FROM people WHERE client_token = ?").bind(ct).first(); if (dup) return json({ id: dup.id, share_token: dup.share_token, duplicate: true }); }
        throw e;
      }
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      // A host/co-host is always an approver — the role implies it.
      if ("role" in b && hostRole(b.role)) b.is_approver = 1;
      await updateRow(
        env,
        "people",
        id,
        pick(b, ["name", "email", "phone", "preferred_channel", "platform", "channel_notes", "notes", "avatar", "intake", "role", "is_approver", "reminder_minutes"])
      );
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM people WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- tasks ----------
  const FACT_FIELDS = ["event_date", "start_time", "location", "theme", "headcount_target", "budget_target"];
  if (resource === "tasks") {
    // POST /api/tasks/:id/fulfill { value } — atomically write the linked
    // party fact AND complete the task, so finishing the work updates the
    // single source of truth everywhere at once.
    if (method === "POST" && id && seg[3] === "fulfill") {
      const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
      if (!task) return err("No such task.", 404);
      if (!FACT_FIELDS.includes(task.links_field)) return err("This task isn't linked to a fact.");
      const { value } = await body(request);
      const v = value === "" ? null : value;
      await env.DB.prepare(`UPDATE party SET ${task.links_field} = ? WHERE id = 1`).bind(v).run();
      await env.DB.prepare("UPDATE tasks SET status = 'done', percent = 100 WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    // ----- task comments -----
    if (method === "GET" && id && seg[3] === "comments") {
      const rows = (await env.DB.prepare(
        `SELECT c.*, p.name AS person_name FROM task_comments c LEFT JOIN people p ON p.id = c.author_person_id WHERE c.task_id = ? ORDER BY c.created_at`
      ).bind(id).all()).results;
      return json(rows);
    }
    if (method === "POST" && id && seg[3] === "comment") {
      const b = await body(request);
      if (!b.body || !b.body.trim()) return err("Say something.");
      const r = await env.DB.prepare("INSERT INTO task_comments (task_id, author_name, author_person_id, body) VALUES (?,?,?,?)").bind(id, b.author_name || null, b.author_person_id || null, b.body.trim()).run();
      await addMentions(env, b.mention_ids, "task_comment", id, b.author_name, b.body.trim());
      return json({ id: r.meta.last_row_id }, 201);
    }
    // ----- task attachments (photos, PDFs, links) -----
    if (method === "GET" && id && seg[3] === "attachments") {
      const rows = (await env.DB.prepare("SELECT id, task_id, name, mime, url, data, created_at FROM task_attachments WHERE task_id = ? ORDER BY id").bind(id).all()).results;
      return json(rows);
    }
    if (method === "POST" && id && seg[3] === "attachment") {
      const b = await body(request);
      const url = b.url ? normalizeUrl(b.url) : null;
      const data = (typeof b.data === "string" && b.data) ? b.data : null;
      if (!url && !data) return err("Add a file or a link.");
      if (data && data.length > 1500000) return err("File too large (max ~1.5 MB).");
      const r = await env.DB.prepare("INSERT INTO task_attachments (task_id, name, mime, url, data) VALUES (?,?,?,?,?)").bind(id, b.name || null, b.mime || null, url, data).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "DELETE" && id && seg[3] === "attachment" && seg[4]) {
      await env.DB.prepare("DELETE FROM task_attachments WHERE id = ? AND task_id = ?").bind(seg[4], id).run();
      return json({ ok: true });
    }
    if (method === "POST") {
      const b = await body(request);
      if (!b.title) return err("Title required.");
      const r = await env.DB.prepare(
        `INSERT INTO tasks (area_id, parent_id, title, description, status, priority, due_date, percent, links_field, assignee_id, tags)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          b.area_id || null,
          b.parent_id || null,
          b.title,
          b.description || null,
          b.status || "todo",
          b.priority || "normal",
          b.due_date || null,
          b.percent || 0,
          b.links_field || null,
          b.assignee_id || null,
          normalizeTags(b.tags)
        )
        .run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      if ("tags" in b) b.tags = normalizeTags(b.tags);
      await updateRow(
        env,
        "tasks",
        id,
        pick(b, ["area_id", "parent_id", "title", "description", "status", "priority", "due_date", "percent", "links_field", "assignee_id", "tags"])
      );
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE id = ? OR parent_id = ?)").bind(id, id).run();
      await env.DB.prepare("DELETE FROM task_attachments WHERE task_id IN (SELECT id FROM tasks WHERE id = ? OR parent_id = ?)").bind(id, id).run();
      await env.DB.prepare("DELETE FROM tasks WHERE parent_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- supplies ----------
  if (resource === "supplies") {
    if (method === "POST") {
      const b = await body(request);
      if (!b.item) return err("Item required.");
      const r = await env.DB.prepare(
        `INSERT INTO supplies (area_id, item, quantity, estimated_cost, status, assignee_id, notes, link)
         VALUES (?,?,?,?,?,?,?,?)`
      )
        .bind(
          b.area_id || null,
          b.item,
          b.quantity || null,
          b.estimated_cost != null ? b.estimated_cost : null,
          b.status || "needed",
          b.assignee_id || null,
          b.notes || null,
          b.link ? normalizeUrl(b.link) : null
        )
        .run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      if ("link" in b) b.link = b.link ? normalizeUrl(b.link) : null;
      await updateRow(
        env,
        "supplies",
        id,
        pick(b, ["area_id", "item", "quantity", "estimated_cost", "status", "assignee_id", "notes", "link"])
      );
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM supplies WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- inventory (things we already have / can access — host-only) ----------
  if (resource === "inventory") {
    const INV = ["item", "category", "quantity", "status", "holder_person_id", "holder_name", "area_id", "link", "notes"];
    if (method === "POST") {
      const b = await body(request);
      if (!b.item || !b.item.trim()) return err("Item required.");
      const r = await env.DB.prepare(
        `INSERT INTO inventory (item, category, quantity, status, holder_person_id, holder_name, area_id, link, notes)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(
        b.item.trim(), b.category || null, b.quantity || null, b.status || "have",
        b.holder_person_id || null, b.holder_name || null, b.area_id || null,
        b.link ? normalizeUrl(b.link) : null, b.notes || null
      ).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      if ("link" in b) b.link = b.link ? normalizeUrl(b.link) : null;
      await updateRow(env, "inventory", id, pick(b, INV));
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM inventory WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  return err("Not found.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url.pathname);
      } catch (e) {
        return err("Server error: " + (e && e.message), 500);
      }
    }
    // Static SPA (with SPA fallback configured in wrangler.toml).
    const res = await env.ASSETS.fetch(request);
    // Force the HTML document and the app's JS/CSS to revalidate on every
    // load (cheap 304s via ETag). Without this, phones keep serving a cached
    // app.js/styles.css after a deploy and appear "stuck" on the old version.
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html") || url.pathname.endsWith("app.js") || url.pathname.endsWith("styles.css")) {
      const r = new Response(res.body, res);
      r.headers.set("Cache-Control", "no-cache, must-revalidate");
      return r;
    }
    return res;
  },
};
