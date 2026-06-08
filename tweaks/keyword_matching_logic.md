# Keyword Matching & Content Scheduling Logic

## Overview

When generating a schedule (e.g. for April), the system matches article titles against trend keywords in three sequential passes. Articles matched in an earlier pass are removed from the pool before the next pass runs.

---

## Step 1 — Exclude recently scheduled articles

Before any matching begins, remove all articles that were scheduled within the last **31 days**. Only the remaining articles proceed to keyword matching.

> Example: 300 articles → 100 excluded → **200 eligible**

---

## Step 2 — Three-pass keyword matching

Passes run in strict priority order. An article matched in Pass 1 will never appear in Pass 2 or 3.

### Pass 1 — Month (highest priority)

- `period_type = month`, `period_value = april`
- Example keyword: **"Cheesy Chicken Pasta"**

| Match type | Example title | Result |
|---|---|---|
| 3-word (any order) | "Cheesy Chicken Pasta Bake" | Strong match |
| 3-word (reversed) | "Pasta with Cheesy Chicken" | Strong match |
| 2-word | "One-pot Chicken Pasta" | Valid, lower score |
| 2-word | "Cheesy Pasta Salad" | Valid, lower score |
| 1-word only | "The Best Pasta Shapes" | **Rejected** |

---

### Pass 2 — Season (mid priority)

- `period_type = season`, `period_value = spring`
- Example keyword: **"Banana Bread Muffins"**
- Runs on articles **not matched** in Pass 1

| Match type | Example title | Result |
|---|---|---|
| 3-word (any order) | "Mini Banana Bread Muffins" | Strong match |
| 3-word (reversed) | "Muffins with Banana Bread" | Strong match |
| 2-word | "Banana Bread Loaf" | Valid, lower score |
| 2-word | "Banana Muffin Tops Recipe" | Valid, lower score |
| 1-word only | "How to ripen a Banana" | **Rejected** |

---

### Pass 3 — Evergreen (automatic fallback)

- **No CSV row needed** — this is not a `period_type`
- Any article that scored 0 or 1 keyword matches across both Pass 1 and Pass 2 automatically becomes evergreen
- These articles can be scheduled on any date

> Example: "Easy Weeknight Dinners" → 0 keywords matched → auto evergreen  
> Example: "The Best Pasta Shapes" → only matched "Pasta" (1 word) → rejected from Pass 1, falls to evergreen

---

## Matching rules

- **Minimum match: 2 keywords** — a single-word hit is never enough to qualify
- **Word order doesn't matter** — all words from the keyword phrase must appear anywhere in the title
- **Extra words are fine** — "Easy Banana Bread Muffin Tops" still matches "Banana Bread Muffins"
- **3-word match > 2-word match** in score, but both are valid and get scheduled

---

## CSV structure

```csv
keyword,period_type,period_value,weight
Cheesy Chicken Pasta,month,april,2
Banana Bread Muffins,season,spring,1.4
```

- `weight` can be used to rank candidates when multiple matches compete for the same slot
- No `always` / evergreen rows needed — the fallback is handled automatically by the engine
