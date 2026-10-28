// ============================================================================
// app.js — dashboard shell: fetch the static snapshot, board switch, tab switch,
// poll. It issues NO board API call and holds NO token: it polls ONE static file
// (boards.json) that the server-side emitter already scrubbed. All rendering —
// the four tab panels AND the meta strip / error / loading states — is delegated
// to the pure window.Aos.render library (Wave C1c, audit row #18: the shell
// holds no markup; every string lives in render-core.js).
//
// Wave C2 (MC 11525) adds the poll-robustness + deep-link rules:
//   C2a (row #4):  the poll re-render is NON-DESTRUCTIVE. Mechanism chosen:
//                  RESTORE focus + open <details> after re-render, keyed by the
//                  project slug (details) and element id (focus). Chosen over
//                  "skip identical re-render" because boards.json carries a fresh
//                  generated_at on every poll — byte-equality almost never holds,
//                  so a content-hash skip would silently never fire while the
//                  restore helps on EVERY poll (verified live, c2-focus).
//                  C2a-4b: a transient fetch/envelope failure KEEPS the last-good
//                  panels (they were valid a minute ago) — the error lands in the
//                  meta status line ONLY; the panel shows the error only when
//                  there is no last-good data at all (first load).
//   C2c (rows #11/#12): roving tabindex + ArrowLeft/Right/Home/End on the tablist.
//   C2d (row #13):  meta info (counts/time, changes every poll) and meta status
//                  (error only) are separate elements; ONLY the status is a live
//                  region, and it is written ONLY when its string changed.
//   C2e (rows #9/#10): unknown ?tab= falls back to the default tab with the toggle
//                  consistent; unknown ?board= shows an explicit Swedish error
//                  state — never another board's data with no pill pressed.
// ============================================================================
(function () {
'use strict';
if (typeof window === 'undefined' || !window.document) return;

var R = window.Aos.render;

var SNAPSHOT_URL = 'boards.json';   // co-located with index.html on the served root
var POLL_MS = 60000;
var TAB_NAMES = ['projekt', 'beroenden', 'ko', 'verifiering'];
var DEFAULT_TAB = 'projekt';
var DEFAULT_BOARD = 'orchestrator';

var state = { data: null, board: DEFAULT_BOARD, tab: DEFAULT_TAB, error: null, unknownBoard: false };

function $(id) { return document.getElementById(id); }
function boardById(id) {
  var boards = (state.data && state.data.boards) || [];
  for (var i = 0; i < boards.length; i++) if (boards[i].id === id) return boards[i];
  return null; // C2e: NO silent fallback to boards[0] — the caller decides
}

var RENDERERS = {
  projekt: function (b) { return R.renderProjects(b); },
  beroenden: function (b) { return R.renderDependencies(b); },
  ko: function (b) { return R.renderQueue(b); },
  verifiering: function (b) { return R.renderVerification(b); }
};

// the meta strip + the error/loading states are string builders in the render
// lib (metaHTML / statusHTML / errorHTML / renderErrorHTML / loadingHTML).
// lastStatus starts undefined so the FIRST render always writes the status
// element (even the empty string) — the live region then exists in the DOM once;
// every later write happens ONLY on an actual change (C2d).
var lastStatus;
function renderMeta() {
  var info = $('meta-info'), status = $('meta-status');
  if (info) info.innerHTML = R.metaHTML(boardById(state.board), state.data);
  if (status) {
    var s = R.statusHTML(state.error);
    if (s !== lastStatus) { lastStatus = s; status.innerHTML = s; } // only a CHANGE is announced
  }
}

// ---- C2a: focus/open-state preserving panel write ----------------------------
// A project <details> is keyed by its rendered project name (the group key — the
// only stable identifier the pure renderer emits). Focus is keyed by element id
// (the shell's own) or by 'summary:<project>' when focus sat on a project summary.
function projectKeyOf(detailsEl) {
  var name = detailsEl.querySelector('.project__name');
  return name ? name.textContent : null;
}
function ownerProjectKey(el, body) {
  var n = el;
  while (n && n !== body) {
    if (n.nodeName === 'DETAILS') return projectKeyOf(n);
    n = n.parentNode;
  }
  return null;
}
function focusKey(body) {
  var ae = document.activeElement;
  if (!ae || ae === document.body || !body.contains(ae)) return null;
  if (ae.id) return 'id:' + ae.id;
  if (ae.nodeName === 'SUMMARY') {
    var k = ownerProjectKey(ae, body);
    return k === null ? null : 'summary:' + k;
  }
  return null;
}
function capturePanelState(body) {
  var st = { openKeys: [], closedKeys: [], focus: focusKey(body) };
  var ds = body.querySelectorAll('details[class~=project]');
  for (var i = 0; i < ds.length; i++) {
    var k = projectKeyOf(ds[i]);
    if (k === null) continue;
    (ds[i].open ? st.openKeys : st.closedKeys).push(k);
  }
  return st;
}
function restorePanelState(body, st) {
  var ds = body.querySelectorAll('details[class~=project]');
  for (var i = 0; i < ds.length; i++) {
    var k = projectKeyOf(ds[i]);
    if (k === null) continue;
    if (st.openKeys.indexOf(k) !== -1) ds[i].open = true;
    else if (st.closedKeys.indexOf(k) !== -1) ds[i].open = false; // user-closed stays closed
  }
  if (!st.focus) return;
  var el = st.focus.indexOf('id:') === 0 ? document.getElementById(st.focus.slice(3)) : null;
  if (!el && st.focus.indexOf('summary:') === 0) {
    var want = st.focus.slice(8);
    for (var j = 0; j < ds.length; j++) {
      if (projectKeyOf(ds[j]) === want) { el = ds[j].querySelector('summary'); break; }
    }
  }
  if (el && el.focus) el.focus();
}
function renderPanelBody(body, html) {
  var st = capturePanelState(body);
  body.innerHTML = html;
  restorePanelState(body, st);
}

function renderPanel() {
  var body = $(state.tab + '-body');
  if (!body) return;
  // C2a-4b last-good rule: a failed poll keeps the panels it rendered before —
  // only a FIRST-load failure (no data at all) shows the error in the panel.
  if (state.error && !state.data) { body.innerHTML = R.errorHTML('Ingen data.'); return; }
  if (state.unknownBoard) { body.innerHTML = R.errorHTML('Okänd tavla: ' + state.board + '. Endast tavlor som finns i ögonblicksbilden kan visas.'); return; }
  var b = boardById(state.board);
  try {
    renderPanelBody(body, (RENDERERS[state.tab] || RENDERERS[DEFAULT_TAB])(b));
  } catch (e) {
    body.innerHTML = R.renderErrorHTML(e && e.message);
  }
}

function renderAll() { renderMeta(); renderPanel(); }

function showTab(name) {
  state.tab = name;
  var panels = document.querySelectorAll('.panel');
  for (var i = 0; i < panels.length; i++) panels[i].hidden = panels[i].getAttribute('data-tab') !== name;
  var tabs = document.querySelectorAll('.tab');
  for (var j = 0; j < tabs.length; j++) {
    var on = tabs[j].getAttribute('data-tab') === name;
    tabs[j].classList.toggle('is-active', on);
    tabs[j].setAttribute('aria-selected', on ? 'true' : 'false');
    tabs[j].setAttribute('tabindex', on ? '0' : '-1'); // C2c roving tabindex
  }
  renderPanel();
}

function showBoard(id) {
  state.board = id;
  var pills = document.querySelectorAll('.board-pill');
  for (var i = 0; i < pills.length; i++) {
    var on = pills[i].getAttribute('data-board') === id;
    pills[i].classList.toggle('is-active', on);
    pills[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  renderAll();
}

// C2c: arrow-key movement on the tablist (roving tabindex without the arrows
// would strand the -1 tabs out of reach). Moving focus also selects the tab —
// the ARIA tabs pattern with automatic activation, right for on-demand panels.
function bindTablistKeys() {
  var strip = document.querySelector('.tabs');
  if (!strip) return;
  strip.addEventListener('keydown', function (ev) {
    var tabs = document.querySelectorAll('.tab');
    var i, cur = -1;
    for (i = 0; i < tabs.length; i++) if (tabs[i] === document.activeElement) cur = i;
    if (cur < 0) return;
    var next = ev.key === 'ArrowRight' ? cur + 1 : ev.key === 'ArrowLeft' ? cur - 1
             : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0 || next >= tabs.length) return;
    ev.preventDefault();
    tabs[next].focus();
    showTab(tabs[next].getAttribute('data-tab'));
  });
}

function bind() {
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) (function (el) {
    el.addEventListener('click', function () { showTab(el.getAttribute('data-tab')); });
  })(tabs[i]);
  var pills = document.querySelectorAll('.board-pill');
  for (var j = 0; j < pills.length; j++) (function (el) {
    el.addEventListener('click', function () { showBoard(el.getAttribute('data-board')); });
  })(pills[j]);
  bindTablistKeys();
  // deep link ?board= & ?tab= — C2e fallbacks (rows #9/#10): an unknown tab is
  // discarded HERE (the toggle never shows an unbacked selection); an unknown
  // board id is kept for the explicit error state renderPanel shows.
  try {
    var q = new URLSearchParams(window.location.search);
    var tab = q.get('tab');
    if (tab) state.tab = TAB_NAMES.indexOf(tab) !== -1 ? tab : DEFAULT_TAB;
    if (q.get('board')) state.board = q.get('board');
  } catch (e) { /* older browsers: ignore */ }
}

// One-shot validation of the parsed snapshot BEFORE any render call (MC 11525 row #7):
// a malformed-but-valid JSON body must land on the SAME Swedish error path as a fetch
// failure — never a raw English TypeError in the panel, never a silently empty render.
// Rules mirror what the renderers dereference; null counts as absent (emitter shape).
function validateEnvelope(data) {
  var isStrList = function (a) {
    return Array.isArray(a) && a.every(function (d) { return typeof d === 'string'; });
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Ögonblicksbilden är inte ett objekt.';
  if (!Array.isArray(data.boards)) return 'Ögonblicksbilden saknar boards-listan.';
  for (var i = 0; i < data.boards.length; i++) {
    var b = data.boards[i];
    if (!b || typeof b !== 'object' || Array.isArray(b)) return 'Tavla ' + i + ' är inte ett objekt.';
    if (b.tasks != null && !Array.isArray(b.tasks)) return 'Tavla ' + i + ': tasks är inte en lista.';
    var tasks = Array.isArray(b.tasks) ? b.tasks : [];
    for (var j = 0; j < tasks.length; j++) {
      var t = tasks[j];
      if (!t || typeof t !== 'object' || Array.isArray(t)) return 'Tavla ' + i + ': jobb ' + j + ' är inte ett objekt.';
      if (t.after != null && !isStrList(t.after)) return 'Tavla ' + i + ': jobb ' + j + ': after är inte en stränglista.';
      if (t.onfail != null && !isStrList(t.onfail)) return 'Tavla ' + i + ': jobb ' + j + ': onfail är inte en stränglista.';
      if (t.parent_id != null && typeof t.parent_id !== 'string') return 'Tavla ' + i + ': jobb ' + j + ': parent_id är inte en sträng.';
      if (t.project_slug != null && typeof t.project_slug !== 'string') return 'Tavla ' + i + ': jobb ' + j + ': project_slug är inte en sträng.';
    }
  }
  return null;
}

function load() {
  fetch(SNAPSHOT_URL, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      var invalid = validateEnvelope(data);
      if (invalid) { state.error = invalid; renderAll(); return; } // last-good panels stay (C2a-4b)
      state.data = data; state.error = null; syncControls(); renderAll();
    })
    .catch(function (e) { state.error = e && e.message ? e.message : String(e); renderAll(); });
}

// reflect deep-linked board/tab into the controls once data is present
function syncControls() {
  // C2e (row #10): an unknown board keeps its pills UNPRESSED but renders the
  // explicit Swedish error state instead of quietly serving boards[0].
  state.unknownBoard = !!state.data && !boardById(state.board);
  showBoard(state.board);
  showTab(state.tab);
}

function boot() {
  bind();
  var body = $('projekt-body');
  if (body) body.innerHTML = R.loadingHTML();
  load();
  setInterval(load, POLL_MS);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
