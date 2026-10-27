// ============================================================================
// render.js — pure rendering logic for the AI OS boards dashboard.
// ============================================================================
// SIZE reason: 43x L — over the 400 gate; Wave C splits this file by concern (audit row #16).
// SINGLE CONCERN: turn the server-side scrubbed snapshot (boards.json) into HTML.
// It is a PURE, DOM-free library: every function takes plain data and returns a
// string or a plain object, so the whole surface is CommonJS-requireable under
// `node --test` AND usable directly in the browser (window.Aos.render). It makes
// NO network calls and holds NO state — app.js owns fetch/poll/DOM/board-switch.
//
// The snapshot is already scrubbed on the server (mc-boards-snapshot.py): no
// tokens, no prompts, no result/deploy fields, sensitive projects excluded, titles
// masked/redacted, and the [after:]/[onfail:]/[cycles:]/[seat:] tags already parsed
// into structured fields. This module only VISUALISES that safe data.
//
// Reuses the sound concepts from svarkor's original render modules: parent_id
// tree-building (render-fanout.buildTree), project grouping (render-grouping
// .groupByProject), the four-states floor, escapeHtml, and the Swedish copy.
// ============================================================================
(function () {
'use strict';

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- status vocabulary (the REAL board vocab, not the fictional pending/done) ----
// tone drives the colour; label is the Swedish display; done = terminal-enough that a
// dependent [after:] target counts as satisfied.
var STATUS = {
  queued:               { tone: 'queued',   label: 'I kö',            done: false },
  claimed:              { tone: 'running',   label: 'Tilldelad',       done: false },
  running:              { tone: 'running',   label: 'Pågår',           done: false },
  blocked:              { tone: 'blocked',   label: 'Blockerad',       done: false },
  waiting_approval:     { tone: 'approval',  label: 'Väntar godkänn.', done: false },
  owner_approved:       { tone: 'approval',  label: 'Godkänd',         done: true  },
  completed_unverified: { tone: 'unverified',label: 'Klar (overif.)',  done: true  },
  verified:             { tone: 'verified',  label: 'Verifierad',      done: true  },
  deployed:             { tone: 'deployed',  label: 'Driftsatt',       done: true  },
  cancelled:            { tone: 'cancelled', label: 'Avbruten',        done: true  },
  onfail:               { tone: 'blocked',   label: 'Fel-gren',        done: false },
  failed:               { tone: 'blocked',   label: 'Misslyckad',      done: false },
  completed:            { tone: 'verified',  label: 'Klar',            done: true  }
};

function statusMeta(status) {
  return STATUS[status] || { tone: 'default', label: status || 'okänd', done: false };
}
function statusTone(status) { return statusMeta(status).tone; }
function statusLabel(status) { return statusMeta(status).label; }
function isDone(status) { return statusMeta(status).done; }
// "actively delivering value" = not cancelled and reached a done state (progress).
function isProgress(status) { return isDone(status) && status !== 'cancelled'; }

// ---- tree building (reuse render-fanout.buildTree; keyed on display_id now) ----
// Roots = tasks whose parent_id is empty or points outside this board's task set.
function buildTree(tasks) {
  var arr = Array.isArray(tasks) ? tasks : [];
  var nodes = Object.create(null); // proto-key-proof: display_id/parent_id are external data (MC 11525 row #5)
  arr.forEach(function (t) { nodes[String(t.display_id)] = { task: t, children: [] }; });
  var roots = [];
  arr.forEach(function (t) {
    var pid = t && t.parent_id != null && t.parent_id !== '' ? String(t.parent_id) : null;
    if (pid && nodes[pid] && pid !== String(t.display_id)) {
      nodes[pid].children.push(nodes[String(t.display_id)]);
    } else {
      roots.push(nodes[String(t.display_id)]);
    }
  });
  // stable, human order: by display_id numerically where possible
  var cmp = function (a, b) { return dispKey(a.task.display_id) - dispKey(b.task.display_id) ||
                                     String(a.task.display_id).localeCompare(String(b.task.display_id)); };
  roots.sort(cmp);
  Object.keys(nodes).forEach(function (k) { nodes[k].children.sort(cmp); });
  return roots;
}
function dispKey(d) {
  var m = /^(\d+)(?:\.(\d+))?/.exec(String(d || ''));
  return m ? (parseInt(m[1], 10) * 1000 + (m[2] ? parseInt(m[2], 10) : 0)) : Number.MAX_SAFE_INTEGER;
}

// ---- project grouping (reuse render-grouping.groupByProject) ----
var UNLINKED = '(ej kopplade)';
function groupByProject(tasks) {
  var map = Object.create(null); // proto-key-proof: project_slug is external data (MC 11525 row #5)
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    var key = t && t.project_slug ? String(t.project_slug) : UNLINKED;
    (map[key] = map[key] || []).push(t);
  });
  return map;
}

