// node --test tests/app.test.js — regression tests for the dashboard SHELL
// (static/js/app.js) under a fake DOM: the REAL shell is loaded (render.js
// first, so window.Aos.render is real too) and every innerHTML write is
// recorded. Pins the meta-strip escaping contract — label, task_count and
// hidden_count must ALL reach innerHTML via escapeHtml (stored XSS,
// MC 11524, audit FINDINGS-synthesis row #1). Fake-DOM technique adapted
// from the audit's probe (out/.tmp/test/probe-r1.mjs), assertions added.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'static', 'js', 'app.js');
const RENDER = path.join(__dirname, '..', 'static', 'js', 'render.js');
const TABS = ['projekt', 'beroenden', 'ko', 'verifiering'];

// Load the REAL app.js against a minimal fake DOM fed one boards.json
// envelope; resolves with every recorded {id, html} innerHTML write.
// app.js is a self-booting IIFE, so each scenario gets a fresh require
// (cache cleared) and fresh globals.
function loadShell(data) {
  const writes = [];
  function makeEl(id, attrs) {
    const a = Object.assign({}, attrs);
    return {
      id,
      _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(h) { writes.push({ id, html: String(h) }); this._html = String(h); },
      hidden: true,
      getAttribute(n) { return n in a ? a[n] : null; },
      setAttribute(n, v) { a[n] = String(v); },
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {},
    };
  }
  const els = { 'meta-bar': makeEl('meta-bar') };
  TABS.forEach(t => { els[t + '-body'] = makeEl(t + '-body'); });
  const tabs = TABS.map(t => makeEl('tab-' + t, { 'data-tab': t }));
  const panels = TABS.map(t => makeEl('panel-' + t, { 'data-tab': t }));
  const pills = [makeEl('board-orchestrator', { 'data-board': 'orchestrator' })];

  global.document = {
    readyState: 'complete',
    getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => sel === '.tab' ? tabs : sel === '.panel' ? panels
                          : sel === '.board-pill' ? pills : [],
    addEventListener() {},
  };
  global.window = { location: { search: '' }, document: global.document };
  global.setInterval = () => 0; // keep the 60 s poll out of the test process
  global.fetch = async () => ({ ok: true, status: 200, json: async () => data });

  delete require.cache[require.resolve(APP)];
  delete require.cache[require.resolve(RENDER)];
  require(RENDER); // REAL pure lib -> window.Aos.render
  require(APP);    // REAL shell — module under test

  // the fetch().then chain is pure microtasks; one macrotask boundary drains it
  return new Promise(resolve => setImmediate(() => resolve(writes)));
}

function board(over) {
  return Object.assign({
    id: 'orchestrator', label: 'orchestrator', task_count: 0, hidden_count: 0, tasks: [],
  }, over);
}

function metaHTML(writes) {
  const meta = writes.filter(w => w.id === 'meta-bar').pop();
  assert.ok(meta, 'shell must write the meta-bar innerHTML once loaded');
  return meta.html;
}

function panelHTML(writes, id) {
  const p = writes.filter(w => w.id === id).pop();
  assert.ok(p, 'shell must write ' + id + ' innerHTML once loaded');
  return p.html;
}

test('meta strip escapes a task_count payload — no raw HTML into innerHTML', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ task_count: '<img src=x onerror=alert(1)>' })],
  });
  const html = metaHTML(writes);
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'),
    'task_count payload must NOT reach innerHTML raw (stored XSS, MC 11524)');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'),
    'task_count payload must come out escaped');
});

test('meta strip escapes a hidden_count payload — no raw HTML into innerHTML', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ hidden_count: '<svg onload=alert(2)>' })],
  });
  const html = metaHTML(writes);
  assert.ok(!html.includes('<svg onload=alert(2)>'),
    'hidden_count payload must NOT reach innerHTML raw (stored XSS, MC 11524)');
  assert.ok(html.includes('&lt;svg onload=alert(2)&gt;'),
    'hidden_count payload must come out escaped');
});

test('meta strip renders numeric counts unchanged — happy path pinned', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ task_count: 42, hidden_count: 3, tasks: [1, 2].map(i => ({ display_id: String(i) })) })],
  });
  const html = metaHTML(writes);
  assert.ok(html.includes('42 jobb'), 'numeric task_count must render its number');
  assert.ok(html.includes('3 dolda'), 'numeric hidden_count must render its number');
});

test('meta strip escapes the board label — pins the pre-existing behaviour', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ label: '<img src=x onerror=alert(90)>' })],
  });
  const html = metaHTML(writes);
  assert.ok(!html.includes('<img src=x onerror=alert(90)>'),
    'label payload must NOT reach innerHTML raw');
  assert.ok(html.includes('&lt;img src=x onerror=alert(90)&gt;'),
    'label payload must come out escaped');
});

// ---- MC 11525 Wave B row #7: a malformed-but-valid JSON body must be validated
// ONCE in load(), before any render call, and land on the EXISTING Swedish error
// path ("Ingen data." panel + "Kunde inte läsa ögonblicksbilden" meta line) —
// never a raw English TypeError in the panel, never a silently empty render.

const ENVELOPE_TESTS = [
  { name: 'tasks:[null] (non-object task entry)', over: { tasks: [null] } },
  { name: 'tasks:"hello" (tasks not an array)', over: { tasks: 'hello' } },
  { name: 'task after:"x" (after not an array of strings)', over: { tasks: [{ display_id: '7', after: 'x' }] } },
];

ENVELOPE_TESTS.forEach(({ name, over }) => {
  test('malformed envelope ' + name + ' → Swedish error panel, no TypeError, no silent empty', async () => {
    const writes = await loadShell({
      generated_at: '2026-10-27T17:00:00Z',
      boards: [board(over)],
    });
    const panel = panelHTML(writes, 'projekt-body');
    assert.ok(panel.includes('state--error'), 'panel must be the error state, got: ' + panel.slice(0, 120));
    assert.ok(panel.includes('Ingen data.'), 'panel must show the existing Swedish error copy');
    assert.ok(!panel.includes('TypeError'), 'no raw engine error may reach the panel');
    const meta = metaHTML(writes);
    assert.ok(meta.includes('Kunde inte läsa ögonblicksbilden'), 'meta must carry the Swedish error line');
    assert.ok(!meta.includes('TypeError'), 'no raw engine error may reach the meta bar');
  });
});

test('a valid envelope still renders content — validation must not reject the good path', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ tasks: [{ display_id: '8', parent_id: null, project_slug: 'p', status: 'queued', after: [], onfail: [], released: false }] })],
  });
  const panel = panelHTML(writes, 'projekt-body');
  assert.ok(!panel.includes('state--error'), 'valid envelope must not hit the error state: ' + panel.slice(0, 120));
  assert.ok(panel.includes('node__id'), 'task must render into the projekt panel');
});
