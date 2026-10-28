# AI OS — Tavlor (publik läs-vy)

A **public, read-only** dashboard that visualises the fleet Mission Control board as one page:

- **Orkestrator** (:8310) — the one board the product serves today; the toggle switches
  between the boards the current `boards.json` carries.
- Per-project **task trees** (parent → child) with status colours and a workflow
  progress bar (what's done / what's left).
- The **dependency graph**: `[after:]` (efter) and `[onfail:]` (vid fel) edges parsed from
  task titles, drawn as a layered DAG plus an edge list, with `[cycles:]` shown per node.
- **Queue-next** using the REAL board status vocabulary (`queued / claimed / running /
  blocked / waiting_approval / owner_approved / completed_unverified / verified / deployed /
  cancelled` — there is no `pending`): a task is "näst på tur" only when it is `queued`,
  `[released]`, and all its `[after:]` targets have reached a done state.
- The **verification tail**: `completed_unverified → verified/deployed` and `cancelled`.
- **Mobile-first**, responsive, no build step, no framework.

## Architecture — a static snapshot, no live proxy, no token in the browser

The page is a **static site**. It polls ONE static file, `boards.json`, and nothing else.
There is **no backend, no API call from the browser, and no token anywhere in the repo or
the page** — the earlier live-proxy (and its path-traversal bug) has been removed entirely.

`boards.json` is produced **server-side on VM350** by an orchestrator-managed emitter
(`infra/vm106/repo-visibility-hosting/mc-boards-snapshot.py` in the agent-town tree, NOT in
this repo). **Canonical location:** the agent-town tree on **VM350**
(`/home/claudecode/agent-town-wt/runner-capacity/infra/vm106/repo-visibility-hosting/`).
A stale or partial copy of the agent-town tree on other hosts (e.g. the vm105 checkout)
may contain only `minors-denylist.txt` and lack the emitter, the validator and
`infra/secret_scan.sh` — if the files are missing, you are on a stale copy; the VM350
tree is the source of truth. The emitter reads both boards under the VM350 admin tokens,
then scrubs defense-in-depth before anything is written:

1. **Excludes** whole sensitive projects (skola / np / sensor + the minors-denylist) — only
   an aggregate "N dolda (känsliga)" count is published, zero detail.
2. **Scrubs titles** through `infra/secret_scan.sh` (a tripped title is redacted to a generic
   label but the node still renders with its id / status / edges) and masks hostnames / IPs /
   file-paths / ports inline.
3. Carries **ONLY** the safe fields. Per task: `display_id, parent_id, status, project_slug,
   seat, after/onfail/cycles edges, released, timestamps, scrubbed title, verifiable`
   (the emitter-stamped structural verifiability flag, `isVerifiable()` / `verifyState()`
   in render-core.js). Envelope:
   `generated_at`, and per board `id, label, hidden_count, task_count` (read by
   `boardById` in app.js and `metaHTML` in render-core.js).
   It never reads or emits `prompt / result_summary / result_payload / deploy_log /
   gate_criteria / model_policy / workdir / acceptance / deploy_spec / notes` — that
   exclusion is enforced by the emitter, which lives outside this repo.

The emitter writes `boards.json` into the served web root (LOCAL file for tests; atomic ssh
write to vm106 in production — the same pattern as the portfolio's `hosted-index.json`
sidecar). A cron/timer on VM350 refreshes it; the public page just re-fetches it.

## Files

```
index.html            static shell (root — required for a static app)
static/css/app.css     mobile-first styles + one status-tone family + SVG graph
static/js/render-core.js   vocabulary + shared chips/primitives + shell builders (load 1st)
static/js/render-data.js   tree / grouping / progress / queue / verification / edges
static/js/render-projects.js  "Projekt" tab: task trees in project cards
static/js/render-queue.js  "Kö" tab: queue row lists
static/js/render-verify.js "Verifiering" tab: three-state legend + capped tails
static/js/render-deps.js   "Beroenden" tab: edge list + layered SVG DAG
static/js/app.js        shell: fetch boards.json, board switch, tab switch, poll
                         (the six render-*.js plain scripts assemble window.Aos.render
                          in index.html load order, before app.js — unit-tested under node)
hosting.yaml            vm106 hosting manifest (type: static)
tests/render.test.js    node --test suite for the pure render logic
docs/ARCHITECTURE.md    the architecture doc kept true (static snapshot model, contracts)
```

## Run / verify locally

```bash
# 1) emit a scrubbed snapshot next to index.html (needs VM350 admin tokens; the
#    emitter lives in the CANONICAL agent-town tree on VM350 — a stale vm105 copy
#    may not have it, see Architecture above):
BOARDS_SNAPSHOT_LOCAL=$PWD/boards.json \
  python3 /path/to/agent-town/infra/vm106/repo-visibility-hosting/mc-boards-snapshot.py

# 2) serve the static site and open it:
python3 -m http.server 8391   # -> http://127.0.0.1:8391/  (?board=svarkor&tab=beroenden)

# 3) tests + hosting validation (note: pass the test FILE, not the directory —
#    `node --test tests/` fails on Node v22 with ERR_UNSUPPORTED_DIR_IMPORT):
node --test tests/render.test.js
python3 /path/to/agent-town/infra/vm106/repo-visibility-hosting/validate-hosting.py .
```

## Repo

`github.com/bryn1/ai-os` — `main` must always be the latest working, truthful state.
