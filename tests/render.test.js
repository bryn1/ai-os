// node --test tests/render.test.js — pure-logic tests for static/js/render.js against the
// real snapshot shape emitted by mc-boards-snapshot.py (VM350-side).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../static/js/render.js');

const tasks = [
  { display_id: '600',   parent_id: null,  status: 'queued',               project_slug: 'demo', seat: null,    title: 'Root goal', released: false, after: [], onfail: [], cycles: null },
  { display_id: '600.1', parent_id: '600', status: 'verified',             project_slug: 'demo', seat: 'sickan', title: 'T1 plan', released: false, after: [], onfail: [], cycles: null, verifiable: true },
  { display_id: '600.2', parent_id: '600', status: 'completed_unverified', project_slug: 'demo', seat: 'bernie', title: 'T2 arch', released: true,  after: ['600.1'], onfail: [], cycles: null, verifiable: true },
  { display_id: '600.3', parent_id: '600', status: 'queued',               project_slug: 'demo', seat: 'neo',    title: 'T3 review', released: true, after: ['600.2'], onfail: ['600.2'], cycles: 3 },
  { display_id: '600.4', parent_id: '600', status: 'queued',               project_slug: 'demo', seat: 'x',      title: 'T4 later', released: true, after: ['600.3'], onfail: [], cycles: null },
  { display_id: '600.5', parent_id: '600', status: 'completed_unverified', project_slug: 'demo', seat: 'ada',    title: 'T5 nobar', released: true,  after: [], onfail: [], cycles: null, verifiable: false },
  { display_id: '700',   parent_id: null,  status: 'cancelled',            project_slug: 'other', seat: null,   title: 'Dead', released: false, after: [], onfail: [], cycles: null }
];

test('status vocab is the REAL board vocab (no fictional pending)', () => {
  assert.strictEqual(R.statusMeta('pending').tone, 'default'); // not a real status
  assert.strictEqual(R.statusLabel('queued'), 'I kö');
  assert.strictEqual(R.statusTone('verified'), 'verified');
  assert.strictEqual(R.isDone('completed_unverified'), true);
  assert.strictEqual(R.isDone('queued'), false);
  assert.strictEqual(R.isProgress('cancelled'), false);
});

test('buildTree nests children by display_id parent', () => {
  const roots = R.buildTree(tasks);
  const demoRoot = roots.find(n => n.task.display_id === '600');
  assert.ok(demoRoot);
  assert.strictEqual(demoRoot.children.length, 5);
  assert.deepStrictEqual(demoRoot.children.map(c => c.task.display_id), ['600.1', '600.2', '600.3', '600.4', '600.5']);
});

test('groupByProject buckets by project_slug', () => {
  const g = R.groupByProject(tasks);
  assert.strictEqual(g.demo.length, 6);
  assert.strictEqual(g.other.length, 1);
});

test('projectProgress excludes cancelled from the denominator', () => {
  const p = R.projectProgress(tasks.filter(t => t.project_slug === 'demo'));
  // 600.1 verified + 600.2 & 600.5 completed_unverified = 3 done of 6 active
  assert.strictEqual(p.active, 6);
  assert.strictEqual(p.done, 3);
  assert.strictEqual(p.pct, 50);
});

test('queueNext: actionable only when after-targets are done AND released', () => {
  const q = R.queueNext(tasks);
  const ids = q.actionable.map(t => t.display_id);
  // 600.3 has after=[600.2] which is completed_unverified (done) and is released -> actionable
  assert.ok(ids.includes('600.3'));
  // 600.4 after=[600.3] which is still queued (not done) -> NOT actionable, in waiting
  assert.ok(!ids.includes('600.4'));
  assert.ok(q.waiting.map(t => t.display_id).includes('600.4'));
});

