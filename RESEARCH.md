# Research: Building a Volunteer-Coordination App for a Large Annual Halloween Party

**Context:** Taking over PM duties from two overwhelmed hosts. Builder has ADHD, wants to (a) avoid reinventing the wheel and (b) reach each volunteer on their preferred channel and show them only what they need. Current stack: **Cloudflare Worker + D1 (SQLite)** with a task / people / supplies / feedback model and per-person share links.

This report surveys real tools in five areas and ends with concrete build-vs-borrow-vs-integrate guidance.

---

## 1. Event / Party Volunteer Coordination Platforms

These are the closest existing products to what we're building. The pattern to steal is the **slot / signup-sheet model**: an organizer defines "somebody needs to do X" and people claim it, with automated reminders. None is a perfect fit (they don't do multi-channel-by-preference or ADHD focus modes), but their slot mechanics and reminder flows are battle-tested.

- **SignUpGenius** — The category leader for slot-based signups (schools, nonprofits, events). Organizer creates a sheet of named slots; volunteers claim slots from any device; system sends confirmation + automatic reminders (date-specific only), and there's a **slot-swap** feature where participants trade assignments and the organizer gets instant notification. Has a real **REST API (JSON, key-based auth), but it's gated behind the paid Premium plan.** Free tier is ad-supported.
- **Perfect Potluck** — Free, hyper-specialized potluck coordinator. Organizer defines categories (Appetizers, Mains, Sides, Desserts, Drinks — *and non-food slots like Paper Products, Setup Help, Cleanup Help*), guests claim items, and it sends invitations + automated reminder emails. Dated UI and ads, but the "food + logistics slots in one sheet" model maps exactly onto our tasks+supplies model. Email-only, no public API.
- **SignUp.com** (formerly VolunteerSpot) — Similar slot-sheet model to SignUpGenius with a cleaner free tier; good at recurring/repeating slots and reminder cadences.
- **Track It Forward** — Focused on **hour logging** rather than assignment: volunteers self-log time via selfie/signature/GPS check-in. Free under 25 volunteers. Relevant only if we ever want post-event "who actually showed up and did what" tracking.
- **InitLive / Bloomerang Volunteer** — Enterprise event-volunteer tool. Two ideas worth stealing: (1) **RosterMode** best-shift matching engine that places volunteers into roles suited to them; (2) a **guaranteed-delivery escalation ladder** — every message goes out first as in-app, then SMS, then email, so nobody misses it. That escalation idea is directly applicable to our multi-channel goal.
- **Golden (goldenvolunteer.com)** — Volunteer management with automated **SMS + email + push** shift reminders explicitly aimed at reducing no-shows; also waivers, background checks, CRM. Overkill for a house party but validates "multi-channel reminders reduce no-shows."
- **Partiful** — The modern casual-party invite app. Steal-worthy mechanics: **Text Blasts** to all guests, RSVP tracking, **waitlist auto-promotion** (when someone cancels, the next person is promoted and notified), multi-date voting where RSVPs auto-update to the winning date, and in-app guest messaging. No task/slot assignment and no open API, but its notification UX is the gold standard for "reach people where they are."
- **Evite / Punchbowl** — Invitation-first, not coordination. Evite does automatic reminder notifications and RSVP tracking on a free tier; Punchbowl is design/licensed-character focused (kids' parties). Useful as a reference for invite + reminder flows only.

**What to borrow for our build:**
- The **slot model** (a task is an unclaimed slot; claiming it assigns it) — proven and intuitive; make tasks *and* supplies both claimable slots, like Perfect Potluck.
- **Slot swap / hand-off** between volunteers with an organizer notification, so re-delegation isn't a bottleneck on you.
- **Waitlist / backup auto-promotion** for critical roles.
- InitLive's **channel escalation ladder** (in-app → SMS → email) as the reliability model behind our "preferred channel" feature.
- Don't integrate with these as backends — they're closed or paywalled (only SignUpGenius has an API, and it's paid). Borrow the *patterns*, keep the data in D1.

---

## 2. General Project / Task Management Tools

These solve delegation, statuses, and per-person views far more maturely than the party tools — and several have **free tiers + open REST APIs + webhooks**, so they're candidates to *integrate with* rather than rebuild. The tension: they're built for coworkers who log in daily, not for volunteers who touch the thing twice a year. That's exactly the gap our per-person share links fill.

- **Trello** — Kanban boards/cards/lists. Assign members to cards, due dates, checklists, labels. Free tier: 10 boards. **Open REST API + webhooks, well-documented and free.** The board→list→card→checklist hierarchy is a clean "altitude" model (project → phase → task → subtask).
- **Asana** — Strong task model: assignee (single owner), due dates, sections, subtasks, dependencies, **"My Tasks" per-person view**, and project templates. Free tier historically ~10-15 users (now tightening to small personal plans). Robust API + webhooks. The **single-assignee + My Tasks list** is the cleanest per-person-view pattern to copy.
- **ClickUp** — Broadest free tier (unlimited tasks/users, docs, multiple views), heavy **automations** for reminders/assignment. Powerful but notoriously overwhelming — a cautionary tale for an ADHD-focused UI (do the opposite of ClickUp's density).
- **Notion** — Flexible databases + relations; can model people/tasks/supplies with linked views and per-person filtered views. **REST API + webhooks** (page updates, property changes, comments) on a free tier. Viable as a *data backend/CMS* if we didn't already have D1 — but no built-in notifications-by-channel.
- **Todoist** — Cleanest lightweight task model. Free REST API v2 **with webhooks** for real-time events; natural-language dates, recurring tasks, filters. Great reference for a minimal, low-friction task capture UX; could even be a personal side-channel for the PM's own next-actions.
- **Linear** — Best-in-class *feel* for issue tracking: keyboard-first, opinionated statuses, cycles. Not built for casual/non-technical volunteers, but the **speed + minimalism + clear status model** is the aesthetic target.
- **Monday.com** — Colorful, spreadsheet-like; good status columns and automations; weaker free tier. Reference for at-a-glance status color coding.

**Common patterns worth copying:**
- **Single clear assignee** per task (Asana-style) beats fuzzy group ownership for accountability.
- **Explicit statuses** (Not started / In progress / Blocked / Done) rendered as color at a glance (Monday/Trello).
- **Per-person filtered view** ("My Tasks") — this is the core of our share-link idea.
- **Digest notifications** (daily/weekly summary) instead of per-change spam.
- **Templates** so next year's party clones this year's structure in one click.

**What to borrow for our build:**
- Copy Asana's **single-assignee + "My Tasks"** and Trello's **project→phase→task→checklist altitude**.
- We likely **should NOT integrate** these as our backend — we already have D1, and none of them do preferred-channel messaging. But their **free APIs + webhooks** mean an *optional* export ("push my tasks to Trello/Todoist") is cheap to add later for volunteers who already live in those tools.

---

## 3. Multi-Channel Messaging — "Reach People Where They Are"

The realistic building blocks, ranked by feasibility for a hobby project. Summary up front: **email and SMS are cheap and easy; calendar invites are free and easy; iMessage is the hard/near-impossible one; WhatsApp is doable but has template friction.**

- **Email — EASY, CHEAP.** Use **Resend** (3,000 emails/month free permanently, 100/day cap, 1 domain; Pro $20/mo for 50k; React/JSX email templates) — the best free tier now that **SendGrid killed its permanent free tier (retired May 27 2025; new accounts get a 60-day trial then paid plans from ~$19.95/mo).** Resend is the obvious default for a Cloudflare Worker: simple HTTP API, no SMTP.
- **SMS — EASY, CHEAP-ISH.** **Twilio** SMS from ~**$0.0083 per message** send/receive, plus per-message US carrier fees and ~$1.15/mo for a number. For a party (dozens of people, a handful of messages each), total cost is a few dollars. Simple REST API callable from a Worker. A2P 10DLC registration is the one annoyance for US SMS but is fine at hobby volume.
- **WhatsApp — DOABLE, SOME FRICTION.** Twilio WhatsApp is **~$0.005/message (Twilio fee) + Meta's per-template fee ($0.0014–$0.0499 depending on country/category)** since Meta moved to per-message billing July 1 2025. Free **sandbox** exists for testing but recipients must opt in by messaging a code. Business-initiated messages must use **pre-approved templates** — that's the real friction, not cost.
- **Calendar invites (.ics) — FREE, EASY, HIGH VALUE.** `.ics` is a plain-text format (RFC 5545). Our Worker can **generate .ics files on the fly** and either attach them to emails or expose "Add to Google / Outlook / Apple Calendar" links. This is the single best cheap way to get a shift/task into someone's phone regardless of platform. No third party needed. Do this early.
- **iMessage — HARD / effectively impossible to do cleanly.** **Apple offers no public API** — no server-side way to send blue-bubble messages. Third-party bridges (**Sendblue, LoopMessage, Blooio, Texting.blue**) work by running a physical Mac that drives the Messages app, then falling back to SMS/RCS for Android. They're paid, fragile, and against the spirit of Apple's ToS. **Recommendation: don't build iMessage. Treat "iMessage" as "SMS to their iPhone"** — from the recipient's view an SMS from a person often lands in the same thread anyway, and it's 100x simpler.
- **Push notifications — MEDIUM.** Web Push (VAPID) works from a Worker and is free, but requires the volunteer to install/allow a PWA — high friction for people who visit twice a year. Skip for v1.
- **Phone / in-person — MANUAL, but model it.** Some volunteers genuinely prefer a phone call or being told in person. We can't automate that, but we *can* store "preferred channel = phone/in-person" and, for those people, surface a **PM to-do: "call Aunt Sue about setup"** instead of trying to auto-message them. That's the honest, humane version of "reach people where they are."

**Rough total cost for one party:** Resend free tier + a few dollars of Twilio SMS + free .ics = **effectively under ~$5–10/event**, plus ~$1/mo if you keep a Twilio number year-round.

**What to borrow / build:**
- A **channel abstraction**: one `sendNotification(person, message)` that dispatches on `person.preferred_channel` → Resend (email) / Twilio (SMS/WhatsApp) / generate .ics / or "queue a manual PM task" for phone/in-person.
- Implement **email + SMS + .ics first** (covers ~everyone cheaply). Add WhatsApp only if volunteers actually ask. **Explicitly skip iMessage automation.**
- Steal InitLive's **escalation ladder** as a fallback for un-answered critical asks.

---

## 4. ADHD-Friendly / Focus & "Altitude" UX Patterns

This is where our app can genuinely beat every tool in sections 1–2: they're all built for neurotypical daily users and are *dense*. For an ADHD PM the win is **radical reduction of what's on screen** and the ability to **zoom from whole-project overview down to a single next action.**

- **Amazing Marvin** — The reference ADHD task manager. Steal-worthy features: **"beat the clock" time challenges**, a **"task jar"** that picks something for you when you're stuck deciding, a **Procrastination Wizard** that diagnoses *why* you're stuck, and one-tap **split-a-big-task-into-steps**. Deeply customizable (which is itself a trap — see WIP note).
- **Llama Life** — Purpose-built for single-tasking: **one task at a time**, per-task countdown timers, a **running total time estimate + projected finish time** for the whole list (fights time-blindness), AI task-breakdown. The "here's when you'll actually be done" number is a great anti-overwhelm signal.
- **Sunsama** — Mindful daily planner: pulls tasks from many sources into **one intentional day**, actively **warns when you overload a day** and nudges you to defer — a soft **WIP limit**. Time-blocking + weekly objectives linked to tasks.
- **Tiimo** — Visual, neurodivergent-first scheduling with timers and gentle structure; good reference for calm visual design and iconography over walls of text.
- **Super Productivity / Forget / Focus One** — Various "visible time" and single-tasking tools reinforcing the same theme: **make time visible, show one thing.**
- **Progressive disclosure (general UX principle)** — Show only what's essential first, reveal complexity on demand. Research cited: it **cuts time-to-first-action 30–50%** while keeping feature discovery high, and specifically for ADHD: **show one step at a time, mark progress ("Step 2 of 4"), and allow pause/resume without losing context.** Give users control over pace, motion/sound intensity, and information density.

**Interaction patterns that reduce overwhelm (the shortlist to implement):**
- **One-thing-at-a-time / "Now" mode** — a view that shows the single next action and nothing else, with an obvious "done → next."
- **Altitude zoom** — the *same* data at three levels: whole party overview → one area (Food / Decor / Setup) → one task. Never force the user to see all three at once.
- **WIP limits / overload warnings** — cap or warn when too much is assigned to one person (or to *you*) in a time window (Sunsama pattern).
- **Progressive disclosure everywhere** — collapse everything by default; details expand on tap. "Step X of Y" on any multi-step flow.
- **Time made visible** — per-task estimates and a "you'll be done by ~X" total (Llama Life pattern).
- **"Pick for me" / task jar** — when decision paralysis hits, the app chooses the next task.
- **Calm defaults** — color for status, minimal text, big touch targets, no notification spam (digest over per-event).

**What to borrow for our build:**
- Build a **per-person share link that opens directly in "one-thing-at-a-time Now mode"** — the volunteer sees *only their current ask*, not the whole project. This is the intersection of "show each person only what they need" *and* ADHD-friendly design, and it's our differentiator.
- Give the **PM (you)** the altitude-zoom overview + WIP/overload warnings + a "pick for me" for your own next action.
- Resist the ClickUp/Marvin customization trap: ship opinionated, minimal defaults.

---

## 5. Free Party / Halloween Planning Checklists & Templates

Reputable, free checklists to adapt into a **starter template** (a "clone last year" seed) for the tasks/supplies model. Common guidance: **start 4–6 weeks out** (nearly half of Halloween shoppers begin planning in September); lock headcount *before* buying food/decor.

- **SignUp.com — Halloween Class Party Checklist** (signup.com/Class-Party/Class-Party-Checklist-Halloween) — Structured, task-by-task party checklist from a coordination company; easy to translate into task rows.
- **Perfect Potluck** (perfectpotluck.com) — Live example of category structure to seed our supplies/food model: Appetizers, Mains, Sides, Desserts, Drinks, **Paper Products, Setup Help, Cleanup Help.**
- **QuickSignup — Halloween Potluck & Party sign-up templates** (quicksignup.com/templates/halloween-potluck, /halloween-party) — Free Word/online templates covering dishes, costumes, decorations.
- **101Planners — Free printable/editable Potluck Sign-Up Sheet** (101planners.com/potluck-sign-up-sheet) — Editable dish-coordination sheet.
- **The Bash — Ultimate Party Planning Checklist** (thebash.com/articles/party-planning-checklist-stay-organized) — General countdown timeline (weeks-out → day-of) good for our task *due-date scaffolding*.
- **URCordiallyInvited — Ultimate Halloween Party Checklist 2026** and **EasyEventPlanning — Halloween Party Checklist** — Themed end-to-end lists covering food/drinks, decorations, entertainment, **safety**, and day-of.
- **Supply-list essentials** repeatedly cited: decorations, disposable tableware, extra napkins, trash bags, **batteries**, candy — plus safety items (lighting for walkways, keep exits clear, allergy-aware labeling for a big crowd).

**What to borrow for our build:**
- Ship a **seed template** with pre-built areas — **Invites/RSVP, Food & Drink (potluck slots), Decor, Setup, Day-of / Hosting, Safety, Cleanup** — each pre-loaded with typical tasks + supply slots on a **weeks-out timeline** (T-6wk … day-of). Adapt the SignUp.com and Perfect Potluck category structures directly.
- Store it as data so **"clone last year's party"** becomes the primary onboarding path (matches how these are annual events).

---

## Recommendations: Build vs. Borrow vs. Integrate

Guidance tuned to the current stack (**Cloudflare Worker + D1**, tasks/people/supplies/feedback, per-person share links) and an **iterative, ADHD-friendly, cheap** build.

### Keep building (this is your moat — no existing tool does it)
1. **Per-person share links → open in "one-thing-at-a-time Now mode."** The union of "show each person only what they need" + ADHD single-tasking. Nothing in sections 1–2 does this. Highest priority.
2. **Preferred-channel dispatch.** A single `sendNotification(person, msg)` that switches on `person.preferred_channel`. No off-the-shelf tool routes by *the recipient's* preference — this is genuinely yours to build.
3. **PM altitude-zoom + overload/WIP warnings.** Your own overwhelm is the thing to design against.

### Borrow (patterns, not code)
- **Slot model + slot-swap + waitlist auto-promotion** (SignUpGenius / Partiful) — for tasks *and* supplies.
- **Single-assignee + "My Tasks" + explicit color statuses + templates** (Asana / Trello / Monday).
- **Escalation ladder** in-app→SMS→email for critical, unanswered asks (InitLive).
- **ADHD patterns**: progressive disclosure ("Step X of Y"), visible time / "done-by" estimate, "pick for me" task jar, overload warnings (Marvin / Llama Life / Sunsama).
- **Seed checklist template** from SignUp.com + Perfect Potluck category structures.

### Integrate (cheap external building blocks — don't rebuild these)
Prioritized for the Worker:
1. **Resend** for email — free tier (3k/mo), simple HTTP API. *Do first.*
2. **On-the-fly `.ics` generation** + "Add to Calendar" links — free, RFC 5545, works on every platform. *Do first — highest value per effort.*
3. **Twilio SMS** — ~$0.0083/msg, trivial REST from a Worker; add A2P 10DLC. *Do second.*
4. **Twilio WhatsApp** — only if volunteers ask; budget for template approval + Meta per-message fees. *Defer.*
5. **Optional export to Trello/Todoist/Notion** via their free REST APIs + webhooks — a "send my tasks to the app I already use" convenience, not a backend. *Later / nice-to-have.*

### Explicitly do NOT build
- **iMessage automation** — no Apple API; third-party Mac-bridge services are fragile, paid, and ToS-adjacent. Treat "iMessage" as "SMS to their iPhone."
- **Web Push for v1** — too much install friction for twice-a-year users.
- **Your own email/SMS sending infra** — use Resend/Twilio.
- **A dense, hyper-customizable tool** (the ClickUp/Marvin trap) — ship opinionated minimal defaults.

### Suggested iteration order
1. Seed template + tasks/supplies as claimable slots + per-person share link in **Now mode**.
2. **Resend email + .ics** notifications through the channel-dispatch abstraction.
3. **Twilio SMS**; store `preferred_channel` per person; "manual PM task" fallback for phone/in-person.
4. PM altitude-zoom dashboard + overload warnings + "pick for me."
5. Slot-swap, waitlist auto-promotion, digest reminders, escalation ladder.
6. (Optional) WhatsApp; export-to-Trello/Todoist.

---

### Sources
- SignUpGenius comparisons & API/reminders: [Capterra](https://www.capterra.com/compare/135392-151346/SignUpGenius-vs-Volunteer-Time-Tracking), [SignUpGenius Developer API](https://developer.signupgenius.com/), [Reminder settings](https://support.signupgenius.com/hc/en-us/articles/29670475777303-View-Reminder-Settings-and-Emails), [Integrations](https://www.signupgenius.com/blog/integrations-to-know-about)
- Perfect Potluck: [perfectpotluck.com](https://www.perfectpotluck.com/), [advanced settings](https://perfectpotluck.com/blog/advanced_settings_available_to_meal_coordinators.php), [best potluck apps 2026](https://www.signupready.com/blog/best-potluck-apps-2026)
- Track It Forward / volunteer tools: [SpotSaaS compare](https://www.spotsaas.com/compare/signupgenius-vs-signup-com-vs-track-it-forward), [Jotform SignUpGenius alternatives](https://www.jotform.com/nonprofit/sign-up-genius-alternative/), [Zelos volunteer apps](https://getzelos.com/best-volunteer-signup-apps)
- InitLive / Golden: [Golden scheduling](https://goldenvolunteer.com/platform/scheduling/), [InitLive features](https://www.initlive.com/event-volunteer-management-software/features), [InitLive scheduling tools](https://www.initlive.com/blog/volunteer-scheduling-top-strategies-and-tools-for-success)
- Partiful / Evite / Punchbowl: [GuestlistOnline comparison](https://www.guestlistonline.com/blog/best-party-invitation-apps-compared), [Mixily Evite vs Partiful](https://blog.mixily.com/evite-vs-partiful/), [Mixily Evite vs Punchbowl](https://blog.mixily.com/evite-vs-punchbowl/)
- PM tools: [ClickUp free PM software](https://clickup.com/blog/free-project-management-software/), [Trello vs Asana vs Monday vs ClickUp](https://softwarefinder.com/resources/trello-vs-asana-vs-monday-vs-clickup), [Notion vs Trello](https://www.cloudwards.net/notion-vs-trello/)
- APIs/webhooks: [Todoist API v1](https://developer.todoist.com/api/v1/), [Notion API overview](https://developers.notion.com/guides/get-started/overview), [Notion API guide](https://apidog.com/blog/how-to-work-with-notion-api/)
- Messaging costs: [Twilio SMS pricing](https://www.twilio.com/en-us/sms/pricing/us), [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing), [Resend vs SendGrid](https://dev.to/thiago_alvarez_a7561753aa/resend-vs-sendgrid-2026-sendgrid-killed-its-free-tier-now-what-2gh4), [Cheapest email API free tier 2025](https://resources.mailertogo.com/comparisons/cheapest-email-api-free-tier-developers-pricing-2025)
- iMessage feasibility: [Sendblue iMessage API](https://www.sendblue.com/blog/imessage-api), [DEV: send iMessages programmatically](https://dev.to/blooio-messages/how-to-send-imessages-programmatically-rest-api-python-nodejs-3oo6)
- .ics / calendar: [ICS file integration guide](https://www.calen.events/blog/ics-file-calendar-integration-guide), [OneCal ICS generator](https://www.onecal.io/tools/ics-file-generator)
- ADHD/focus UX: [Amazing Marvin features](https://amazingmarvin.com/features/), [Llama Life](https://apps.apple.com/us/app/llama-life-adhd-routine-task/id6454469750), [Sunsama task management](https://www.sunsama.com/task-manager), [Zapier ADHD to-do apps](https://zapier.com/blog/adhd-to-do-list/), [Din Studio UI/UX for ADHD](https://din-studio.com/ui-ux-for-adhd-designing-interfaces-that-actually-help-students/), [LogRocket progressive disclosure](https://blog.logrocket.com/ux-design/progressive-disclosure-ux-types-use-cases/)
- Halloween/party checklists: [SignUp.com Halloween class party checklist](https://signup.com/Class-Party/Class-Party-Checklist-Halloween), [QuickSignup Halloween potluck](https://quicksignup.com/templates/halloween-potluck/), [101Planners potluck sheet](https://www.101planners.com/potluck-sign-up-sheet/), [The Bash party planning checklist](https://www.thebash.com/articles/party-planning-checklist-stay-organized), [URCordiallyInvited Halloween checklist](https://urcordiallyinvited.com/blogs/news/the-ultimate-halloween-party-checklist-for-2026)
