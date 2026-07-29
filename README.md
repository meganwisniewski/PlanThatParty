# 🎃 PlanThatParty

A friendly coordination hub for a big annual Halloween party — so one person can project-manage it without holding the whole thing in their head, and every volunteer gets **only the part that's theirs**, on the channel they actually use.

Built to be **calm, low-friction, and ADHD-friendly**: a zoom **Focus Dial** lets anyone dial from the whole party down to a single next thing (and back out), and an always-available **feedback button** is on every screen.

---

## What it does today (v0.1)

- **Dashboard** — progress, what needs an owner, what's blocked, budget, progress by area.
- **🎛️ Focus Dial** — turn the dial to zoom: *Whole party → Every area → One area → One thing.* The "one thing" view is a calm single-task spotlight. The dial is on the volunteer page too.
- **Tasks** — assign to people, set status/priority/due dates, filter by area/person/status.
- **People** — the crew, each with a **preferred channel** (email, text, iMessage, WhatsApp, phone, in-person, calendar) + platform, and a **private share link** that shows them only their tasks.
- **Supplies & budget** — track items, who's buying, estimated cost, purchased status.
- **Feedback** — the 💬 button anyone can tap; you triage it in the Feedback tab.
- **Volunteer view** (`/me/<link>`) — no login; each person sees just their stuff and can update status.
- Seeded with a **starter Halloween planning template** (10 areas + a checklist) so it's useful on day one.

Channels are captured and respected now; **automated sending** (email digests, SMS, calendar invites) is the next iteration — see `ROADMAP.md`.

---

## Stack

- **Cloudflare Workers** (API + static hosting) — `src/index.js`
- **Cloudflare D1** (SQLite) — `schema.sql`
- **Plain HTML/CSS/JS** front-end (no build step) — `public/`

---

## Run it locally

```bash
npm install
# create a local D1 and load the schema + starter template
npx wrangler d1 execute plan-that-party --local --file=./schema.sql
npm run dev            # http://localhost:8787
```

## Deploy it (real URL your friends can open)

The D1 database is **already provisioned and seeded** on your Cloudflare
account (its id is in `wrangler.toml`), so deploying is just:

```bash
npx wrangler login     # opens Cloudflare auth in your browser
npm run deploy
```

Wrangler prints your live URL (e.g. `https://plan-that-party.<you>.workers.dev`).

> Starting over on a fresh Cloudflare account instead? Run
> `npx wrangler d1 create plan-that-party`, paste the new id into
> `wrangler.toml`, then `npm run db:remote` to load the schema before deploying.

## First things to do after deploy

1. Open the site → **Settings** → set the party **date, time, location**, and change the **admin PIN** (default is `boo-2026`).
2. **People** → add the two hosts, yourself, and any volunteers; set each person's preferred channel.
3. Copy each person's **🔗 link** and send it to them however they like to be reached.
4. Assign tasks; watch the Dashboard.

### A note on the admin PIN
Editing is protected by a shared PIN (Settings). Volunteers never need it — their private links just work. It's light protection suitable for a party site, not bank-grade security.