// where a project is in its workflow: progress = done-and-not-cancelled / (total - cancelled)
function projectProgress(tasks) {
  var arr = Array.isArray(tasks) ? tasks : [];
  var active = arr.filter(function (t) { return t.status !== 'cancelled'; });
  var done = active.filter(function (t) { return isProgress(t.status); });
  return {
    total: arr.length,
    active: active.length,
    done: done.length,
    cancelled: arr.length - active.length,
    pct: active.length ? Math.round((done.length / active.length) * 100) : 0
  };
}

// ---- queue-next (REAL semantics): a queued task whose [after:] targets are all done ----
// released-gated + after-terminal. Also surfaces what is currently in flight.
function queueNext(tasks) {
  var arr = Array.isArray(tasks) ? tasks : [];
  var status = Object.create(null); // proto-key-proof: keyed by display_id (MC 11525 row #5)
  arr.forEach(function (t) { status[String(t.display_id)] = t.status; });
  var afterDone = function (t) {
    return (t.after || []).every(function (dep) {
      var s = status[String(dep)];
      return s === undefined ? true : isDone(s); // unknown dep (other board / pruned) => not blocking
    });
  };
  var actionable = arr.filter(function (t) {
    return t.status === 'queued' && afterDone(t) && !!t.released; // README contract: [released] required, dep-free or not
  });
  // stable human order by display_id (the old released-first term was dead: the
  // filter above admits only released tasks, so it was 0 for every pair)
  actionable.sort(function (a, b) {
    return dispKey(a.display_id) - dispKey(b.display_id);
  });
  var inflight = arr.filter(function (t) { return t.status === 'running' || t.status === 'claimed'; });
  // queued-but-not-actionable is VISIBLE here — unfinished deps OR not released
  // (MC 11525 row #6 decision: queued+unreleased+deps-done shows in waiting, never 0-of-4).
  var waiting = arr.filter(function (t) { return t.status === 'queued' && (!afterDone(t) || !t.released); });
  var gated = arr.filter(function (t) {
    return t.status === 'blocked' || t.status === 'waiting_approval';
  });
  return { actionable: actionable, inflight: inflight, waiting: waiting, gated: gated };
}

// ---- verifiability state (HONEST three-way split of the "unverified" pile) ----
// A completed_unverified card is NOT one undifferentiated "unverified" blob. The server
// emitter stamps a STRUCTURAL `verifiable` boolean on every card (mc-boards-snapshot.py),
// computed with the EXACT rule knut's verification loop uses to refuse a card — a non-empty
// `acceptance` bar (knut_loop.py: `(j.acceptance||'').strip()`). So a completed_unverified
// card is one of three genuinely different things, and we must show them apart or the
// "lots of unverified" view lies:
//   pending      = verifiable=true,  completed_unverified — has a bar, awaiting 2x-verify
//   unverifiable = verifiable=false, completed_unverified — NO bar; knut REFUSES it
//                  ("need a bar first"); it can never flip to verified until a bar is derived
//   verified     = verified / deployed — already checked
function isVerifiable(t) { return !!(t && t.verifiable); }
function verifyState(t) {
  if (!t) return null;
  if (t.status === 'verified' || t.status === 'deployed') return 'verified';
  if (t.status === 'completed_unverified') return isVerifiable(t) ? 'pending' : 'unverifiable';
  return null;
}
// Exact Swedish labels (owner-specified) + a non-colour marker glyph (colour-blind safe).
var VERIFY_LABEL = {
  pending:      'väntar verifiering',
  unverifiable: 'ej verifierbar – saknar acceptanskriterier',
  verified:     'verifierad'
};
var VERIFY_MARK = { pending: '⏳', unverifiable: '⊘', verified: '✓' };

