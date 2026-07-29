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
      return json({
        person: { id: person.id, name: person.name, role: person.role },
        party: party
          ? { name: party.name, event_date: party.event_date, start_time: party.start_time, location: party.location }
          : null,
        tasks,
        supplies,
      });
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

  // ---------- Feedback (open to everyone — the whole point) ----------
  if (resource === "feedback") {
    if (method === "POST" && !id) {
      const b = await body(request);
      if (!b.message || !b.message.trim()) return err("Say something first 🙂");
      await env.DB.prepare(
        "INSERT INTO feedback (page, person_id, author_name, message, sentiment) VALUES (?,?,?,?,?)"
      )
        .bind(b.page || null, b.person_id || null, b.author_name || null, b.message.trim(), b.sentiment || null)
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

  // ---------- Everything below is the admin surface ----------
  // Reads are open; writes need the PIN.
  const isWrite = method !== "GET";
  if (isWrite) {
    const gate = await requireAdmin(request, env);
    if (gate) return gate;
  }

  // Full dashboard snapshot
  if (resource === "state" && method === "GET") {
    const [party, areas, people, tasks, supplies, fb] = await Promise.all([
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
    ]);
    return json({
      party,
      pinConfigured: !!(party && party.admin_pin),
      areas: areas.results,
      people: people.results,
      tasks: tasks.results,
      supplies: supplies.results,
      newFeedback: fb ? fb.n : 0,
    });
  }

  // ---------- party ----------
  if (resource === "party" && method === "PATCH") {
    const b = await body(request);
    await updateRow(env, "party", 1, pick(b, ["name", "event_date", "start_time", "location", "theme", "headcount_target", "budget_target", "notes", "admin_pin"]));
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
        pick(b, ["name", "email", "phone", "preferred_channel", "platform", "channel_notes", "role"])
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
