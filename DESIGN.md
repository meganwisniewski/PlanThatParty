# DESIGN.md — PlanThatParty UI Redesign Guide

*A concrete, implementable design system for the party/volunteer coordination SPA. Modeled primarily on Smartsheet's grid-and-views structure, borrowing calm-design ideas from Airtable, Asana, Linear, Notion, Monday, and Trello, and tuned for an ADHD coordinator. Plain HTML/CSS/JS — no framework.*

---

## 0. The core problem and the one-line fix

The first version was a **dark, sticky-header, pill-tab SPA** — a stack of vertical lists. That layout has three brain-unfriendly properties:

1. **No spatial stability** — every tab replaces the whole screen, so there's no persistent frame to anchor attention.
2. **Dark, high-saturation base** — color was used for *decoration* instead of reserved for *meaning*, so status color had to fight the background.
3. **Lists, not a grid** — items were free-form rows, so the eye re-parsed each row instead of scanning aligned columns.

The fix: **adopt Smartsheet's three-zone shell (left nav + main canvas + right detail panel), render data as an aligned spreadsheet-style grid with color reserved strictly for status, on a light neutral base — and let the Focus Dial drive which view and how dense it is.**

---

## 1. Smartsheet structural teardown

### 1.1 A stable 3-zone shell
The frame stays; only the canvas content changes. Left workspace/sheets panel → main canvas → right detail panel that slides in when a row is clicked. That spatial constancy is the biggest legibility win over a tab-SPA.

### 1.2 The grid/sheet view
- Rows = items, columns = properties; the eye learns the layout once and scans down columns.
- Row numbers in a frozen gutter give every item a stable address.
- Frozen first column (task name) stays pinned on horizontal scroll.
- Inline editing with type-specific editors (dropdown/date/checkbox).
- Row hierarchy via indentation with collapse triangles; collapsing a parent rolls up its children.
- Uniform 32–40px row height + hairline rules = a clean ledger.

### 1.3 Multiple views of the same data
One dataset; the view switcher swaps rendering — Grid, Gantt/timeline, Card/Kanban, Calendar. No data duplication.

### 1.4 Right-hand detail panel
Click a row → panel slides in showing every field as a stacked form. Progressive disclosure: grid shows 6–7 key columns, panel holds everything.

### 1.5 Dashboards = widgets
Metric tiles (big single numbers), charts (status donut), shortcut lists. The dashboard is the whole-party altitude.

### 1.6 Status representation — the scannability engine
- RYG "harvey ball" / symbol columns — scan shapes faster than words.
- % complete bars inside cells.
- Conditional formatting — overdue → red, blocked → red fill — so exceptions light up.

### 1.7 Why the dense screen stays legible
Discipline: strict column alignment, one row height, hairline gridlines, color reserved for status against neutral white, collapse to hide what you're not working on.

---

## 2. One idea to steal from each peer
- **Airtable** — calm low-saturation palette; "friendly spreadsheet" feel.
- **Monday** — status as a bold filled color block (status column only).
- **Asana** — collapsible grouped sections + one owner per task (maps to per-person links).
- **Notion** — saved per-view filter/sort/group; airy typographic base.
- **Linear** — opinionated fixed status enum, quick-add/command bar, radical restraint on chrome.
- **Trello** — the board as "move a task forward"; status is location.

---

## 3. Reusable patterns
Left nav + main canvas + right detail panel · one dataset many views · grouping + collapsible sections · inline-editable cells · color = status only · alignment/spacing as the primary legibility tool · helpful empty states · progressive disclosure.

---

## 4. Why this is brain-friendly
Alignment + grid reduce visual-search time; grouping chunks information; one primary action per view lowers decision load; a calm neutral base lets status color read as signal; whitespace reduces clutter; symbols/chips beat walls of text; and collapsing from "everything" to "one thing" (the Focus Dial) is progressive disclosure, which cuts overwhelm and time-to-first-action.

---

## 5. Concrete translation

### 5.1 Layout skeleton
```
┌────────────┬──────────────────────────────────────────────┬──────────────┐
│  LEFT NAV  │  TOP BAR: party name • countdown              │ DETAIL PANEL │
│  (240px)   │  [ Grid ][ Board ][ Calendar ]   🔍 [+ Quick] │  (360px,     │
│ ● Overview │──────────────────────────────────────────────│   slide-in)  │
│ PLANNING   │  ▼ FOOD & DRINK           4 tasks  ● 50%      │  Task ────── │
│  ● Food    │  # │ Task        │Owner│Status│Prio│ Due │ %  │  Owner  ▾    │
│  ● Decor   │  1 │ Order pizza │ Mel │ ◕ IP │ ▲  │Oct20│▓▓░ │  Status ▾    │
│  ● Setup   │  2 │ Buy cups    │  —  │ ○ To │ ·  │Oct25│░░░ │  Due …       │
│ VIEWS      │  ▶ DECOR                  6 tasks  ● 20%      │  Notes…      │
│  ● My tasks│                                               │  Notify ▸    │
│ ⚙ People   │  [ Dial: ◉━━○  Party › Food › task ]          │              │
└────────────┴──────────────────────────────────────────────┴──────────────┘
```
Left nav (240px, collapsible to 56px rail): Overview at top, planning Areas in the middle (each with a rollup status dot), saved Views + People/Settings at the bottom. Top bar: party name + countdown, view switcher, search + quick-add; the dial sits just under the toolbar. Detail panel hidden until a row is selected; full-screen at the deepest dial zoom.

