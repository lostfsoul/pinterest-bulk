# Simple Guide: Scheduling Window, Auto-Regeneration, and Trend Ranking

This guide explains two parts of the system in non-technical language:

1. How **Scheduling Window + Auto-Regeneration** works  
2. How **Trend Keywords Ranking** works (with 160-page examples)

---

## 1) Scheduling Window + Auto-Regeneration (Plain English)

### Think of it like a “pin inventory target”

You set:

- `daily_pin_count` (example: 5 pins/day)
- `pin_scheduling_window_days` (example: 30 days)

The system calculates a target inventory:

- **Target queued pins = daily_pin_count × window_days**
- Example: `5 × 30 = 150 pins`

If **auto_regeneration_enabled = true**, the app tries to keep your queue near this target.

### What is counted in the queue?

For each website, it counts pins that are:

- selected (approved), and
- unscheduled or scheduled for now/future

So if you already have enough approved future pins, you do not need more right now.

### What happens during generation?

- If queue is below target: generation fills the gap.
- If queue is already at/above target: generation does a **clean no-op** (no error, just no new pins needed).

---

## 2) Scheduling Examples

### Example A: Need refill

- Daily count: 5
- Window days: 30
- Target: 150
- Current approved queued pins: 110

Result:

- Remaining capacity = 40
- Generation can create about 40 new pins (subject to normal content/image limits).

### Example B: Already full

- Daily count: 5
- Window days: 30
- Target: 150
- Current approved queued pins: 150

Result:

- Remaining capacity = 0
- Generation runs but creates 0 new pins (no failure).

### Example C: Auto-regeneration OFF

- Same numbers, but `auto_regeneration_enabled = false`

Result:

- Window cap is ignored.
- Generation is controlled only by your normal filters/rules.

---

## 3) Trend Keywords Ranking (What it does)

Trend ranking decides **which pages are more relevant right now** before pins are generated.

It scores pages using text from:

- page title
- page section/category
- page URL slug
- SEO keywords

It compares that text against your active trend keywords.

### Active trend keywords

A trend keyword can be:

- `always` (always active)
- `month` (only active this month)
- `season` (only active this season)

Each keyword also has a `weight` (importance).

---

## 4) Trend Ranking Controls (What each one means)

### `top_n`

Maximum number of ranked pages to keep.

- `top_n = 0` means “no limit” (keep all selected pages)
- `top_n = 40` means keep up to 40 best pages

### `similarity_threshold`

Minimum score filter (0.0 to 1.0).

Important behavior:

- If enough pages pass threshold, those are used.
- If too few pages pass threshold, system falls back to broader ranked pool so it can still fill `top_n`.

### `diversity_enabled` + `diversity_penalty`

When enabled, system avoids picking many very similar pages by penalizing near-duplicates.

### `semantic_enabled`

Currently this is a placeholder path; in normal setup it behaves like lexical ranking only.

---

## 5) 160-Page Scenarios (Easy Examples)

### Scenario 1: No active trends right now

- 160 pages selected
- Trend keywords exist, but none are active for current month/season

Result:

- No trend filtering applied
- All 160 pages remain candidates

### Scenario 2: Strong trend focus

- 160 pages selected
- `top_n = 50`
- Active keywords: “summer decor”, “patio”, “garden lighting”

Result:

- Pages are scored by trend relevance
- Best ~50 pages are kept for generation preview/generation flow

### Scenario 3: Threshold + diversity

- 160 pages selected
- `top_n = 60`
- `similarity_threshold = 0.35`
- `diversity_enabled = true`

Result:

- Prefer pages above threshold
- If fewer than 60 pass threshold, system can still include lower-scored pages to reach volume
- Diversity reduces repeating very similar page clusters

---

## 6) “How long does ranking take for 160 pages?”

Short answer: **ranking itself is usually quick**.

- Trend ranking is local text scoring logic.
- For 160 pages, ranking is typically fast (often much less than total generation time).

What usually takes longer than ranking:

- image availability/filtering checks
- rendering pin images
- any scraping/render pipeline work

So for non-technical planning:

- Treat ranking time as small.
- Treat image/render workflow as the main time cost.

---

## 7) Practical Setup Recommendation

If you want stable “always full queue” behavior:

1. Turn on `auto_regeneration_enabled`.
2. Set realistic `daily_pin_count`.
3. Set `pin_scheduling_window_days` to how far ahead you want inventory.
4. Use trend `top_n` to control focus (for example 30–80), not `0`, if you want stronger topic prioritization.

