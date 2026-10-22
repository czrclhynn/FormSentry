const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared.js'), P = require('../event-processor.js');
function fixture(rules = {}) {
  const session = { id: 's_test', active: true, correlationMs: 500, exam: { id: 'x', name: 'Exam', url: '', mode: 'RESTRICTION', rules: { ...S.DEFAULT_RULES, ...rules } }, processor: P.state() };
  const events = []; let n = 0;
  return { session, events, emit: (type, at = 1000 + n, metadata = {}, id = 'i' + n++) => P.process(session, events, { type, at, metadata, id }) };
}
test('one tab departure groups blur/hidden and returns only once', () => {
  const f = fixture();
  for (const [i, t] of ['WINDOW_BLUR', 'PAGE_HIDDEN', 'TAB_SWITCH', 'TAB_RETURN', 'PAGE_VISIBLE', 'WINDOW_FOCUS'].entries()) f.emit(t, 1000 + i * 10);
  assert.deepEqual(f.events.map(e => e.type), ['TAB_SWITCH']);
  assert.equal(f.events[0].metadata.signals.length, 3); assert.equal(S.metrics(f.events).review, 1); assert.equal(f.events[0].metadata.durationMs, 30);
});
test('rapid separate switches are retained even within correlation window', () => {
  const f = fixture(); ['TAB_SWITCH', 'TAB_RETURN', 'TAB_SWITCH', 'TAB_RETURN'].forEach((t, i) => f.emit(t, 1000 + i));
  assert.equal(f.events.length, 2); assert.equal(new Set(f.events.map(e => e.id)).size, 2);
});
test('switching between other tabs stays within the same departure episode', () => {
  const f = fixture(); f.emit('TAB_SWITCH', 1000, { tabId: 2 }); f.emit('TAB_SWITCH', 1001, { tabId: 3 });
  assert.equal(f.events.length, 1);
});
test('focus loss has one record with browser and document support', () => {
  const f = fixture(); ['WINDOW_BLUR', 'BROWSER_BLUR', 'BROWSER_FOCUS', 'WINDOW_FOCUS'].forEach((t, i) => f.emit(t, 1000 + i));
  assert.deepEqual(f.events.map(e => e.type), ['FOCUS_LOST']); assert.equal(f.events[0].metadata.durationMs, 2);
});
test('only actual return closes a tab departure despite focus events', () => {
  const f = fixture(); f.emit('TAB_SWITCH'); f.emit('WINDOW_FOCUS'); assert.equal(f.events.length, 1); assert.ok(f.session.processor.episode); f.emit('TAB_RETURN'); assert.equal(f.events.length, 1); assert.equal(f.session.processor.episode, null);
});
test('new tab activation is supporting detail of new tab action', () => {
  const f = fixture(); f.emit('NEW_TAB_OPENED', 1000, { tabId: 2 }); f.emit('WINDOW_BLUR', 1001); f.emit('TAB_SWITCH', 1002, { tabId: 2 });
  assert.equal(f.events.length, 1); assert.equal(f.events[0].type, 'NEW_TAB_OPENED'); assert.equal(S.metrics(f.events).review, 1);
});
test('same input ID is replay-safe; two copy attempts with new IDs are retained', () => {
  const f = fixture(); f.emit('COPY_ATTEMPT', 1000, {}, 'a'); f.emit('COPY_ATTEMPT', 1001, {}, 'a'); f.emit('COPY_ATTEMPT', 1002, {}, 'b');
  assert.equal(f.events.length, 2);
});
test('fullscreen and network use state edges, not event throttling', () => {
  const f = fixture();
  ['FULLSCREEN_EXIT', 'FULLSCREEN_EXIT', 'FULLSCREEN_ENTER', 'FULLSCREEN_EXIT', 'NETWORK_DISCONNECTED', 'NETWORK_DISCONNECTED', 'NETWORK_RECONNECTED'].forEach(t => f.emit(t));
  assert.equal(f.events.length, 5); assert.equal(S.metrics(f.events).review, 2);
});
test('disabled rules ignore activity and monitored copy requires contextual review', () => {
  const f = fixture({ tabSwitch: 'OFF', copyPaste: 'MONITOR', devtools: 'ALLOW' }); f.emit('TAB_SWITCH'); f.emit('COPY_ATTEMPT'); f.emit('DEVTOOLS_SHORTCUT');
  assert.equal(f.events.length, 1); assert.equal(f.events[0].category, 'REVIEW');
});
test('domain monitoring uses review category without a cheating verdict', () => {
  const f = fixture(); f.emit('DOMAIN_VISIT', 1000, { disallowed: false }); f.emit('DOMAIN_VISIT', 1001, { disallowed: true });
  assert.equal(S.metrics(f.events).review, 2);
});
test('no activities after end or from a different session', () => {
  const f = fixture(); P.process(f.session, f.events, { type: 'COPY_ATTEMPT', sessionId: 'wrong' }); f.session.active = false; f.emit('COPY_ATTEMPT'); assert.equal(f.events.length, 0);
});
test('persistent reducer state retains replay protection and correlation', () => {
  const f = fixture(); f.emit('WINDOW_BLUR', 1000, {}, 'a');
  const restored = JSON.parse(JSON.stringify(f.session)); P.process(restored, f.events, { type: 'TAB_SWITCH', at: 1100, id: 'b' });
  P.process(restored, f.events, { type: 'COPY_ATTEMPT', at: 1200, id: 'a' }); assert.equal(f.events.length, 1); assert.equal(f.events[0].type, 'TAB_SWITCH');
});
test('late content signals cannot reopen an already returned episode', () => {
  const f = fixture(); f.emit('TAB_SWITCH', 1000); f.emit('TAB_RETURN', 1200); f.emit('PAGE_HIDDEN', 1100); assert.equal(f.events.length, 1);
});
test('strict form validation rejects spoofed hosts, editors, credentials and short URLs', () => {
  for (const url of ['https://evil.test/forms/d/a/viewform', 'https://docs.google.com.evil.test/forms/d/a/viewform', 'http://docs.google.com/forms/d/a/viewform', 'https://u:p@docs.google.com/forms/d/a/viewform', 'https://docs.google.com/forms/d/a/edit', 'https://forms.gle/abc']) assert.throws(() => S.examURL(url));
  assert.equal(S.examURL('https://docs.google.com/forms/d/e/abc/viewform?usp=sharing'), 'https://docs.google.com/forms/d/e/abc/viewform');
});
test('domain parsing validates lines and most-specific exceptions win', () => {
  const rules = S.parseDomains('example.com,OTHER,BLOCKED\nsafe.example.com,OTHER,ALLOWED');
  assert.equal(S.classifyDomain(rules, 'safe.example.com').action, 'ALLOWED'); assert.equal(S.classifyDomain(rules, 'notexample.com'), undefined);
  assert.throws(() => S.parseDomains('https://example.com,AI')); assert.throws(() => S.parseDomains('example.com,AI\nexample.com,AI'));
});
test('CSV prevents spreadsheet formulas and quotes metadata', () => {
  const text = S.csv([{ examName: '=1+1', type: 'X', metadata: { text: 'a,"b' } }]);
  assert.ok(text.includes("'=1+1")); assert.ok(text.includes('""text""'));
});
test('migration fills missing rules without renaming storage configuration', () => {
  const cfg = S.normalizeConfig({ exams: [{ id: 'old', name: 'Old', rules: { copyPaste: 'ALLOW' } }], endpoint: 'https://legacy.test' });
  assert.equal(cfg.exams[0].id, 'old'); assert.equal(cfg.exams[0].rules.copyPaste, 'ALLOW'); assert.equal(cfg.exams[0].rules.shortcuts, 'BLOCK');
});
