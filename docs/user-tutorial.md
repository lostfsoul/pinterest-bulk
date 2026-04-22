# Pinterest Pin Tool - User Tutorial

## 1. What This Tool Does
This tool helps you generate Pinterest-ready pin drafts from your website pages, render pin images using your templates, schedule posts, and export CSV files for publishing.

Main flow:
1. Connect/select a website.
2. Configure visual style in **Playground**.
3. Select which pages are active in **Pages**.
4. Configure AI/keywords/workflow rules in **Settings**.
5. Generate pins from **Calendar (Generate)**.
6. Export final CSV from **Export**.

---

## 2. App Sections Overview

### Playground
Use this as your visual sandbox:
- Pick templates
- Pick fonts and color
- Preview how pins will look
- Adjust title size/spacing behavior
- Save draft style settings for generation

### Pages
Control which URLs are used for pin generation:
- Enable/disable pages
- Filter/search pages
- Keep a focused set of pages for generation

### Settings
Contains three tabs:
- **AI**: title/description prompt behavior and model defaults
- **Keywords**: keyword import + trend keywords
- **Workflow**: scheduling window, posting distribution, generation constraints

### Calendar (Generate)
Operational generation page:
- Start manual generation
- Watch progress
- Review generated pin drafts
- Regenerate when needed

### Export
Export ready data for publishing:
- Exports rendered pins to CSV
- Uses existing rendered media (strict mode)

---

## 3. End-to-End Setup (Recommended)

## Step 1: Select Active Website
1. Use website switcher in the app shell.
2. Confirm the active website indicator updates.
3. All sections should now scope to this website.

## Step 2: Configure Playground
1. Open **Playground**.
2. Choose a page to preview.
3. Select templates to use.
4. Pick font and font color.
5. Tune title controls:
   - **Title Size**: global scale multiplier
   - **Title Side Padding**: left/right safe margin
   - **Line Spacing**: distance between title lines
6. Optionally upload:
   - Template SVG
   - Custom font file
7. Click **Save Draft**.

Notes:
- Preview tries to match final generation behavior.
- If no page images are available, preview quality can be limited.

## Step 3: Configure Pages
1. Open **Pages**.
2. Enable pages you want included in generation.
3. Disable irrelevant pages.

Important behavior:
- Generation always evaluates currently enabled pages.
- Existing page pins are updated, not endlessly duplicated.

## Step 4: Configure Settings
Open **Settings** and review each tab:

### AI tab
- Controls how titles/descriptions/board suggestions are generated.
- Prompt style + custom prompt influence generated text.
- Language affects generation language.

### Keywords tab
- Upload keyword CSV for page mapping.
- Upload trend keyword CSV for ranking/priority workflows.
- Use preview to inspect keyword-to-page matching quality.

### Workflow tab
Defines generation/scheduling behavior:
- Daily pin count
- Scheduling window (days ahead)
- Floating day counts (variation)
- Floating start/end times (humanized schedule)
- Desired gap between same URL usage
- Lifetime/monthly limits per URL
- Auto-regeneration threshold

## Step 5: Generate Pins
1. Go to **Calendar (Generate)**.
2. Click **Generate next batch**.
3. Watch job progress in the global status banner.
4. Wait until completed.

## Step 6: Export
1. Open **Export**.
2. Export CSV for your target website.

Export note (current behavior):
- Strict mode: export uses already-rendered media files.
- It does not re-render during export.

---

## 4. Playground Settings Reference

### Select Page
- Chooses preview context (title, description, images).
- Helps you validate template look before bulk generation.

### AI Content Generation
- **Prompt Style**: pre-defined content tone strategy.
- **Custom Prompt**: custom instructions used for AI content generation.
- **Language**: output language for generated preview content.
- **Generate AI Content button**: fills preview metadata fields.

### Design Customization
- **Fonts**: choose active title font set.
- **Font color**: title color.
- **Templates**: select allowed templates and default template.

### Title Controls
- **Title Size (%)**
  - Scales fitted title size up/down.
- **Title Side Padding (px)**
  - Keeps text away from left/right edge of text zone.
  - Higher value = safer margins, potentially smaller text.
- **Line Spacing (x)**
  - Controls space between title lines.
  - Higher value = more vertical air, potentially smaller font.

### Image Settings
- Controls image filtering for preview and generation, including:
- minimum width/height filtering
- orientation constraints
- image limit per page

### Display & Advanced
- Visual/validation behavior toggles.

---

## 5. Workflow Settings Reference

### Scheduling Window
How far ahead pins are scheduled.

### Floating Days
Randomizes daily pin count around the base value for natural variation.

### Floating Start/End Hours
Randomizes start/end windows so posting times are less robotic.

### Desired Gap Days
Prevents reusing the same URL too soon.

### Lifetime/Monthly Limits
Hard limits for how often the same URL can be used.

### Auto Regeneration
Automatically queues generation when schedule buffer approaches threshold.

---

## 6. Generation Behavior (Important)

When you click generate:
1. Tool reads enabled pages for active website.
2. For each page:
   - selects image(s)
   - generates/updates title + description + board
   - applies Playground render settings (template/font/color/spacing)
3. Existing page draft is updated; stale extra drafts are removed.
4. Images are rendered to PNG.

If you had 10 enabled pages, then enabled 1 more and run again:
- It evaluates all 11 enabled pages.
- Existing pages are updated according to current rules.
- New page gets its first draft.
- Some pages may be skipped if blocked by gap/limit constraints.

---

## 7. Troubleshooting

### "Generation already running"
- Wait for current job to finish or fail.
- Check global progress banner.

### "No pins were generated"
Common causes:
- desired gap days blocked all pages
- no valid images after filters
- limits (lifetime/monthly) reached

### Font not applied in preview/generation
- Ensure font exists in uploaded fonts.
- Re-select font in Playground and save draft.
- Re-run generation so new render settings are applied.

### Preview looks fine but output differs
- Save Playground draft first.
- Re-generate pins after setting changes.
- Confirm active website is correct.

---

## 8. Best Practices
1. Keep a small set of high-quality templates.
2. Use realistic side padding and line spacing to avoid text overflow.
3. Keep desired gap days > 0 to avoid repetitive URLs.
4. Run generation in batches and review before export.
5. Update trend keywords periodically.

---

## 9. Quick Checklist Before Production
- Active website selected
- Templates selected + default template set
- Font/color/spacing saved in Playground
- Target pages enabled
- Workflow limits reviewed
- Generate completed successfully
- CSV exported

