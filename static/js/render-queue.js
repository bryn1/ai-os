// ============================================================================
// render-queue.js — the "Kö" tab: the queue-next board as row lists (näst på tur,
// pågår, väntar, blockerade). File 4/6 of the C1 split (see render-core.js header
// for the lib contract and the namespace seam).
// ============================================================================
(function () {
'use strict';

// namespace seam (render-core.js header); core+data load before this file.
var shared = (typeof window !== 'undefined')
  ? (window.Aos = window.Aos || {}, window.Aos.render = window.Aos.render || {})
  : null;
var core = shared || require('./render-core.js');
var data = shared || require('./render-data.js');

function taskRowHTML(t) {
  return '<li class="row row--' + core.statusTone(t.status) + (core.verifyState(t) ? ' row--vf-' + core.verifyState(t) : '') + '">' +
    '<code class="row__id">' + core.escapeHtml(t.display_id) + '</code>' +
    core.statusChip(t.status) + core.seatChip(t.seat) + core.verifyBadge(t) +
    '<span class="row__title">' + core.escapeHtml(t.title || '(namnlöst)') + '</span>' +
    (core.edgeChips(t) ? '<span class="row__edges">' + core.edgeChips(t) + '</span>' : '') +
  '</li>';
}
function taskListHTML(items) {
  return items.length ? '<ul class="rows">' + items.map(taskRowHTML).join('') + '</ul>'
                      : '<p class="muted">Inget här just nu.</p>';
}

function renderQueue(board) {
  var tasks = (board && board.tasks) || [];
  if (board && board.error) return core.errorHTML('Tavlan kunde inte läsas.');
  var q = data.queueNext(tasks);
  return core.section('Näst på tur (i kö, beroenden klara)', taskListHTML(q.actionable)) +
         core.section('Pågår nu', taskListHTML(q.inflight)) +
         core.section('Väntar på beroende', taskListHTML(q.waiting)) +
         core.section('Blockerade / väntar godkännande', taskListHTML(q.gated));
}

var API = {
  // public API — names + arity identical to the pre-split render.js:
  renderQueue: renderQueue,
  // seam: the row lists are reused by render-verify.js sections:
  taskListHTML: taskListHTML
};

if (typeof window !== 'undefined') {
  window.Aos = window.Aos || {};
  Object.assign(window.Aos.render = window.Aos.render || {}, API);
}
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