// ---- verification tail: the three-way split of completed_unverified + the verified end ----
function verificationTail(tasks) {
  var arr = Array.isArray(tasks) ? tasks : [];
  var awaiting = arr.filter(function (t) { return t.status === 'completed_unverified'; });
  return {
    // the two sub-buckets are the honest split of completed_unverified that the dashboard renders.
    awaitingVerifiable: awaiting.filter(isVerifiable),
    unverifiable: awaiting.filter(function (t) { return !isVerifiable(t); }),
    verified: arr.filter(function (t) { return t.status === 'verified' || t.status === 'deployed'; }),
    cancelled: arr.filter(function (t) { return t.status === 'cancelled'; })
  };
}

// ---- dependency edges: after (solid) + onfail (fel-gren) between display_ids ----
function dependencyEdges(tasks) {
  var arr = Array.isArray(tasks) ? tasks : [];
  var edges = [];
  arr.forEach(function (t) {
    (t.after || []).forEach(function (dep) {
      edges.push({ from: String(dep), to: String(t.display_id), kind: 'after' });
    });
    (t.onfail || []).forEach(function (dep) {
      edges.push({ from: String(dep), to: String(t.display_id), kind: 'onfail' });
    });
  });
  return edges;
}

// ============================ HTML builders ============================
function statusChip(status) {
  return '<span class="chip chip--' + statusTone(status) + '">' + escapeHtml(statusLabel(status)) + '</span>';
}
function seatChip(seat) {
  return seat ? '<span class="chip chip--seat">' + escapeHtml(seat) + '</span>' : '';
}
// The verifiability badge — the honest three-state marker. Only rendered for cards that
// actually have a verification state (completed_unverified or verified/deployed).
function verifyBadge(t) {
  var s = verifyState(t);
  if (!s) return '';
  return '<span class="vbadge vbadge--' + s + '" title="' + escapeHtml(VERIFY_LABEL[s]) + '">' +
    '<span class="vbadge__mark" aria-hidden="true">' + VERIFY_MARK[s] + '</span>' +
    escapeHtml(VERIFY_LABEL[s]) + '</span>';
}
function edgeChips(t) {
  var out = '';
  (t.after || []).forEach(function (d) {
    out += '<span class="edge edge--after" title="efter ' + escapeHtml(d) + '">→ efter ' + escapeHtml(d) + '</span>';
  });
  (t.onfail || []).forEach(function (d) {
    out += '<span class="edge edge--onfail" title="fel-gren ' + escapeHtml(d) + '">⚠ vid fel ' + escapeHtml(d) + '</span>';
  });
  if (t.cycles) out += '<span class="edge edge--cycles">↻ ' + escapeHtml(t.cycles) + '</span>';
  return out;
}

function taskNodeHTML(node) {
  var t = node.task || {};
  var kids = (node.children && node.children.length)
    ? '<div class="node__children">' + node.children.map(taskNodeHTML).join('') + '</div>' : '';
  return '<div class="node node--' + statusTone(t.status) + '">' +
    '<div class="node__head">' +
      '<code class="node__id">' + escapeHtml(t.display_id) + '</code>' +
      statusChip(t.status) + seatChip(t.seat) +
      (t.released ? '<span class="chip chip--released">släppt</span>' : '') +
      verifyBadge(t) +
    '</div>' +
    '<div class="node__title">' + escapeHtml(t.title || '(namnlöst)') + '</div>' +
    (edgeChips(t) ? '<div class="node__edges">' + edgeChips(t) + '</div>' : '') +
    kids +
  '</div>';
}

