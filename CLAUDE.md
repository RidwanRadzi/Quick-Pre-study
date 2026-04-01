# CLAUDE.md — Quick Pre Study

## Project Overview

**Quick Pre Study (QPS)** is a single-page web application for Malaysian real estate pre-acquisition analysis. It provides a 4-step wizard to evaluate property projects, runs financial calculations (breakeven, cashflow), and integrates with the Anthropic Claude API for AI-powered PSF estimates, area analysis, and layout suggestions.

**Live deployment**: Vercel  
**Version**: v3.0  
**Author**: Ridwan Radzi

---

## Repository Structure

```
Quick-Pre-study/
├── index.html        # Entire frontend app (~905 lines, vanilla HTML/CSS/JS)
├── api/
│   └── ai.js         # Vercel serverless function (legacy Google Gemini proxy — currently unused)
└── vercel.json       # Vercel deployment config (30s function timeout)
```

There is no `package.json`, no build step, and no npm dependencies. Everything runs as plain HTML in the browser.

---

## Technology Stack

- **Frontend**: Vanilla HTML, CSS (inline `<style>`), JavaScript (inline `<script>`)
- **AI**: Anthropic Claude Haiku 4.5 via direct browser API calls (header: `anthropic-dangerous-direct-browser-access`)
- **State**: Browser `localStorage` — key `qps_v2` (projects), `qps_key` (API key)
- **Deployment**: Vercel (static + serverless function)
- **No frameworks, no bundler, no transpiler**

---

## Architecture

### Single-File Frontend (`index.html`)

The entire app lives in one HTML file. It is structured as a single-page application (SPA) with multiple "pages" toggled by CSS `display` properties.

**Pages / Views:**
| Page ID | Description |
|---|---|
| `page-dashboard` | Project overview with count metrics |
| `page-projects` | Full project list |
| `page-new` | 4-step new study wizard |
| `page-cashflow` | Detailed cashflow projection |
| `page-tracker` | Sortable/exportable acquisition table |
| `page-settings` | API key configuration |

**Wizard Steps (`page-new`):**
| Step | ID | Content |
|---|---|---|
| 1 | `ss1` | Project info (code, state, developer, units, year, PSF) |
| 2 | `ss2` | Area study (transit, hubs, schools, demand, competitors) |
| 3 | `ss3` | Rental study (layout configs, financing params) |
| 4 | `ss4` | Verdict and explanation |

### Serverless Backend (`api/ai.js`)

A Vercel serverless function that proxies requests to Google Gemini. **This file is currently unused** — the frontend switched to direct Anthropic API calls in March 2026. It can be safely removed or repurposed for future server-side AI calls.

---

## Key JavaScript Functions

| Function | Purpose |
|---|---|
| `sp(id)` | Switch page (show/hide page divs) |
| `gs(n)` | Go to wizard step n |
| `v(id)` | Get input value by ID |
| `si(id, val)` | Set input value by ID |
| `pf(id)` | Parse float from input |
| `instalment()` | Calculate monthly amortized payment |
| `runCalc()` | Execute full financial calculations (BE, BTE, cashflow) |
| `savePrj()` | Save current project to localStorage |
| `exportCSV()` | Export tracker table as CSV download |
| `claude(prompt, sys, target)` | Call Anthropic API and render result into `target` element |
| `aiPSF()` | AI-powered PSF estimation |
| `aiArea()` | AI-powered area study prefill |
| `aiLayouts()` | AI-powered layout suggestions |
| `loadProjects()` | Render project list from localStorage |
| `openProject(code)` | Open a saved project for review |
| `deleteProject(code)` | Delete a project after confirmation |

---

## Data Model

Projects are stored as an array in `localStorage['qps_v2']`. Each project object:

```javascript
{
  code,       // Short code, e.g. "TPR"
  state,      // Malaysian state name
  dev,        // Developer name
  proj,       // Project name
  units,      // Total units (number)
  year,       // Expected completion year
  mpsf,       // Market PSF (RM)
  apsf,       // Asking PSF (RM)
  verdict,    // "Possible" | "Less Possible" | "Not Viable"
  exp,        // Explanation/notes text
  transit,    // Nearest transit station
  hub,        // Nearest commercial hub
  demand,     // Demand level: "High" | "Medium" | "Low"
  notes,      // Area study notes
  rentalOpts, // Comma-separated layout options string
  layouts,    // Array of layout objects with financial data
  beL,        // Breakeven summary string
  bteL,       // Best-to-enter summary string
  pBE,        // BE price per layout (array)
  pBTE,       // BTE price per layout (array)
  iBE,        // Monthly instalment at BE per layout (array)
  tenure,     // Loan tenure (years)
  rate,       // Interest rate (%)
  maint,      // Monthly maintenance fee (RM)
  sink,       // Monthly sinking fund (RM)
  date        // Created date (ISO string)
}
```

---

## Financial Calculation Logic

### Breakeven (BE) Price
Derived from rental income minus maintenance costs, working backward to find the unit price at which net cashflow is neutral.

