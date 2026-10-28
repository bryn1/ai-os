// ============================================================================
// render-data.js — the data-analysis concerns of the render lib: parent_id
// tree-building, project grouping + progress, the queue-next rule, the
// verification tail and the dependency-edge list. Plain data in, plain objects
// out — no HTML here. File 2/6 of the C1 split (see render-core.js header for
// the lib contract and the namespace seam).
// ============================================================================
(function () {
'use strict';

// namespace seam (render-core.js header): shared object in the browser, module
// require under node. render-core.js is loaded/required before this file.
var shared = (typeof window !== 'undefined')
  ? (window.Aos = window.Aos || {}, window.Aos.render = window.Aos.render || {})
  : null;
var core = shared || require('./render-core.js');
var isDone = core.isDone, isProgress = core.isProgress, isVerifiable = core.isVerifiable;

// ---- tree building (concepts ported from the svarkor-era tree module; keyed on display_id now) ----
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

// ---- project grouping (concepts ported from the svarkor-era grouping module) ----
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

// ---- verification tail: the three-way split of completed_unverified + the verified end ----
// (the vocabulary — isVerifiable/verifyState/labels — lives in render-core.js.)
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

var API = {
  // public API — names + arity identical to the pre-split render.js:
  buildTree: buildTree, groupByProject: groupByProject, projectProgress: projectProgress,
  queueNext: queueNext, verificationTail: verificationTail, dependencyEdges: dependencyEdges,
  // seam: display_id ordering key, shared with render-deps.js (graph layout):
  dispKey: dispKey
};

if (typeof window !== 'undefined') {
  window.Aos = window.Aos || {};
  Object.assign(window.Aos.render = window.Aos.render || {}, API);
}
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
