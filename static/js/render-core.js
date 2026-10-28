// ============================================================================
// render-core.js — status vocabulary + the shared HTML primitives every render
// concern calls. FIRST of the six plain-script files the old render.js was split
// into (MC 11525 Wave C1, design table FINDINGS-design §3.1); index.html loads
// it before the others. Pure, DOM-free: plain data in, string out — no network,
// no state. app.js owns fetch/poll/DOM/board-switch.
//
// The snapshot is already scrubbed on the server (mc-boards-snapshot.py): no
// tokens, no prompts, no result/deploy fields, sensitive projects excluded, titles
// masked/redacted, and the [after:]/[onfail:]/[cycles:]/[seat:] tags already parsed
// into structured fields. This lib only VISUALISES that safe data.
//
// Namespace seam (all six files): in the browser each file extends the ONE
// window.Aos.render object (load order = index.html order); under node each file
// is a CommonJS module whose exports merge into the same surface (tests require
// the six files in load order). PUBLIC API names + arity are identical to the
// pre-split render.js plus the four builders Wave C1c moved out of app.js
// (metaHTML, errorHTML, renderErrorHTML, loadingHTML — audit row #18). Names in
// the "seam" group are lib-internal cross-file helpers, not dashboard API.
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

// ============================ HTML builders ============================
// status/seat chips, the verifiability badge and the edge chips are shared by the
// tree nodes (render-projects.js), the list rows (render-queue.js) and the graph
// rows (render-deps.js); the verification badge is also the legend swatch
// (render-verify.js). The tone classes they emit are styled by app.css's ONE tone
// family (design F2 / row #17): the STATUS map above is the only status->tone table.
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

function section(title, body) {
  return '<section class="sec"><h2 class="sec__title">' + escapeHtml(title) + '</h2>' + body + '</section>';
}
function emptyHTML(msg) { return '<div class="state state--empty">' + escapeHtml(msg) + '</div>'; }
function errorHTML(msg) { return '<div class="state state--error" role="alert">' + escapeHtml(msg) + '</div>'; }

// ---- meta strip + shell states — moved VERBATIM from app.js (Wave C1c, audit
// row #18): the shell is fetch/poll wiring only, so every string the shell wrote
// into innerHTML lives here. Outputs are byte-identical (c1-anchor shell writes).
// board/data may be null (no data yet / unknown board); error wins over the data line.
function metaHTML(board, data, error) {
  if (error) {
    return '<span class="meta meta--error">Kunde inte läsa ögonblicksbilden: ' +
      escapeHtml(error) + '</span>';
  }
  var gen = data && data.generated_at ? new Date(data.generated_at) : null;
  var when = gen ? gen.toLocaleString('sv-SE') : '—';
  var hidden = board ? (board.hidden_count || 0) : 0;
  var tasks = board ? (board.task_count || (board.tasks ? board.tasks.length : 0)) : 0;
  return '<span class="meta">Tavla: <strong>' + escapeHtml(board ? board.label : '—') + '</strong></span>' +
    '<span class="meta">' + escapeHtml(tasks) + ' jobb</span>' +
    '<span class="meta meta--hidden" title="Känsliga projekt filtrerade på servern">' + escapeHtml(hidden) + ' dolda (känsliga)</span>' +
    '<span class="meta meta--time">Uppdaterad ' + escapeHtml(when) + '</span>';
}
// panel fallback when a renderer throws mid-render (app.js renderPanel catch).
function renderErrorHTML(detail) {
  return '<div class="state state--error" role="alert">Renderingsfel: ' + escapeHtml(detail) + '</div>';
}
// first-paint state the shell paints before the first boards.json response lands.
function loadingHTML() {
  return '<div class="state state--loading" role="status">Läser in tavlor…</div>';
}

var API = {
  // public API — names + arity identical to the pre-split render.js:
  escapeHtml: escapeHtml, statusMeta: statusMeta, statusTone: statusTone, statusLabel: statusLabel,
  isDone: isDone, isProgress: isProgress, verifyState: verifyState,
  // public API additions — the shell builders Wave C1c moved out of app.js (row #18):
  metaHTML: metaHTML, errorHTML: errorHTML, renderErrorHTML: renderErrorHTML, loadingHTML: loadingHTML,
  // seam: shared with the other five concern files, not dashboard API:
  isVerifiable: isVerifiable, VERIFY_LABEL: VERIFY_LABEL, VERIFY_MARK: VERIFY_MARK,
  statusChip: statusChip, seatChip: seatChip, verifyBadge: verifyBadge, edgeChips: edgeChips,
  section: section, emptyHTML: emptyHTML
};

if (typeof window !== 'undefined') {
  window.Aos = window.Aos || {};
  Object.assign(window.Aos.render = window.Aos.render || {}, API);
}
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