test('queueNext: an unreleased queued task is NEVER näst på tur, even with no after-deps', () => {
  // README contract: queued + [released] + all [after:] done. A dep-free unreleased task
  // must not be actionable (regression: the old `|| after.length === 0` escape hatch).
  const unreleased = { display_id: '601', parent_id: null, status: 'queued', project_slug: 'demo', seat: null, title: 'Not released', released: false, after: [], onfail: [], cycles: null };
  const q = R.queueNext([unreleased]);
  assert.strictEqual(q.actionable.length, 0);
  // positive case: same task, released -> actionable
  const released = Object.assign({}, unreleased, { display_id: '602', released: true });
  const q2 = R.queueNext([released]);
  assert.deepStrictEqual(q2.actionable.map(t => t.display_id), ['602']);
});

test('verificationTail splits completed_unverified vs verified vs cancelled', () => {
  const v = R.verificationTail(tasks);
  // the back-compat `awaiting` field (dead, zero consumers) was removed in Wave A, MC 11526 —
  // the honest split below is the contract.
  assert.deepStrictEqual(v.verified.map(t => t.display_id), ['600.1']);
  assert.deepStrictEqual(v.cancelled.map(t => t.display_id), ['700']);
});

test('verificationTail HONEST three-way split: verifiable vs unverifiable vs verified', () => {
  const v = R.verificationTail(tasks);
  // 600.2 has a bar (verifiable=true) -> väntar verifiering
  assert.deepStrictEqual(v.awaitingVerifiable.map(t => t.display_id), ['600.2']);
  // 600.5 has NO bar (verifiable=false) -> ej verifierbar
  assert.deepStrictEqual(v.unverifiable.map(t => t.display_id), ['600.5']);
  assert.deepStrictEqual(v.verified.map(t => t.display_id), ['600.1']);
});

test('verifyState maps status+verifiable to the three states', () => {
  assert.strictEqual(R.verifyState({ status: 'completed_unverified', verifiable: true }), 'pending');
  assert.strictEqual(R.verifyState({ status: 'completed_unverified', verifiable: false }), 'unverifiable');
  assert.strictEqual(R.verifyState({ status: 'completed_unverified' }), 'unverifiable'); // missing flag => no bar
  assert.strictEqual(R.verifyState({ status: 'verified' }), 'verified');
  assert.strictEqual(R.verifyState({ status: 'deployed' }), 'verified');
  assert.strictEqual(R.verifyState({ status: 'queued' }), null);
});

test('renderVerification shows the three states, legend, and exact Swedish labels', () => {
  const board = { id: 'demo', label: 'Demo', tasks: tasks };
  const html = R.renderVerification(board);
  assert.ok(html.includes('vlegend'));                                  // legend present
  assert.ok(html.includes('väntar verifiering'));                       // state (a) label
  assert.ok(html.includes('ej verifierbar – saknar acceptanskriterier')); // state (b) label
  assert.ok(html.includes('verifierad'));                              // state (c) label
  assert.ok(html.includes('vbadge--pending'));
  assert.ok(html.includes('vbadge--unverifiable'));
  assert.ok(html.includes('vbadge--verified'));
});

test('dependencyEdges emits after + onfail edges', () => {
  const e = R.dependencyEdges(tasks);
  const after = e.filter(x => x.kind === 'after');
  const onfail = e.filter(x => x.kind === 'onfail');
  assert.strictEqual(after.length, 3);   // 600.2, 600.3, 600.4
  assert.strictEqual(onfail.length, 1);  // 600.3
});

