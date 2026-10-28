# ARCHITECTURE — AI OS — Tavlor (public read-only boards dashboard)

One subject: how the public dashboard is built, what data contract it consumes, and
where the parts that are NOT in this repo live. Every claim below was re-checked against
the tracked files in this checkout at the 2026-10-27 docs sync, unless marked UNVERIFIED.

## Model: a static snapshot, no backend

- The page is a **static site**: `index.html` + `static/css/app.css` + seven JS files
  (the render lib's six plain-script concern files + the `app.js` shell).
  No build step, no framework, no package.json (verified: `git ls-files`).
- The browser issues exactly **one** network request: `fetch('boards.json')`
  (`static/js/app.js:15` `SNAPSHOT_URL`, `app.js:125`). No API call, no token anywhere
  in the repo or the page. The earlier live proxy (and its path-traversal bug) was
  removed entirely (commit `1ee94f1` deleted `app/` and `serve/`).
- `app.js` re-fetches every **60 s** (`POLL_MS = 60000`, `app.js:16`; `setInterval` at
  `app.js:143`); the page just re-renders from the fresh static file.
- If `boards.json` is missing or invalid, `app.js` sets `state.error` and the page renders
  a graceful Swedish error + "Ingen data." instead of a blank page (exercised in the
  browser during the 2026-09-26 audit: HTTP 404 and invalid JSON both degrade gracefully).
  A malformed-but-valid body is caught the same way: `load()` runs `validateEnvelope()`
  once before any render call (MC 11525 row #7), so every violation lands on that error
  path — never a raw engine error in the panel.

## Module map

| File | Concern |
|---|---|
| `index.html` | Static shell: topbar, board pills (orchestrator/svarkor), 4 tabs (projekt/beroenden/ko/verifiering), meta bar, panel bodies. Deep links `?board=` / `?tab=` are read by app.js. |
| `static/js/app.js` | Shell ONLY: fetch + 60 s poll, one-shot envelope validation (`validateEnvelope`), board switch, tab switch, deep-link sync, error wiring. Holds no markup — the meta strip / error / loading strings live in the render lib (MC 11525 Wave C1c, audit row #18). |
| `static/js/render-core.js` | Render lib, load 1st: status vocabulary (`STATUS` map = the only status→tone table), verification-state vocabulary, the shared chips/badge/section primitives, and the shell builders `metaHTML` / `errorHTML` / `renderErrorHTML` / `loadingHTML`. |
| `static/js/render-data.js` | Plain-data analysis: `buildTree`, `groupByProject`, `projectProgress`, `queueNext`, `verificationTail`, `dependencyEdges`. No HTML. |
| `static/js/render-projects.js` | The "Projekt" tab: task-node trees inside project cards. |
| `static/js/render-queue.js` | The "Kö" tab: queue row lists (näst på tur / pågår / väntar / blockerade). |
| `static/js/render-verify.js` | The "Verifiering" tab: the three-state legend + the capped verification tails. |
| `static/js/render-deps.js` | The "Beroenden" tab: dependency edge list + the layered SVG DAG (`svgGraph`). |
| `static/css/app.css` | Mobile-first styles. ONE status-tone family maps tone→colour (`var(--tone)`); the four families (.chip/.node/.row/.gnode) are consumers — a new status = one STATUS row + (new colour only) one CSS line. SVG graph styling. |
| `tests/render.test.js` | `node --test` suite for the pure render logic, requiring the REAL six `../static/js/render-*.js` concern files in index.html load order (merged). Run with `node --test tests/render.test.js` (the directory form `node --test tests/` fails on Node v22 — ERR_UNSUPPORTED_DIR_IMPORT). |

The six render files are plain scripts: in the browser each extends the ONE
`window.Aos.render` namespace (assembly order = the `<script>` order in
`index.html`, `render-core.js` first, `render-verify.js` after `render-queue.js`
whose row lists it reuses); under node each is a CommonJS module whose exports
merge into the same surface. No network calls, no state. Unit-tested.
| `hosting.yaml` | vm106 static hosting manifest (`type: static`, root `.`). |

## boards.json contract (what the shipped code actually requires)

Envelope: `generated_at` (timestamp string, read by `metaHTML` in render-core.js:127)
and `boards[]`, each board with `id`, `label`, `hidden_count`, `task_count`,
`tasks[]` (board picked by `boardById`, app.js:21; counts shown by `metaHTML`).

Per task (consumed by the render lib): `display_id`, `parent_id`, `status`, `project_slug`,
`seat`, `title`, `released`, `after[]`, `onfail[]`, `cycles`, and `verifiable` — the
emitter-stamped structural flag that drives the honest three-way verification split
(`isVerifiable()` / `verifyState()` in render-core.js:69-77; a `completed_unverified` card without
it counts as unverifiable).

The emitter never reads or emits `prompt / result_summary / result_payload / deploy_log /
gate_criteria / model_policy / workdir / acceptance / deploy_spec / notes`, excludes whole
sensitive projects (only an aggregate "N dolda (känsliga)" count is published) and scrubs
titles through `infra/secret_scan.sh`. **That enforcement lives in the emitter, which is
OUTSIDE this repo** — the canonical emitter toolchain (`mc-boards-snapshot.py`,
`validate-hosting.py`, `infra/secret_scan.sh`) is in the agent-town tree on **VM350**
(`/home/claudecode/agent-town-wt/runner-capacity/infra/vm106/repo-visibility-hosting/`).
A stale/partial agent-town copy on other hosts (e.g. the vm105 checkout) may contain only
`minors-denylist.txt` and lack the files. UNVERIFIED from this repo alone: the emitter's
current field list beyond what the code above requires.

## Status vocabulary (render-core.js:33-47)

The ten REAL board statuses, with Swedish labels and done-flags:

`queued` (I kö) · `claimed` (Tilldelad) · `running` (Pågår) · `blocked` (Blockerad) ·
`waiting_approval` (Väntar godkänn.) · `owner_approved` (Godkänd, done) ·
`completed_unverified` (Klar (overif.), done) · `verified` (Verifierad, done) ·
`deployed` (Driftsatt, done) · `cancelled` (Avbruten, done).

There is no `pending` (the test suite asserts `statusMeta('pending')` falls back to
default). render-core.js also carries three **defensive extras** — `onfail`, `failed`,
`completed` (render-core.js:44-46) — so an unexpected status still renders with a sane tone
instead of falling through to "okänd". The tone each status maps to is the ONE status→tone
table the CSS reads via `var(--tone)` (app.css tone family; audit row #17 closed by MC 11525 C1b).

## Queue-next rule (render-data.js:73-101)

A task is "näst på tur" (actionable) when it is `queued`, all its `[after:]` targets have
reached a done state (unknown/pruned deps do not block), and it is `released` — required
unconditionally, dep-free or not (render-data.js:84, aligned to the README contract by commit
`10ec288`). `queueNext` also
returns `inflight` (claimed/running), `waiting` (queued but not actionable — unfinished
`[after:]` targets OR not yet released; MC 11525 row #6 decision: queued+unreleased+deps-done
shows in waiting, never invisible) and `gated` (blocked / waiting_approval).

## Verification tail (render-data.js:103-113)

`completed_unverified` is split honestly three ways using `verifiable`:
**pending** (has an acceptance bar, awaiting 2x-verify), **unverifiable** (no bar — the
verifier refuses it until a bar is derived), **verified** (`verified`/`deployed`).
`cancelled` is listed separately. The two long tails are capped (verified 60, cancelled
40) and the cap is disclosed in the heading whenever it bites (`cappedTitle`,
render-verify.js:36-45).

## Dependency graph (render-data.js:116-128, render-deps.js:16-107)

`[after:]` and `[onfail:]` tags arrive pre-parsed as `after[]`/`onfail[]` arrays;
`dependencyEdges()` emits one edge per tag, and a dep pointing outside the board is
simply shown as-is in the edge list (its raw from-id, unmarked) while `svgGraph` omits
it, since the graph draws on-board nodes only. `svgGraph` layers nodes by longest
after-chain depth and draws both edge kinds as an SVG DAG; the edge
list is unit-tested, the SVG layout itself has no direct test (audit note).

## Out of scope of this repo

The emitter, the hosting validator and the secret scan are VM350-side (agent-town tree,
path above). `boards.json` itself is gitignored — it is written into the served web root
by the emitter (atomic ssh write to vm106 in production), never committed.
