// ============================================================================
// app.js — dashboard shell: fetch the static snapshot, board switch, tab switch,
// poll. It issues NO board API call and holds NO token: it polls ONE static file
// (boards.json) that the server-side emitter already scrubbed. All rendering is
// delegated to the pure window.Aos.render library.
// ============================================================================
(function () {
'use strict';
if (typeof window === 'undefined' || !window.document) return;

var SNAPSHOT_URL = 'boards.json';   // co-located with index.html on the served root
var POLL_MS = 60000;

var state = { data: null, board: 'orchestrator', tab: 'projekt', error: null };

function $(id) { return document.getElementById(id); }
function boardById(id) {
  var boards = (state.data && state.data.boards) || [];
  for (var i = 0; i < boards.length; i++) if (boards[i].id === id) return boards[i];
  return boards[0] || null;
}

var RENDERERS = {
  projekt: function (b) { return window.Aos.render.renderProjects(b); },
  beroenden: function (b) { return window.Aos.render.renderDependencies(b); },
  ko: function (b) { return window.Aos.render.renderQueue(b); },
  verifiering: function (b) { return window.Aos.render.renderVerification(b); }
};

function renderMeta() {
  var bar = $('meta-bar');
  if (!bar) return;
  if (state.error) {
    bar.innerHTML = '<span class="meta meta--error">Kunde inte läsa ögonblicksbilden: ' +
      window.Aos.render.escapeHtml(state.error) + '</span>';
    return;
  }
  var b = boardById(state.board);
  var gen = state.data && state.data.generated_at ? new Date(state.data.generated_at) : null;
  var when = gen ? gen.toLocaleString('sv-SE') : '—';
  var hidden = b ? (b.hidden_count || 0) : 0;
  var tasks = b ? (b.task_count || (b.tasks ? b.tasks.length : 0)) : 0;
  bar.innerHTML =
    '<span class="meta">Tavla: <strong>' + window.Aos.render.escapeHtml(b ? b.label : '—') + '</strong></span>' +
    '<span class="meta">' + window.Aos.render.escapeHtml(tasks) + ' jobb</span>' +
    '<span class="meta meta--hidden" title="Känsliga projekt filtrerade på servern">' + window.Aos.render.escapeHtml(hidden) + ' dolda (känsliga)</span>' +
    '<span class="meta meta--time">Uppdaterad ' + window.Aos.render.escapeHtml(when) + '</span>';
}

function renderPanel() {
  var body = $(state.tab + '-body');
  if (!body) return;
  if (state.error) { body.innerHTML = '<div class="state state--error" role="alert">Ingen data.</div>'; return; }
  var b = boardById(state.board);
  try {
    body.innerHTML = (RENDERERS[state.tab] || RENDERERS.projekt)(b);
  } catch (e) {
    body.innerHTML = '<div class="state state--error" role="alert">Renderingsfel: ' +
      window.Aos.render.escapeHtml(e && e.message) + '</div>';
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

function bind() {
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) (function (el) {
    el.addEventListener('click', function () { showTab(el.getAttribute('data-tab')); });
  })(tabs[i]);
  var pills = document.querySelectorAll('.board-pill');
  for (var j = 0; j < pills.length; j++) (function (el) {
    el.addEventListener('click', function () { showBoard(el.getAttribute('data-board')); });
  })(pills[j]);
  // deep link ?board= & ?tab=
  try {
    var q = new URLSearchParams(window.location.search);
    if (q.get('board')) state.board = q.get('board');
    if (q.get('tab')) state.tab = q.get('tab');
  } catch (e) { /* older browsers: ignore */ }
}

function load() {
  fetch(SNAPSHOT_URL, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { state.data = data; state.error = null; syncControls(); renderAll(); })
    .catch(function (e) { state.error = e && e.message ? e.message : String(e); renderAll(); });
}

// reflect deep-linked board/tab into the controls once data is present
function syncControls() { showBoard(state.board); showTab(state.tab); }

function boot() {
  bind();
  var body = $('projekt-body');
  if (body) body.innerHTML = '<div class="state state--loading" role="status">Läser in tavlor…</div>';
  load();
  setInterval(load, POLL_MS);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