test('renderers produce HTML and escape untrusted text', () => {
  const board = { id: 'demo', label: 'Demo', tasks: tasks.concat([
    { display_id: '999', parent_id: null, status: 'queued', project_slug: 'x', seat: null, title: '<script>alert(1)</script>', released: false, after: [], onfail: [], cycles: null }
  ]) };
  const html = R.renderProjects(board);
  assert.ok(html.includes('progress__bar'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(R.renderQueue(board).includes('Näst på tur'));
  assert.ok(R.renderVerification(board).includes('verifiering'));
  assert.ok(R.renderDependencies(board).includes('beroendekanter'));
});

test('empty and error states', () => {
  assert.ok(R.renderProjects({ tasks: [] }).includes('Inga jobb'));
  assert.ok(R.renderProjects({ error: 'boom', tasks: [] }).includes('kunde inte'));
});

// ---- MC 11525 Wave B row #5: accumulators keyed by EXTERNAL data must be
// prototype-key-proof. A project_slug/parent_id named "constructor"/"__proto__"/
// "toString" hit the Object.prototype chain of a `{}` map and threw TypeError,
// killing the whole tab every poll (audit R3-protokey-red-green.log precedent).
test('groupByProject: proto-key project slugs (constructor/__proto__/toString) group sanely, never throw', () => {
  const tasks = ['constructor', '__proto__', 'toString', 'demo'].map(slug => ({
    display_id: '1', parent_id: null, status: 'queued', project_slug: slug,
    after: [], onfail: [], released: false, title: 'x',
  }));
  const g = R.groupByProject(tasks);
  assert.strictEqual(g['constructor'].length, 1);
  assert.strictEqual(g['__proto__'].length, 1);
  assert.strictEqual(g['toString'].length, 1);
  assert.strictEqual(Object.keys(g).length, 4);
});

test('buildTree: proto-key parent_ids fall to roots, never throw', () => {
  const parent = { display_id: '42', parent_id: null, status: 'verified', after: [], onfail: [], released: false };
  ['__proto__', 'constructor', 'toString'].forEach(pid => {
    const child = { display_id: '43', parent_id: pid, status: 'queued', after: [], onfail: [], released: false };
    const roots = R.buildTree([parent, child]);
    assert.ok(roots.some(n => n.task.display_id === '43'),
      'task with parent_id ' + JSON.stringify(pid) + ' must land among the roots');
  });
});

test('renderVerification: a heading never states a count the rows below contradict (cap disclosed)', () => {
  const many = [];
  for (let i = 0; i < 70; i++) many.push({ display_id: String(1000 + i), status: 'verified',  project_slug: 'p', after: [], onfail: [] });
  for (let i = 0; i < 45; i++) many.push({ display_id: String(2000 + i), status: 'cancelled', project_slug: 'p', after: [], onfail: [] });
  const html = R.renderVerification({ tasks: many });
  assert.ok(html.includes('Verifierade / driftsatta · visar 60 av 70'), 'verified heading discloses the cap');
  assert.ok(html.includes('Avbrutna · visar 40 av 45'), 'cancelled heading discloses the cap');
  // the rows rendered under each capped heading equal the disclosed cap
  const secs = html.split('<section class="sec">').slice(1);
  const rowsOf = (needle) => (secs.find(s => s.includes(needle)).match(/<li class="row /g) || []).length;
  assert.strictEqual(rowsOf('visar 60 av 70'), 60);
  assert.strictEqual(rowsOf('visar 40 av 45'), 40);
  // under the cap the plain count is kept, and it equals the rows
  const few = R.renderVerification({ tasks: many.slice(0, 5).concat(many.slice(70, 73)) });
  assert.ok(few.includes('Verifierade / driftsatta · 5'));
  assert.ok(few.includes('Avbrutna · 3'));
  assert.strictEqual(R.cappedTitle('X', 60, 60), 'X · 60');       // exactly at the cap: no disclosure needed
  assert.strictEqual(R.cappedTitle('X', 61, 60), 'X · visar 60 av 61');
});

// ---- MC 11525 Wave B row #6 — PRODUCT DECISION (verbatim, commit body):
// queued+unreleased+deps-done now shows in waiting. Such a task is NOT actionable
// (release gates action), but it must never be invisible across all four buckets.
test('queueNext: queued + released:false + deps done lands in waiting, not in 0-of-4 invisibility', () => {
  const dep = { display_id: '810', status: 'verified', after: [], onfail: [], released: true };
  const stuck = { display_id: '811', status: 'queued', released: false, after: ['810'], onfail: [] };
  const q = R.queueNext([dep, stuck]);
  assert.deepStrictEqual(q.actionable.map(t => t.display_id), [], 'unreleased is never actionable');
  assert.deepStrictEqual(q.waiting.map(t => t.display_id), ['811'], 'shown=1 via the waiting bucket');
  assert.strictEqual(q.inflight.length + q.gated.length, 0);
});

// ---- MC 11525 Wave B row #19: named behaviours the audit found untested. Each pin
// was proven to go RED by a planted fault on a scratch copy (see OUT/evidence/
// b4-plant-red.log) before its GREEN was trusted.

test('svgGraph geometry (MC 11525 #19i): corpus nodes present as SVG nodes, line count equals edge count', () => {
  const edges = R.dependencyEdges(tasks);
  const html = R.renderDependencies({ tasks });
  const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
  assert.ok(svg.length > 0, 'the corpus has edges, so an SVG must be drawn');
  // every on-board id involved in an edge gets a node; edges here: 600.1..600.4
  ['600.1', '600.2', '600.3', '600.4'].forEach(id =>
    assert.ok(svg.includes('>' + id + '</text>'), 'SVG node text for ' + id));
  assert.strictEqual((svg.match(/class="gnode /g) || []).length, 4);
  assert.strictEqual((svg.match(/<line /g) || []).length, edges.length);
});

test('off-board dep 999.9 (MC 11525 #19i): shown in the edge list, absent from the SVG (ARCHITECTURE graph rule)', () => {
  const g = [
    { display_id: '70', status: 'queued', project_slug: 'p', after: ['999.9'], onfail: [] },
    { display_id: '71', status: 'queued', project_slug: 'p', after: ['70'], onfail: [] },
  ];
  const html = R.renderDependencies({ tasks: g });
  assert.ok(html.includes('<code>999.9</code>'), 'edge list shows the raw off-board from-id');
  const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
  assert.ok(svg.length > 0);
  assert.ok(!svg.includes('999.9'), 'the graph draws on-board nodes only — no node for 999.9');
  assert.strictEqual((svg.match(/<line /g) || []).length, 1, 'the off-board edge draws no line');
});

test('self-parent task (display_id === parent_id) becomes a root and renders without crash (MC 11525 #19ii pin)', () => {
  const t = { display_id: '80', parent_id: '80', status: 'queued', project_slug: 'p', after: [], onfail: [], released: false, title: 'me' };
  const roots = R.buildTree([t]);
  assert.strictEqual(roots.length, 1, 'self-parent must not vanish or double');
  assert.deepStrictEqual(roots.map(n => n.task.display_id), ['80']);
  assert.strictEqual(roots[0].children.length, 0, 'and must not parent itself');
  assert.ok(R.renderProjects({ tasks: [t] }).includes('node__id'), 'renders without hang/crash');
});

test('owner_approved IS dependency-done: it unblocks [after:] targets (MC 11525 #19iii vocab pin)', () => {
  // ARCHITECTURE "Status vocabulary": owner_approved (Godkänd, done). The audit's
  // named behaviour was exactly this C4↔C5 interaction ("owner_approved dep unblocks").
  assert.strictEqual(R.isDone('owner_approved'), true);
  const dep = { display_id: '85', status: 'owner_approved', after: [], onfail: [] };
  const t = { display_id: '86', status: 'queued', released: true, after: ['85'], onfail: [] };
  const q = R.queueNext([dep, t]);
  assert.deepStrictEqual(q.actionable.map(x => x.display_id), ['86']);
  assert.strictEqual(q.waiting.length, 0);
});

test('integration (MC 11525 #19iv): proto-key shapes + queued-unreleased-deps-done render together without throwing', () => {
  const board = { tasks: [
    { display_id: '900', parent_id: '__proto__', status: 'verified', project_slug: 'constructor', after: [], onfail: [], released: false },
    { display_id: '901', parent_id: '900', status: 'queued', project_slug: '__proto__', after: ['900'], onfail: [], released: false },
    { display_id: '902', parent_id: 'constructor', status: 'running', project_slug: 'toString', after: [], onfail: [], released: false },
  ] };
  const proj = R.renderProjects(board);
  assert.ok(proj.includes('constructor') && proj.includes('__proto__'), 'proto-key projects render as cards');
  const q = R.renderQueue(board);
  assert.ok(q.includes('901'), 'the queued+unreleased+deps-done task is visible in the queue tab');
});
