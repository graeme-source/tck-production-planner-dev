# Station changes and walkthroughs — how to ship a feature the team will find

**Why:** "People don't know new features are there because there's a button
added and they don't see it" (Graeme, 27 Oct 2026). Every station-facing
feature now ships with a **station change entry**, and usually a
**walkthrough**, so it shows under *Station menu → What's changed in this
station?* and on the morning meeting's System Updates slide, grouped by
station. Objectives E, F and H.

## The pieces

| Piece | Where |
|---|---|
| Areas (each station, planning, office) | table `change_areas` (migration 0300) — data, not code |
| Change entries | table `system_updates` (`areas`, `tutorial`, `slug`) |
| Who has seen what | table `system_update_seen` (per person) |
| Pure rules (tagging guess, grouping, seen, step validation) | `lib/station-changes` |
| API | `/api/station-changes` (`routes/station-changes.ts`) |
| Walkthrough engine | `components/tutorial/tutorial-overlay.tsx` |
| Station menu + panel | `components/station-changes/` |
| Editing page | `/station-changes` (people with Settings → Feature flags & updates) |

## Checklist for a new station feature

1. **Give the new control a stable `data-tour` name** — lower-case words
   joined by hyphens, named for what it is, not where it sits:

   ```tsx
   <button data-tour="wrapping-print-front-labels" …>Print front labels</button>
   ```

   Never rename a `data-tour` value without updating the walkthroughs that
   point at it (`grep -rn '"target":"<name>"' lib/db/migrations`).

2. **Add the change entry in a migration** (next free number), keyed by a
   slug so it's idempotent. Tag the area(s) — the station keys are in
   `change_areas`; use `all_stations` for things on every station, `planning`
   for plans/orders/stock control, `office` for anything the floor team
   doesn't use (it never shows to them).

   ```sql
   INSERT INTO system_updates (slug, title, body, areas, published, tutorial) VALUES
   ('2026-11-02-wrapping-something', 'Short name of the thing',
   $$One line per point the team should know
   Plain English, present tense$$,
   '{wrapping}', true,
   $${"steps":[
     {"target":null,"title":"What it's for","body":"Why it helps, in one or two sentences."},
     {"target":"wrapping-something","title":"Tap here","body":"How to use it.","hiddenNote":"Where/when it appears if it isn't on screen."}
   ]}$$::jsonb)
   ON CONFLICT (slug) DO NOTHING;
   ```

   `created_at` defaults to when the migration runs on live — i.e. the deploy
   — which is what "last 7 days" should count from.

3. **Or add it on the page** `/station-changes`: title, lines, tap the areas
   (or "Guess from the words"), add steps, "Try it here" to preview.

## Writing a good walkthrough

- 2–4 steps. Step 1 is usually centred (`target: null`): **what it is and
  why it's useful**. Then one step per control: **how to use it**.
- Title ≤ 80 characters, text ≤ 600, at most 12 steps — enforced by
  `parseTutorial` on save and again before running.
- Write for the floor: short sentences, the button's exact words in quotes.
- Controls that only appear sometimes (a done screen, a flavour with a
  published label) need a `hiddenNote` saying where/when they appear. The
  step then shows centred with that note instead of breaking.
- If several copies of the control exist (one per flavour panel), the
  walkthrough rings the first one on screen.

## Tagging that happens by itself

- Entries added through Settings → System Updates are tagged on save by a
  best guess from their words (`guessAreas`); fix them on `/station-changes`
  (filter "Untagged").
- `POST /api/station-changes` accepts `paths` (files a commit or deploy
  touched) and guesses from those plus the words when `areas` is omitted;
  `POST /api/station-changes/guess` returns the guess without saving.
- The automatic weekly commit summary asks Claude to tag each item from the
  same area list (word guess as fallback). The meeting slide only falls
  back to it when no entries are tagged to a station or planning that week.

Improve the guess by editing `path_hints` / `word_hints` in `change_areas`
(a migration), not by adding names to code.
