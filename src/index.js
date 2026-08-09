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

// Idea moderation is allowed for the admin PIN OR any approver's share token.
async function requireApprover(request, env) {
  const gate = await requireAdmin(request, env);
  if (!gate) return null;
  const tok = request.headers.get("x-approver-token");
  if (tok) {
    const p = await env.DB.prepare("SELECT is_approver FROM people WHERE share_token = ?").bind(tok).first();
    if (p && p.is_approver) return null;
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

// ---- API routing ---------------------------------------------------------

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
      return json({
        person: { id: person.id, name: person.name, role: person.role, is_approver: person.is_approver || 0, reminder_minutes: person.reminder_minutes || "" },
        party: party
          ? { name: pc.name, event_date: pc.event_date, start_time: pc.start_time, location: pc.location, notes: pc.notes, calStart: pc.calStart, calEnd: pc.calEnd, calAllDay: pc.calAllDay }
          : null,
        tasks,
        supplies,
      });
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
        `SELECT i.*, a.name AS area_name, a.emoji AS area_emoji, p.name AS submitter_person_name,
           (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id) AS votes,
           (SELECT COUNT(*) FROM idea_comments c WHERE c.idea_id = i.id) AS comments,
           (SELECT COUNT(*) FROM idea_images im WHERE im.idea_id = i.id) AS images
         FROM ideas i LEFT JOIN areas a ON a.id = i.area_id LEFT JOIN people p ON p.id = i.submitter_person_id
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
      const r = await env.DB.prepare(
        `INSERT INTO ideas (title, description, link, submitter_name, submitter_person_id, area_id, category, thumb, admin_only) VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(finalTitle, b.description || null, link, b.submitter_name || null, b.submitter_person_id || null, b.area_id || null, b.category || null, b.thumb || null, adminOnly).run();
      const ideaId = r.meta.last_row_id;
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
      return json({ ok: true }, 201);
    }
    // moderation: admin PIN or an approver's token
    const gate = await requireApprover(request, env);
    if (gate) return gate;
    if (method === "PATCH" && id) {
      const b = await body(request);
      if ("link" in b) b.link = normalizeUrl(b.link);
      if ("admin_only" in b) b.admin_only = b.admin_only ? 1 : 0;
      await updateRow(env, "ideas", id, pick(b, ["title", "description", "link", "area_id", "category", "stage", "impact", "effort", "decision_note", "admin_only"]));
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

  // Full dashboard snapshot
  if (resource === "state" && method === "GET") {
    // Host-only: the full plan (tasks, people, everything) requires the admin PIN.
    const gate = await requireAdmin(request, env);
    if (gate) return gate;
    const [party, areas, people, tasks, supplies, fb, ni] = await Promise.all([
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
    ]);
    return json({
      party: partyClient(party),
      pinConfigured: !!(party && party.admin_pin),
      areas: areas.results,
      people: people.results,
      tasks: tasks.results,
      supplies: supplies.results,
      newFeedback: fb ? fb.n : 0,
      newIdeas: ni ? ni.n : 0,
    });
  }

  // ---------- party ----------
  if (resource === "party" && method === "PATCH") {
    const b = await body(request);
    await updateRow(env, "party", 1, pick(b, ["name", "event_date", "start_time", "location", "theme", "headcount_target", "budget_target", "notes", "cal_details", "public_fields", "admin_pin"]));
    return json({ ok: true });
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
      const token = newToken();
      const r = await env.DB.prepare(
        `INSERT INTO people (name, email, phone, preferred_channel, platform, channel_notes, role, share_token)
         VALUES (?,?,?,?,?,?,?,?)`
      )
        .bind(
          b.name,
          b.email || null,
          b.phone || null,
          b.preferred_channel || "email",
          b.platform || null,
          b.channel_notes || null,
          b.role || "volunteer",
          token
        )
        .run();
      return json({ id: r.meta.last_row_id, share_token: token }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      await updateRow(
        env,
        "people",
        id,
        pick(b, ["name", "email", "phone", "preferred_channel", "platform", "channel_notes", "role", "is_approver", "reminder_minutes"])
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
    if (method === "POST") {
      const b = await body(request);
      if (!b.title) return err("Title required.");
      const r = await env.DB.prepare(
        `INSERT INTO tasks (area_id, parent_id, title, description, status, priority, due_date, percent, links_field, assignee_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
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
          b.assignee_id || null
        )
        .run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      await updateRow(
        env,
        "tasks",
        id,
        pick(b, ["area_id", "parent_id", "title", "description", "status", "priority", "due_date", "percent", "links_field", "assignee_id"])
      );
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
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
        `INSERT INTO supplies (area_id, item, quantity, estimated_cost, status, assignee_id, notes)
         VALUES (?,?,?,?,?,?,?)`
      )
        .bind(
          b.area_id || null,
          b.item,
          b.quantity || null,
          b.estimated_cost != null ? b.estimated_cost : null,
          b.status || "needed",
          b.assignee_id || null,
          b.notes || null
        )
        .run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PATCH" && id) {
      const b = await body(request);
      await updateRow(
        env,
        "supplies",
        id,
        pick(b, ["area_id", "item", "quantity", "estimated_cost", "status", "assignee_id", "notes"])
      );
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM supplies WHERE id = ?").bind(id).run();
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
    // Static SPA (with SPA fallback configured in wrangler.toml)
    return env.ASSETS.fetch(request);
  },
};
