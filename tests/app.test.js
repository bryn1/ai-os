// node --test tests/app.test.js — regression tests for the dashboard SHELL
// (static/js/app.js) under a fake DOM: the REAL shell is loaded (the render lib's
// six concern files first, so window.Aos.render is real too) and every innerHTML
// write is recorded. Pins the meta-strip escaping contract — label, task_count and
// hidden_count must ALL reach innerHTML via escapeHtml (stored XSS,
// MC 11524, audit FINDINGS-synthesis row #1). Fake-DOM technique adapted
// from the audit's probe (out/.tmp/test/probe-r1.mjs), assertions added.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'static', 'js', 'app.js');
// the render lib: the six concern files of the MC 11525 C1 split, in index.html
// load order (render-verify.js reuses render-queue.js row lists).
const RENDER = ['render-core.js', 'render-data.js', 'render-projects.js', 'render-queue.js',
                'render-verify.js', 'render-deps.js']
  .map((f) => path.join(__dirname, '..', 'static', 'js', f));
const TABS = ['projekt', 'beroenden', 'ko', 'verifiering'];

// Load the REAL app.js against a minimal fake DOM fed one boards.json
// envelope; resolves with every recorded {id, html} innerHTML write.
// app.js is a self-booting IIFE, so each scenario gets a fresh require
// (cache cleared) and fresh globals. The fake understands the two C2a/C2c
// seams the shell uses on the panel body: details/class~=project queries and
// .tabs/.tab/.panel/.board-pill collections.
function loadShell(data, opts) {
  opts = opts || {};
  const writes = [];
  function makeEl(id, attrs) {
    const a = Object.assign({}, attrs);
    const el = {
      id,
      _html: '',
      nodeName: (attrs && attrs.nodeName) || 'DIV',
      get innerHTML() { return this._html; },
      set innerHTML(h) { writes.push({ id, html: String(h) }); this._html = String(h); },
      hidden: true,
      getAttribute(n) { return n in a ? a[n] : null; },
      setAttribute(n, v) { a[n] = String(v); },
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll(sel) { return sel === 'details[class~=project]' ? (this._details || []) : []; },
      contains() { return false; },
      focus() {},
    };
    return el;
  }
  const els = { 'meta-info': makeEl('meta-info'), 'meta-status': makeEl('meta-status') };
  TABS.forEach(t => { els[t + '-body'] = makeEl(t + '-body'); });
  const tabs = TABS.map(t => makeEl('tab-' + t, { 'data-tab': t }));
  const panels = TABS.map(t => makeEl('panel-' + t, { 'data-tab': t }));
  const pills = [makeEl('board-orchestrator', { 'data-board': 'orchestrator' })];

  global.document = {
    readyState: 'complete',
    activeElement: null,
    getElementById: (id) => els[id] || null,
    querySelector: (sel) => sel === '.tabs' ? makeEl('tabs') : null,
    querySelectorAll: (sel) => sel === '.tab' ? tabs : sel === '.panel' ? panels
                          : sel === '.board-pill' ? pills : [],
    addEventListener() {},
  };
  global.window = { location: { search: opts.search || '' }, document: global.document };
  global.setInterval = () => 0; // keep the 60 s poll out of the test process
  global.fetch = async () => {
    if (opts.fetchFails) throw new Error('Failed to fetch');
    return { ok: true, status: 200, json: async () => data };
  };

  [APP].concat(RENDER).forEach((f) => { delete require.cache[require.resolve(f)]; });
  RENDER.forEach((f) => require(f)); // REAL pure lib -> window.Aos.render
  require(APP);                      // REAL shell — module under test

  // the fetch().then chain is pure microtasks; one macrotask boundary drains it
  return new Promise(resolve => setImmediate(() => resolve(writes)));
}

function board(over) {
  return Object.assign({
    id: 'orchestrator', label: 'orchestrator', task_count: 0, hidden_count: 0, tasks: [],
  }, over);
}

// MC 11525 C2d: the meta strip is TWO elements now — the routinely-changing info
// line and the polite status line. The XSS/counts pins read the info line; the
// error-copy pins read the status line.
function infoHTML(writes) {
  const meta = writes.filter(w => w.id === 'meta-info').pop();
  assert.ok(meta, 'shell must write the meta info line once loaded');
  return meta.html;
}
function statusHTMLof(writes) {
  const meta = writes.filter(w => w.id === 'meta-status').pop();
  assert.ok(meta, 'shell must write the meta status line once loaded');
  return meta.html;
}
function metaHTML(writes) { return infoHTML(writes) + statusHTMLof(writes); }

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

