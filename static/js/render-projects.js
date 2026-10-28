// ============================================================================
// render-projects.js — the "Projekt" tab: recursive task-node cards nested under
// project <details> cards with the progress bar. File 3/6 of the C1 split (see
// render-core.js header for the lib contract and the namespace seam).
// ============================================================================
(function () {
'use strict';

// namespace seam (render-core.js header); core+data load before this file.
var shared = (typeof window !== 'undefined')
  ? (window.Aos = window.Aos || {}, window.Aos.render = window.Aos.render || {})
  : null;
var core = shared || require('./render-core.js');
var data = shared || require('./render-data.js');

function taskNodeHTML(node) {
  var t = node.task || {};
  var kids = (node.children && node.children.length)
    ? '<div class="node__children">' + node.children.map(taskNodeHTML).join('') + '</div>' : '';
  return '<div class="node node--' + core.statusTone(t.status) + '">' +
    '<div class="node__head">' +
      '<code class="node__id">' + core.escapeHtml(t.display_id) + '</code>' +
      core.statusChip(t.status) + core.seatChip(t.seat) +
      (t.released ? '<span class="chip chip--released">släppt</span>' : '') +
      core.verifyBadge(t) +
    '</div>' +
    '<div class="node__title">' + core.escapeHtml(t.title || '(namnlöst)') + '</div>' +
    (core.edgeChips(t) ? '<div class="node__edges">' + core.edgeChips(t) + '</div>' : '') +
    kids +
  '</div>';
}

function projectCardHTML(name, tasks) {
  var p = data.projectProgress(tasks);
  var roots = data.buildTree(tasks);
  return '<details class="project" ' + (p.active > 0 && p.pct < 100 ? 'open' : '') + '>' +
    '<summary class="project__summary">' +
      '<span class="project__name">' + core.escapeHtml(name) + '</span>' +
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
  if (board && board.error) return core.errorHTML('Tavlan kunde inte läsas (' + core.escapeHtml(board.error) + ').');
  if (!tasks.length) return core.emptyHTML('Inga jobb att visa.');
  var groups = data.groupByProject(tasks);
  var names = Object.keys(groups).sort(function (a, b) {
    return groups[b].length - groups[a].length || a.localeCompare(b);
  });
  return names.map(function (n) { return projectCardHTML(n, groups[n]); }).join('');
}

var API = {
  // public API — names + arity identical to the pre-split render.js:
  renderProjects: renderProjects
};

if (typeof window !== 'undefined') {
  window.Aos = window.Aos || {};
  Object.assign(window.Aos.render = window.Aos.render || {}, API);
}
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
