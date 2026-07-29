# 🗺️ Roadmap

An honest, iterative plan. v0.1 (shipped) is the **coordination brain**: people, tasks, supplies, the Focus Dial, per-person share links, and feedback. Everything below hangs off that.

Guiding principles:
- **Meet people where they are** — respect each person's chosen channel; never blast everyone with everything.
- **Reduce overwhelm** — zoom in/out, one-thing-at-a-time, gentle nudges, not a firehose.
- **Don't rebuild the wheel** — integrate good existing tools where it's cheaper than building.

---

## Next up (v0.2) — Reaching people on their channel

The data model already stores each person's preferred channel. This iteration makes messages actually go out.

- **Email (easiest first)** — "here's your part" and weekly digests. Options: Cloudflare Email / Resend / SendGrid, or the Gmail connector for personal sends.
- **Calendar invites** — generate `.ics` for shifts, deadlines, and the party; works for Google *and* Microsoft users.
- **Text / SMS + WhatsApp** — via Twilio. Highest open rate; small per-message cost and a bit of setup.
- **In-person / printable** — a clean printable task sheet per person for folks who want paper.
- **A "notify" action** that picks the right channel per person automatically, with a preview before anything sends.

## v0.3 — Recruiting & onboarding volunteers
- Public "**I can help**" sign-up page → captures name, contact, preferred channel, and areas they're up for.
- Open-tasks board where people can **claim** a job.
- Auto-create their private link and send it on their channel.

## v0.4 — Keeping momentum (ADHD-friendly automation)
- Gentle scheduled nudges ("2 things need an owner", "your task is due Friday") on each person's channel.
- "**What should I do next?**" — one suggested next action.
- Blocked-task escalation to the coordinator.

## v0.5 — Richer planning
- Timeline / run-of-show view for the day.
- Potluck & headcount coordination; dietary flags.
- Photos & inspiration board (Cloudflare R2 for storage).
- Post-party recap + "save this for next year" template export.

---

## Known limitations / decisions to revisit
- **iMessage can't be reliably automated** by a web app — for iPhone users we'll use SMS or email and label it as their channel. (Research notes in `RESEARCH.md`.)
- Auth is a shared PIN — fine for a party, revisit if it ever holds anything sensitive.
- Single party per instance for now; multi-event is a later refactor (schema already keys most things by area/person, so it's tractable).

See `RESEARCH.md` for the survey of existing tools and what we chose to borrow vs. build vs. integrate.