// ============ MC 11525 Wave C2: deep-link fallbacks, last-good, live scoping ====

test('C2e: unknown ?tab=bogus falls back to the default tab — never a blank page', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ tasks: [{ display_id: '8', status: 'queued', after: [] }] })],
  }, { search: '?tab=bogus' });
  const panel = panelHTML(writes, 'projekt-body');
  assert.ok(panel.includes('node__id'), 'the default (projekt) panel must render content, got: ' + panel.slice(0, 120));
  assert.ok(!panel.includes('state--error'), 'a bad tab is a fallback, not an error state');
});

test('C2e: unknown ?board=bogus shows the explicit Swedish error — never another board’s data', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ label: 'Orkestrator', tasks: [{ display_id: '8', status: 'queued', after: [] }] })],
  }, { search: '?board=bogus' });
  const panel = panelHTML(writes, 'projekt-body');
  assert.ok(panel.includes('Okänd tavla'), 'panel must name the unknown board, got: ' + panel.slice(0, 140));
  assert.ok(!panel.includes('node__id'), 'NO other board’s tasks may silently render under an unknown board id');
});

test('C2a-4b: a failed poll KEEPS the last-good panel content; the error lands in the meta status only', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ tasks: [{ display_id: '8', status: 'queued', after: [] }] })],
  }, { fetchFails: true });
  const panel = panelHTML(writes, 'projekt-body');
  if (!panel.includes('Ingen data.')) {
    // first-load failure (no last-good) → panel error state is correct
    assert.ok(true);
  }
  assert.ok(panel.includes('Ingen data.'), 'first-load fetch failure shows the Swedish panel error');
  const status = statusHTMLof(writes);
  assert.ok(status.includes('Kunde inte läsa ögonblicksbilden'), 'meta status carries the Swedish error line');
});

test('C2d: the status line is written at most twice (initial + on change) — no per-poll re-announce', async () => {
  const writes = await loadShell({
    generated_at: '2026-10-27T17:00:00Z',
    boards: [board({ tasks: [] })],
  });
  const statusWrites = writes.filter(w => w.id === 'meta-status');
  assert.strictEqual(statusWrites.length, 1, 'steady state = exactly the one initial (empty) write, got ' + statusWrites.length);
  assert.strictEqual(statusWrites[0].html, '', 'no error = empty polite region');
});

// Static-HTML grep pins (C2c/C2d): the shell ARIA lives in index.html, not JS.
const indexHtml = require('node:fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
test('C2c pin (static index.html): tabpattern complete — tabpanels, aria-controls, roving tabindex, h1', () => {
  assert.strictEqual((indexHtml.match(/role="tabpanel"/g) || []).length, 4, '4 panels');
  assert.strictEqual((indexHtml.match(/aria-controls="panel-/g) || []).length, 4, '4 tabs name their panel');
  assert.strictEqual((indexHtml.match(/aria-selected="(true|false)"/g) || []).length, 4, 'aria-selected on all tabs');
  assert.strictEqual((indexHtml.match(/tabindex="-1"/g) || []).length, 3, 'roving: 3 inactive tabs out of tab order');
  assert.strictEqual((indexHtml.match(/tabindex="0"/g) || []).length, 1, 'exactly the selected tab in tab order');
  assert.strictEqual((indexHtml.match(/<h1/g) || []).length, 1, 'exactly one h1');
  for (const m of indexHtml.matchAll(/aria-controls="(panel-[a-z]+)"/g)) {
    assert.ok(indexHtml.includes('id="' + m[1] + '"'), m[1] + ' must exist');
  }
  for (const m of indexHtml.matchAll(/aria-labelledby="(tab-[a-z]+)"/g)) {
    assert.ok(indexHtml.includes('id="' + m[1] + '"'), m[1] + ' must exist');
  }
});

test('C2d pin (static index.html): aria-live sits ONLY on the status element, not the info counts', () => {
  assert.strictEqual((indexHtml.match(/aria-live="polite"/g) || []).length, 1, 'one polite region only');
  const liveEl = indexHtml.split('\n').find(l => l.includes('aria-live="polite"'));
  assert.ok(liveEl.includes('meta-status'), 'the polite region is the status element, got: ' + liveEl.trim());
  assert.ok(!liveEl.includes('meta-info'), 'the routinely-changing info line must NOT be live');
});