function projectCardHTML(name, tasks) {
  var p = projectProgress(tasks);
  var roots = buildTree(tasks);
  return '<details class="project" ' + (p.active > 0 && p.pct < 100 ? 'open' : '') + '>' +
    '<summary class="project__summary">' +
      '<span class="project__name">' + escapeHtml(name) + '</span>' +
      '<span class="project__meta">' + p.done + '/' + p.active + ' klara' +
        (p.cancelled ? ' · ' + p.cancelled + ' avbrutna' : '') + '</span>' +
      '<span class="progress" role="img" aria-label="' + p.pct + ' procent klart">' +
        '<span class="progress__bar" style="width:' + p.pct + '%"></span>' +
        '<span class="progress__pct">' + p.pct + '%</span>' +
      '</span>' +
    '</summary>' +
    '<div class="project__tree">' + roots.map(taskNodeHTML).join('') + '</div>' +
  '</details>';
}

function renderProjects(board) {
  var tasks = (board && board.tasks) || [];
  if (board && board.error) return errorHTML('Tavlan kunde inte läsas (' + escapeHtml(board.error) + ').');
  if (!tasks.length) return emptyHTML('Inga jobb att visa.');
  var groups = groupByProject(tasks);
  var names = Object.keys(groups).sort(function (a, b) {
    return groups[b].length - groups[a].length || a.localeCompare(b);
  });
  return names.map(function (n) { return projectCardHTML(n, groups[n]); }).join('');
}

function taskRowHTML(t) {
  return '<li class="row row--' + statusTone(t.status) + (verifyState(t) ? ' row--vf-' + verifyState(t) : '') + '">' +
    '<code class="row__id">' + escapeHtml(t.display_id) + '</code>' +
    statusChip(t.status) + seatChip(t.seat) + verifyBadge(t) +
    '<span class="row__title">' + escapeHtml(t.title || '(namnlöst)') + '</span>' +
    (edgeChips(t) ? '<span class="row__edges">' + edgeChips(t) + '</span>' : '') +
  '</li>';
}
function taskListHTML(items) {
  return items.length ? '<ul class="rows">' + items.map(taskRowHTML).join('') + '</ul>'
                      : '<p class="muted">Inget här just nu.</p>';
}

function renderQueue(board) {
  var tasks = (board && board.tasks) || [];
  if (board && board.error) return errorHTML('Tavlan kunde inte läsas.');
  var q = queueNext(tasks);
  return section('Näst på tur (i kö, beroenden klara)', taskListHTML(q.actionable)) +
         section('Pågår nu', taskListHTML(q.inflight)) +
         section('Väntar på beroende', taskListHTML(q.waiting)) +
         section('Blockerade / väntar godkännande', taskListHTML(q.gated));
}

// A legend explaining the three verification states — so the "klar (overif.)" pile is read
// honestly: most cards HAVE a bar and are simply awaiting a verifier; a few have NO bar and
// can NEVER be verified until one is derived; and the verified end is done.
function verifyLegend(v) {
  var item = function (state, n) {
    return '<span class="vlegend__item">' +
      '<span class="vbadge vbadge--' + state + '">' +
        '<span class="vbadge__mark" aria-hidden="true">' + VERIFY_MARK[state] + '</span>' +
        escapeHtml(VERIFY_LABEL[state]) + '</span>' +
      '<span class="vlegend__n">' + n + '</span></span>';
  };
  return '<div class="vlegend" role="note">' +
    '<span class="vlegend__lead">Verifieringsläge:</span>' +
    item('pending', v.awaitingVerifiable.length) +
    item('unverifiable', v.unverifiable.length) +
    item('verified', v.verified.length) +
  '</div>';
}

