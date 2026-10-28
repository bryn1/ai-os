// ============================================================================
// render-verify.js — the "Verifiering" tab: the honest three-state legend and the
// verification tails (awaiting / unverifiable / verified / cancelled), with the
// disclosure caps. File 5/6 of the C1 split (see render-core.js header for the
// lib contract and the namespace seam).
// ============================================================================
(function () {
'use strict';

// namespace seam (render-core.js header); core, data and queue load before this
// file (the tails reuse queue's row lists).
var shared = (typeof window !== 'undefined')
  ? (window.Aos = window.Aos || {}, window.Aos.render = window.Aos.render || {})
  : null;
var core = shared || require('./render-core.js');
var data = shared || require('./render-data.js');
var queue = shared || require('./render-queue.js');

// A legend explaining the three verification states — so the "klar (overif.)" pile is read
// honestly: most cards HAVE a bar and are simply awaiting a verifier; a few have NO bar and
// can NEVER be verified until one is derived; and the verified end is done.
function verifyLegend(v) {
  var item = function (state, n) {
    return '<span class="vlegend__item">' +
      '<span class="vbadge vbadge--' + state + '">' +
        '<span class="vbadge__mark" aria-hidden="true">' + core.VERIFY_MARK[state] + '</span>' +
        core.escapeHtml(core.VERIFY_LABEL[state]) + '</span>' +
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
  if (board && board.error) return core.errorHTML('Tavlan kunde inte läsas.');
  var v = data.verificationTail(tasks);
  return verifyLegend(v) +
    core.section('Väntar verifiering (har acceptanskriterier – ej verifierad ännu) · ' + v.awaitingVerifiable.length,
            queue.taskListHTML(v.awaitingVerifiable)) +
    core.section('Ej verifierbar – saknar acceptanskriterier · ' + v.unverifiable.length,
            (v.unverifiable.length
              ? '<p class="muted">Dessa kort är klara men saknar en checkbar acceptansribba, så verifieraren (knut) kan inte verifiera dem – de måste först få en ribba. De räknas alltså INTE som “väntar på verifiering”.</p>'
              : '') + queue.taskListHTML(v.unverifiable)) +
    core.section(cappedTitle('Verifierade / driftsatta', v.verified.length, VERIFIED_CAP),
            queue.taskListHTML(v.verified.slice(0, VERIFIED_CAP))) +
    core.section(cappedTitle('Avbrutna', v.cancelled.length, CANCELLED_CAP),
            queue.taskListHTML(v.cancelled.slice(0, CANCELLED_CAP)));
}

var API = {
  // public API — names + arity identical to the pre-split render.js:
  renderVerification: renderVerification, cappedTitle: cappedTitle
};

if (typeof window !== 'undefined') {
  window.Aos = window.Aos || {};
  Object.assign(window.Aos.render = window.Aos.render || {}, API);
}
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