### 5.2 Task grid columns
`#` (40px, muted, frozen) · **Task** (flex, 600 weight, frozen) · Area (chip, hidden when grouped) · Owner (initials + name; amber "Unassigned") · **Status** (filled chip + glyph) · Priority (glyph only) · Due (`Oct 20`, red if overdue) · % (mini bar + label). Row height 40px; sticky 36px uppercase header; single-click inline edit with a purple focus ring; group-by-Area collapsible headers with count + rollup; helpful empty states.

### 5.3 Status & priority language
Status = light same-hue tint chip + leading Harvey-ball glyph (all clear WCAG AA):

| Status | Glyph | Text | Chip bg |
|---|---|---|---|
| To do | ○ | #5C6470 | #EEF0F3 |
| Claimed | ◔ | #1D4ED8 | #DCE9FF |
| In progress | ◕ | #B45309 | #FEF0C7 |
| Blocked | ⊘ | #B42318 | #FEE4E2 |
| Done | ● | #15803D | #DCFCE7 |

Priority = glyph + color, no fill: High ▲ #C2410C · Med ■ #B45309 · Low · #868D99.
% bar: 6px, track #E3E6EB, fill #15803D. Conditional: overdue Due text #B42318 600; blocked row inset 3px #B42318 left border; unassigned owner amber.

### 5.4 Visual system (light)
| Token | Hex | Use |
|---|---|---|
| --bg | #F7F8FA | app background |
| --surface | #FFFFFF | grid, cards, panels |
| --surface-2 | #F1F2F5 | hover, group header, selected cell |
| --line | #E3E6EB | hairline borders/gridlines |
| --line-strong | #D2D7DE | frozen divider, panel edges |
| --ink | #1F2430 | primary text |
| --muted | #5C6470 | secondary text |
| --faint | #868D99 | tertiary/placeholder |
| --accent | #EA6A1E | pumpkin — active-nav, thin accents, wordmark |
| --accent-strong | #C2410C | primary button bg (white text) |
| --accent-purple | #7C3AED | focus ring |
| --overdue | #B42318 | conditional red |

Halloween warmth lives in **accent only**: a 3px pumpkin active indicator on the selected nav item, the primary button, a thin top hairline, the 🎃 wordmark, and a faint motif in empty states. Working surfaces stay neutral. Never tint the grid background.

Type: Page title 20/700; area header 13/700 uppercase muted; body/cell 14/500; meta/chip 12/600; metric number 32/800. Spacing (4px base): 4·8·12·16·24·32·48; cell padding 8×12; card 16; panel 20. Radius: chips/cells 6, buttons/inputs 8, cards/panels 12. Card shadow `0 1px 2px rgba(20,20,40,.06)`; panel `0 8px 30px rgba(20,20,40,.12)`. Focus ring `2px var(--accent-purple)` on every interactive element.

Overview widgets: 3–4 metric tiles (unassigned, blocked, % done, countdown), a status donut (CSS conic-gradient), a shortcut list.

### 5.5 Focus Dial → views
| Dial level | Meaning | Renders as | Density |
|---|---|---|---|
| 0 — Party | whole party | Overview dashboard / all areas collapsed | lowest |
| 1 — Area | one area | grid or board filtered to that area | medium |
| 2 — Task | one task | detail panel full-screen "Now mode" | highest |

The dial is a breadth/density control, not a separate feature. Per-person links open volunteers straight at level 2.

### 5.6 Responsive
≥1024 three-zone shell · 640–1023 nav collapses to icon rail, panel becomes full-width sheet · <640 grid becomes a card list (task name + chip row + full-width % bar), view switcher + dial in a sticky bottom bar, 44px touch targets.

---

## 6. Relational model (the "work produces real data" fix)

The first version's deepest flaw: a task like "Lock the party date" had nowhere to put the actual date, so finishing it changed nothing. Fix: **the app is the party's single source of truth, and tasks fill it in.**

- **Event facts** on the party record: `event_date`, `start_time`, `location`, `theme`, `headcount_target`, `budget_target`. A task can **link to a fact** (`links_field`); its detail panel edits that fact directly, and saving the fact completes the task. The fact then flows to the header countdown, everyone's view, calendar invites, and the budget/headcount rollups.
- **Hierarchy**: tasks have `parent_id` (subtasks) with indentation + collapse; a parent's % rolls up from its children.
- **Budget** rolls up from supply costs against `budget_target`.
- **Timeline** (next): due dates relative to `event_date` so the schedule shifts when the date moves.

---

## 7. Build order
1. Swap to the light palette. 2. Build the 3-zone shell (persistent frame; only canvas re-renders). 3. Replace list rows with a real aligned grid (frozen #/Task, sticky header, group-by-Area collapse). 4. Status chip + glyph, priority glyph, % bar. 5. Right slide-in detail panel; full-screen at dial level 2; **fact-linked fields**. 6. Wire the dial to (view + density). 7. Overview dashboard. 8. Mobile card fallback.