// The two long tails are CAPPED to keep the page light (verified 60, cancelled 40). A heading
// must never state a count the list below contradicts, so the cap is DISCLOSED in the heading
// ("· visar 60 av 143") whenever it bites. Measured on the live page 2026-08-29: the svarkor
// board read "Verifierade / driftsatta · 143" over 60 rows and "Avbrutna · 107" over 40.
var VERIFIED_CAP = 60, CANCELLED_CAP = 40;
function cappedTitle(label, n, cap) {
  return label + ' · ' + (n > cap ? 'visar ' + cap + ' av ' + n : n);
}

function renderVerification(board) {
  var tasks = (board && board.tasks) || [];
  if (board && board.error) return errorHTML('Tavlan kunde inte läsas.');
  var v = verificationTail(tasks);
  return verifyLegend(v) +
    section('Väntar verifiering (har acceptanskriterier – ej verifierad ännu) · ' + v.awaitingVerifiable.length,
            taskListHTML(v.awaitingVerifiable)) +
    section('Ej verifierbar – saknar acceptanskriterier · ' + v.unverifiable.length,
            (v.unverifiable.length
              ? '<p class="muted">Dessa kort är klara men saknar en checkbar acceptansribba, så verifieraren (knut) kan inte verifiera dem – de måste först få en ribba. De räknas alltså INTE som “väntar på verifiering”.</p>'
              : '') + taskListHTML(v.unverifiable)) +
    section(cappedTitle('Verifierade / driftsatta', v.verified.length, VERIFIED_CAP),
            taskListHTML(v.verified.slice(0, VERIFIED_CAP))) +
    section(cappedTitle('Avbrutna', v.cancelled.length, CANCELLED_CAP),
            taskListHTML(v.cancelled.slice(0, CANCELLED_CAP)));
}

function renderDependencies(board) {
  var tasks = (board && board.tasks) || [];
  if (board && board.error) return errorHTML('Tavlan kunde inte läsas.');
  var edges = dependencyEdges(tasks);
  if (!edges.length) return emptyHTML('Inga beroenden (inga [after:]/[onfail:]-taggar på denna tavla).');
  var title = Object.create(null);
  tasks.forEach(function (t) { title[String(t.display_id)] = t.title || ''; });
  var stat = Object.create(null);
  tasks.forEach(function (t) { stat[String(t.display_id)] = t.status; });
  var rows = edges.map(function (e) {
    return '<li class="dep dep--' + e.kind + '">' +
      '<code>' + escapeHtml(e.from) + '</code>' +
      '<span class="dep__arrow">' + (e.kind === 'onfail' ? '⚠→' : '→') + '</span>' +
      '<code>' + escapeHtml(e.to) + '</code>' +
      '<span class="dep__kind">' + (e.kind === 'onfail' ? 'vid fel' : 'efter') + '</span>' +
      statusChip(stat[e.to]) +
      '<span class="dep__title">' + escapeHtml((title[e.to] || '').slice(0, 80)) + '</span>' +
    '</li>';
  }).join('');
  var counts = { after: 0, onfail: 0 };
  edges.forEach(function (e) { counts[e.kind]++; });
  return '<p class="dep-legend"><span class="edge edge--after">→ efter</span> ' + counts.after +
         ' · <span class="edge edge--onfail">⚠ vid fel</span> ' + counts.onfail +
         ' · totalt ' + edges.length + ' beroendekanter</p>' +
         svgGraph(tasks, edges) +
         '<ul class="deps">' + rows + '</ul>';
}

