// ============================================================================
// render-deps.js — the "Beroenden" tab: the dependency edge list plus the
// compact layered SVG DAG (svgGraph) drawn over it. File 6/6 of the C1 split
// (see render-core.js header for the lib contract and the namespace seam).
// ============================================================================
(function () {
'use strict';

// namespace seam (render-core.js header); core+data load before this file.
var shared = (typeof window !== 'undefined')
  ? (window.Aos = window.Aos || {}, window.Aos.render = window.Aos.render || {})
  : null;
var core = shared || require('./render-core.js');
var data = shared || require('./render-data.js');

// C2f (row #14): a compact Swedish status letter per tone, so a node's state
// survives colour-blindness / monochrome. The letter mirrors the Swedish label
// (K=ko, P=pågår, B=blockerad, G=godkännande, O=overifierad, V=verifierad,
// D=driftsatt, A=avbruten) and sits beside the node's id; the full id + label
// is on each node's <title> for AT.
var STATUS_GLYPH = {
  queued: 'K', running: 'P', blocked: 'B', approval: 'G', unverified: 'O',
  verified: 'V', deployed: 'D', cancelled: 'A', default: '?'
};

function renderDependencies(board) {
  var tasks = (board && board.tasks) || [];
  if (board && board.error) return core.errorHTML('Tavlan kunde inte läsas.');
  var edges = data.dependencyEdges(tasks);
  if (!edges.length) return core.emptyHTML('Inga beroenden (inga [after:]/[onfail:]-taggar på denna tavla).');
  var title = Object.create(null);
  tasks.forEach(function (t) { title[String(t.display_id)] = t.title || ''; });
  var stat = Object.create(null);
  tasks.forEach(function (t) { stat[String(t.display_id)] = t.status; });
  var rows = edges.map(function (e) {
    return '<li class="dep dep--' + e.kind + '">' +
      '<code>' + core.escapeHtml(e.from) + '</code>' +
      '<span class="dep__arrow">' + (e.kind === 'onfail' ? '⚠→' : '→') + '</span>' +
      '<code>' + core.escapeHtml(e.to) + '</code>' +
      '<span class="dep__kind">' + (e.kind === 'onfail' ? 'vid fel' : 'efter') + '</span>' +
      core.statusChip(stat[e.to]) +
      '<span class="dep__title">' + core.escapeHtml((title[e.to] || '').slice(0, 80)) + '</span>' +
    '</li>';
  }).join('');
  var counts = { after: 0, onfail: 0 };
  edges.forEach(function (e) { counts[e.kind]++; });
  // the panel gets a real <h2> (C2c row #12) and the graph a Swedish <title> +
  // aria-describedby onto the legend line (C2f row #14).
  var legend = '<p class="dep-legend" id="dep-legend"><span class="edge edge--after">→ efter</span> ' + counts.after +
         ' · <span class="edge edge--onfail">⚠ vid fel</span> ' + counts.onfail +
         ' · totalt ' + edges.length + ' beroendekanter</p>';
  return core.section('Beroenden', legend + svgGraph(tasks, edges)) +
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
    cols[c].sort(function (a, b) { return data.dispKey(a) - data.dispKey(b); });
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
    // C2f (row #14): status beyond colour — a small per-node status letter (the
    // tone's first letter is meaningless; use a compact Swedish marker set), the
    // node box stays as drawn, and every node carries a <title> with id + status.
    var glyph = STATUS_GLYPH[core.statusTone(t.status)] || '?';
    return '<g transform="translate(' + p.x + ',' + p.y + ')">' +
      '<title>' + core.escapeHtml(id + ' · ' + core.statusLabel(t.status)) + '</title>' +
      '<rect width="' + NW + '" height="' + NH + '" rx="5" class="gnode gnode--' + core.statusTone(t.status) + '"/>' +
      '<text x="6" y="19" class="gnode__t">' + core.escapeHtml(id) + '</text>' +
      '<text x="' + (NW - 10) + '" y="19" class="gnode__status" aria-hidden="true">' + glyph + '</text>' +
    '</g>';
  }).join('');
  return '<div class="graph-wrap"><svg class="graph" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
    '" role="img" aria-labelledby="graph-title" aria-describedby="dep-legend">' +
    '<title id="graph-title">Beroendegraf</title>' +
    '<defs>' +
      '<marker id="arrow-after" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" class="marker--after"/></marker>' +
      '<marker id="arrow-onfail" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" class="marker--onfail"/></marker>' +
    '</defs>' + lines + boxes + '</svg></div>';
}

var API = {
  // public API — names + arity identical to the pre-split render.js:
  renderDependencies: renderDependencies
};

if (typeof window !== 'undefined') {
  window.Aos = window.Aos || {};
  Object.assign(window.Aos.render = window.Aos.render || {}, API);
}
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