### Best-to-Enter (BTE) Price
`BTE = BE × 0.85` — a 15% safety margin below breakeven.

### Monthly Instalment
Standard amortization formula:
```
P × r × (1+r)^n / ((1+r)^n - 1)
```
Where `P` = principal, `r` = monthly rate, `n` = total payments.

---

## CSS Design System

All CSS is inline in `index.html`. Key conventions:

**CSS Variables (`:root`):**
| Variable | Value | Use |
|---|---|---|
| `--accent` | `#1D9E75` | Primary green (positive/confirm) |
| `--purple` | `#534AB7` | AI feature buttons |
| `--warn` | `#BA7517` | Warning/amber state |
| `--danger` | `#A32D2D` | Danger/negative state |

**Common Classes:**
- `.btn`, `.btn-primary`, `.btn-ai` — button variants
- `.card` — content card container
- `.modal` — overlay modals
- `.g2`, `.g3`, `.g4` — CSS grid columns
- `.green`, `.amber`, `.red` — status text colors
- `.b-green`, `.b-amber`, `.b-red` — status badge backgrounds

**Naming Conventions:**
- Input IDs prefixed with `s-`: `s-code`, `s-proj`, `s-state`
- Page container IDs: `page-*`
- Wizard step IDs: `ss1`, `ss2`, `ss3`, `ss4`
- AI result containers: `ai-psf`, `ai-area`, `ai-lyt`
- Dashboard metrics: `d-total`, `d-pos`, `d-lp`, `d-nv`

---

## AI Integration

All AI calls go through the `claude()` function:

```javascript
async function claude(prompt, systemPrompt, targetElementId)
```

- Uses `claude-haiku-4-5` model
- Requires user-provided Anthropic API key stored in `localStorage['qps_key']`
- Sets `anthropic-dangerous-direct-browser-access: true` header for browser use
- Temperature: 0.3 for consistent/factual outputs
- Renders streamed response into `targetElementId`

**Three AI features:**
1. **PSF Estimate** (`aiPSF`): Estimates market PSF based on state, project name, developer
2. **Area Study** (`aiArea`): Suggests transit, hubs, demand level based on project location
3. **Layout Suggestions** (`aiLayouts`): Suggests typical unit layouts/sizes for the area

---

## URL Prefill (Telegram Bot Integration)

The app supports prefilling the new study form via URL parameters, enabling a Telegram bot to populate data automatically:

```
?proj=ProjectName&dev=DeveloperName&units=500&year=2028&state=Selangor
```

After prefill, the URL is cleaned with `history.replaceState()` to prevent re-triggering on page reload. A banner is shown to indicate the data was sourced from Telegram.

---

## Development Workflow

### Making Changes

1. Edit `index.html` directly — all frontend code is in this file
2. Test in a browser (no build step needed)
3. Commit and push to `claude/add-claude-documentation-UmdC6` branch

### Running Locally

Open `index.html` directly in a browser, or use a simple static server:

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

For API calls to work locally, set your Anthropic API key in the Settings page of the app.

### Deployment

Push to the repository — Vercel auto-deploys from the configured branch. No build command is needed (static file served directly).

### Environment Variables (Vercel)

| Variable | Used By | Status |
|---|---|---|
| `GOOGLE_API_KEY` | `api/ai.js` | Legacy — unused since frontend switched to Anthropic |

---

## Key Conventions for AI Assistants

1. **Do not introduce a build system or package manager** unless explicitly requested. The no-dependency approach is intentional.

2. **All frontend changes go in `index.html`** — do not split into separate JS/CSS files unless the user requests a refactor.

3. **The `api/ai.js` file is legacy** — do not modify it for AI features. All AI calls use the client-side `claude()` function.

4. **Preserve the short utility function names** (`sp`, `gs`, `v`, `si`, `pf`) — they are used throughout event handlers in HTML attributes.

5. **localStorage schema** — use `qps_v2` for the projects array and `qps_key` for the API key. Do not change these keys without migrating existing data.

6. **Financial formulas** — any changes to `instalment()`, `runCalc()`, or BE/BTE logic must be validated against the standard amortization formula. Incorrect calculations would mislead real estate investment decisions.

7. **API key security** — the app stores the Anthropic API key in localStorage. Do not log it, expose it in URLs, or send it to any backend other than `api.anthropic.com`.

8. **Malaysian context** — the app is specific to Malaysia. States, PSF (price per square foot), Malaysian ringgit (RM), and Malaysian real estate terminology are intentional.

9. **CSS is inline** — all styles live in the `<style>` block within `index.html`. Maintain the existing CSS variable system when adding new UI elements.

10. **No accessibility regression** — maintain at minimum the existing level of keyboard navigation and labeling when modifying forms.

---

## Known Technical Debt

- `api/ai.js` is unused but still deployed — can be removed
- 905-line single HTML file will become hard to maintain at scale
- No automated tests — all testing is manual in-browser
- API key stored in browser localStorage (acceptable for single-user personal tool)
- No error retry logic for failed AI API calls
- Limited to localStorage capacity (~5-10 MB); would fail with large numbers of projects