// A compact layered SVG DAG: nodes placed in columns by after-depth, edges as lines.
function svgGraph(tasks, edges) {
  var have = Object.create(null);
  tasks.forEach(function (t) { have[String(t.display_id)] = t; });
  // only nodes that participate in an edge (keeps the graph legible)
  var involved = Object.create(null);
  edges.forEach(function (e) { involved[e.from] = true; involved[e.to] = true; });
  var ids = Object.keys(involved).filter(function (id) { return have[id]; });
  if (!ids.length) return '';
  // depth = longest after-chain to a root; cap layout to keep it renderable
  var depth = Object.create(null);
  var adjAfter = Object.create(null);
  edges.forEach(function (e) { if (e.kind === 'after') (adjAfter[e.to] = adjAfter[e.to] || []).push(e.from); });
  function d(id, seen) {
    if (depth[id] != null) return depth[id];
    seen = seen || Object.create(null);
    if (seen[id]) return 0;
    seen[id] = true;
    var deps = (adjAfter[id] || []).filter(function (x) { return have[x]; });
    depth[id] = deps.length ? 1 + Math.max.apply(null, deps.map(function (x) { return d(x, seen); })) : 0;
    return depth[id];
  }
  ids.forEach(function (id) { d(id); });
  var cols = Object.create(null);
  ids.forEach(function (id) { (cols[depth[id]] = cols[depth[id]] || []).push(id); });
  var colKeys = Object.keys(cols).map(Number).sort(function (a, b) { return a - b; });
  var COLW = 150, ROWH = 46, PADX = 16, PADY = 24, NW = 118, NH = 30;
  var pos = Object.create(null);
  colKeys.forEach(function (c, ci) {
    cols[c].sort(function (a, b) { return dispKey(a) - dispKey(b); });
    cols[c].forEach(function (id, ri) { pos[id] = { x: PADX + ci * COLW, y: PADY + ri * ROWH }; });
  });
  var maxRows = Math.max.apply(null, colKeys.map(function (c) { return cols[c].length; }));
  var W = PADX * 2 + (colKeys.length - 1) * COLW + NW;
  var H = PADY * 2 + Math.max(1, maxRows) * ROWH;
  var lines = edges.filter(function (e) { return pos[e.from] && pos[e.to]; }).map(function (e) {
    var a = pos[e.from], b = pos[e.to];
    return '<line x1="' + (a.x + NW) + '" y1="' + (a.y + NH / 2) + '" x2="' + b.x + '" y2="' + (b.y + NH / 2) +
      '" class="glink glink--' + e.kind + '" marker-end="url(#arrow-' + e.kind + ')" />';
  }).join('');
  var boxes = ids.map(function (id) {
    var p = pos[id], t = have[id];
    return '<g transform="translate(' + p.x + ',' + p.y + ')">' +
      '<rect width="' + NW + '" height="' + NH + '" rx="5" class="gnode gnode--' + statusTone(t.status) + '"/>' +
      '<text x="6" y="19" class="gnode__t">' + escapeHtml(id) + '</text>' +
    '</g>';
  }).join('');
  return '<div class="graph-wrap"><svg class="graph" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
    '" role="img" aria-label="Beroendegraf">' +
    '<defs>' +
      '<marker id="arrow-after" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" class="marker--after"/></marker>' +
      '<marker id="arrow-onfail" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" class="marker--onfail"/></marker>' +
    '</defs>' + lines + boxes + '</svg></div>';
}

function section(title, body) {
  return '<section class="sec"><h2 class="sec__title">' + escapeHtml(title) + '</h2>' + body + '</section>';
}
function emptyHTML(msg) { return '<div class="state state--empty">' + escapeHtml(msg) + '</div>'; }
function errorHTML(msg) { return '<div class="state state--error" role="alert">' + escapeHtml(msg) + '</div>'; }

var API = {
  escapeHtml: escapeHtml, statusMeta: statusMeta, statusTone: statusTone, statusLabel: statusLabel,
  isDone: isDone, isProgress: isProgress, buildTree: buildTree, groupByProject: groupByProject,
  projectProgress: projectProgress, queueNext: queueNext, verificationTail: verificationTail,
  dependencyEdges: dependencyEdges, renderProjects: renderProjects, renderQueue: renderQueue,
  renderVerification: renderVerification, renderDependencies: renderDependencies,
  verifyState: verifyState, cappedTitle: cappedTitle
};

if (typeof window !== 'undefined') { window.Aos = window.Aos || {}; window.Aos.render = API; }
if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
})();
