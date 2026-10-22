/* FormSentry MV3 worker: the only writer of configuration, sessions and activity. */
importScripts('shared.js', 'event-processor.js', 'cloud-config.js', 'cloud-client.js', 'cloud-sync.js');
const S = FormSentry, P = FormSentryProcessor;
let queue = Promise.resolve();
function serial(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; }
async function save(db) {
  FormSentrySync.stage(db);
  const openId = db.session?.processor?.episode?.id;
  const openEvent = (db.events || []).find(e => e.id === openId);
  db.events = (db.events || []).slice(-3000);
  // An unfinalized departure must survive the display-history limit.
  if (openEvent && !db.events.some(e => e.id === openId)) db.events.unshift(openEvent);
  db.testEvents = (db.testEvents || []).slice(-500);
  if (db.session) {
    const { processor, documentId, previousDocuments, cloud, ...summary } = db.session;
    db.sessions = [...(db.sessions || []).filter(s => s.id !== summary.id), summary].slice(-100);
  }
  await chrome.storage.local.set(db);
}
async function load() {
  const db = await chrome.storage.local.get(['config', 'session', 'sessions', 'events', 'testEvents', 'schemaVersion', 'outbox', 'invitations', 'pendingAttempt']);
  db.config = S.normalizeConfig(db.config); db.events ||= []; db.sessions ||= []; db.testEvents ||= [];
  if (db.schemaVersion !== 2) {
    const real = [];
    for (const e of db.events) {
      if (e.metadata?.SIMULATED_EVENT) db.testEvents.push({ ...e, simulated: true, sessionId: null });
      else real.push({ ...e, category: e.category || 'LEGACY', legacy: !e.category });
    }
    db.events = real;
    if (db.session?.active && !db.session.exam) {
      Object.assign(db.session, { active: false, status: 'INTERRUPTED', endedAt: Date.now(), endReason: 'Extension upgraded; start a new session.' });
      db.events.push({ id: `${db.session.id}:upgrade`, sessionId: db.session.id, timestamp: new Date().toISOString(), type: 'SESSION_INTERRUPTED', category: 'SYSTEM', severity: 'MEDIUM', metadata: { reason: db.session.endReason } });
    }
    db.schemaVersion = 2; await save(db);
  }
  return db;
}
const event = (db, type, fields = {}) => P.process(db.session, db.events, { type, at: Date.now(), ...fields });
async function publish(db) {
  const s = db.session;
  await chrome.action.setBadgeText({ text: s?.active ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#285bb5' });
  if (s?.tabId != null) {
    try { await chrome.tabs.sendMessage(s.tabId, { kind: 'SESSION_STATE', sessionId: s.id, active: s.active, status: s.status }, { frameId: 0 }); }
    catch { /* Navigating/closed pages rehydrate state through HELLO. */ }
  }
}
async function finish(db, reason, interrupted = false) {
  if (!db.session?.active) return;
  const s = db.session, episode = s.processor?.episode;
  if (episode) {
    const departure = db.events.find(e => e.id === episode.id);
    if (departure) { departure.metadata.durationMs = Math.max(0, Date.now() - episode.at); departure.metadata.endedWhileAway = true; }
    s.processor.episode = null;
  }
  if (s.cloud && !s.cloud.final) s.cloud.final = interrupted ? 'interrupted' : 'submission_unverified';
  event(db, interrupted ? 'SESSION_INTERRUPTED' : 'EXAM_ENDED', { metadata: { reason } });
  Object.assign(db.session, { active: false, status: interrupted ? 'INTERRUPTED' : s.cloud?.final === 'technical_issue' ? 'TECHNICAL_ISSUE' : s.cloud?.final === 'submission_unverified' ? 'SUBMISSION_UNVERIFIED' : 'COMPLETED', endedAt: Date.now(), endReason: reason });
  await save(db); await publish(db);
}
function ui(sender, pages) {
  if (sender.id !== chrome.runtime.id) return false;
  try { return pages.some(path => new URL(sender.url).href.split(/[?#]/)[0] === chrome.runtime.getURL(path)); } catch { return false; }
}
function bound(sender, s, document = true) {
  return !!s && sender.id === chrome.runtime.id && sender.frameId === 0 && sender.tab?.id === s.tabId &&
    S.formInfo(sender.url)?.id === S.formInfo(s.examUrl)?.id && (!document || sender.documentId === s.documentId);
}
async function focusExam(db) {
  if (!db.session?.active) throw new Error('There is no active exam.');
  const tab = await chrome.tabs.update(db.session.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}
async function enforce(db, operation) {
  try { await operation(); }
  catch { event(db, 'MONITOR_ERROR', { metadata: { reason: 'A browser restriction could not be applied. The tab may have closed.' } }); }
}
async function checkUrl(db, tab, value) {
  const s = db.session;
  if (!s?.active || tab.windowId !== s.windowId || tab.id === s.tabId || tab.active === false || !value) return;
  let u; try { u = new URL(value); } catch { return; }
  if (!['https:', 'http:'].includes(u.protocol)) { delete s.processor.navigation[tab.id]; return; }
  // Query/hash changes and repeated loading notifications are the same website visit.
  // Store a digest for correlation, never the path/query, in the session state.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(u.origin + u.pathname));
  const fingerprint = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
  const nav = s.processor.navigation;
  if (nav[tab.id] === fingerprint) return;
  nav[tab.id] = fingerprint;
  const keys = Object.keys(nav); if (keys.length > 300) delete nav[keys[0]];
  const host = u.hostname.toLowerCase().replace(/^www\./, ''), rule = S.classifyDomain(s.domainRules, host);
  if (rule && rule.action !== 'ALLOWED') {
    const ai = rule.category === 'AI', setting = ai ? s.exam.rules.ai : rule.action === 'BLOCKED' ? 'BLOCK' : 'MONITOR';
    if (setting !== 'ALLOW') {
      const disallowed = setting === 'BLOCK', blocked = disallowed && s.exam.mode === 'RESTRICTION';
      event(db, ai ? 'AI_WEBSITE_DETECTED' : 'DOMAIN_VISIT', { domain: host,
        metadata: { domainCategory: rule.category, disallowed, action: blocked ? 'BLOCK' : 'MONITOR', pdf: /\.pdf$/i.test(u.pathname) } });
      if (s.exam.warningMode) {
        try { await chrome.tabs.sendMessage(s.tabId, { kind: 'NOTICE', sessionId: s.id, message: 'A restricted-domain visit was recorded. Please return to the examination.' }, { frameId: 0 }); } catch { /* Exam may be navigating. */ }
      }
      if (blocked) await enforce(db, () => chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('blocked.html') + '?d=' + encodeURIComponent(host) }));
    }
  }
}
async function handle(m, sender) {
  const db = await load(), s = db.session, cfg = db.config;
  const admin = ui(sender, ['options.html']), popup = ui(sender, ['popup.html']);
  if (m.kind === 'SUMMARY') {
    if (!admin && !popup) throw new Error('This page cannot read monitoring records.');
    const safeSession = s ? { ...s, cloud: s.cloud ? { syncError: s.cloud.syncError, lastSyncAt: s.cloud.lastSyncAt, submission: s.cloud.submission } : undefined } : null;
    const currentEvents = [...new Map([
      ...(db.outbox?.[s?.id]?.events || []),
      ...db.events.filter(e => e.sessionId === s?.id)
    ].map(e => [e.id, e])).values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return { ok: true, session: safeSession, events: currentEvents, metrics: S.metrics(currentEvents), activeSessions: s?.active ? 1 : 0 };
  }
  if (m.kind === 'HELLO' || m.kind === 'GET_STATE') {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !S.formInfo(sender.url)) throw new Error('Not a supported Google Form.');
    let exam;
    if (s?.active && bound(sender, s, false)) {
      const tab = await chrome.tabs.get(sender.tab.id);
      if (S.formInfo(tab.url)?.id !== S.formInfo(s.examUrl)?.id) throw new Error('The exam tab has navigated away.');
      if (S.formInfo(sender.url)?.page === 'formResponse') {
        if (s.cloud) { s.cloud.submission = 'detected'; s.cloud.final = 'submission_unverified'; }
        event(db, 'SUBMISSION_DETECTED');
        await finish(db, 'Google Forms submission route observed (response acceptance is not verified).');
        return { ok: true, exam: s.exam, active: false, status: s.status, sessionId: s.id };
      }
      if (s.documentId !== sender.documentId) {
        if (s.previousDocuments?.includes(sender.documentId)) throw new Error('This document is no longer active.');
        s.previousDocuments = [...(s.previousDocuments || []), s.documentId].slice(-30);
        s.documentId = sender.documentId;
        event(db, 'EXAM_RECONNECTED', { metadata: { reason: 'Exam document loaded again; the existing session continues.' } });
      }
      s.lastContactAt = Date.now(); await save(db);
      return { ok: true, exam: s.exam, active: true, status: 'MONITORING', sessionId: s.id };
    }
    db.invitations ||= {};
    const previous = db.invitations[sender.tab.id], code = m.joinCode || previous?.joinCode;
    if (code) {
      if (!/^[a-f0-9]{48}$/.test(code)) throw new Error('Invalid invitation. Ask your teacher for the examination link.');
      const result = await FormSentryCloud.student({ action: 'resolve', joinCode: code });
      exam = FormSentryCloud.localExam(result.exam);
      if (S.formInfo(exam.url)?.id !== S.formInfo(sender.url)?.id) throw new Error('This invitation belongs to a different Google Form.');
      db.invitations[sender.tab.id] = { joinCode: code, exam }; await save(db);
    }
    return { ok: true, exam: exam || null, active: false, status: s && bound(sender, s, false) ? s.status : exam ? 'READY' : 'NOT_STARTED', sessionId: null, busy: !!s?.active };
  }
  if (m.kind === 'START') {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !sender.documentId) throw new Error('Start monitoring from the approved Google Form.');
    if (s?.active) {
      if (bound(sender, s)) return { ok: true, sessionId: s.id, exam: s.exam };
      throw new Error('Another exam session is active. End it before starting a new one.');
    }
    const invitation = db.invitations?.[sender.tab.id];
    if (!invitation || S.formInfo(sender.url)?.page !== 'viewform') throw new Error('Open the examination invitation link from your teacher first.');
    const name = String(m.name || '').trim(), email = String(m.email || '').trim().toLowerCase();
    if (name.length < 2 || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || m.consent !== true) throw new Error('Enter your full name and email and agree to monitoring before starting.');
    const resolved = await FormSentryCloud.student({ action: 'resolve', joinCode: invitation.joinCode });
    const exam = FormSentryCloud.localExam(resolved.exam);
    let validated = { ...S.validateExam(exam), warningMode: exam.warningMode, cloudRules: exam.cloudRules };
    let domainRules = exam.cloudRules.domains.map(domain => ({ domain, category: 'RESTRICTED', action: 'MONITORED' }));
    const tab = await chrome.tabs.get(sender.tab.id);
    if (S.formInfo(tab.url)?.id !== S.formInfo(exam.url).id) throw new Error('The tab has moved away from the approved form.');
    if (!db.pendingAttempt || db.pendingAttempt.joinCode !== invitation.joinCode || db.pendingAttempt.name !== name || db.pendingAttempt.email !== email) {
      db.pendingAttempt = { joinCode: invitation.joinCode, name, email, token: [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2,'0')).join('') };
      await save(db);
    }
    const attempt = db.pendingAttempt;
    const remote = await FormSentryCloud.student({ action: 'start', ...attempt, consent: true });
    if (remote.session.status !== 'active') throw new Error('This attempt has ended. Ask the teacher before starting another attempt.');
    if (remote.session.rules) {
      const snapshot = FormSentryCloud.localExam({ ...resolved.exam, rules: remote.session.rules });
      validated = { ...S.validateExam(snapshot), warningMode: snapshot.warningMode, cloudRules: snapshot.cloudRules };
      domainRules = snapshot.cloudRules.domains.map(domain => ({ domain, category: 'RESTRICTED', action: 'MONITORED' }));
    }
    db.session = { id: remote.session.id, active: true, status: 'MONITORING', exam: validated, examId: exam.id, examUrl: validated.url,
      student: { name, email, verified: false }, consentAt: Date.now(), cloud: { token: attempt.token, submission: 'not_detected' },
      tabId: tab.id, windowId: tab.windowId, documentId: sender.documentId, startedAt: Date.now(), lastContactAt: Date.now(),
      correlationMs: cfg.correlationMs, domainRules, processor: P.state() };
    db.pendingAttempt = null;
    db.session.processor.fullscreen = !!m.fullscreen; db.session.processor.online = m.online !== false;
    event(db, 'EXAM_STARTED', { metadata: { mode: exam.mode, rules: validated.rules } });
    await save(db); await publish(db);
    return { ok: true, sessionId: db.session.id, exam: validated };
  }
  if (m.kind === 'END') {
    if (!popup && !admin && !(s?.active && bound(sender, s) && m.sessionId === s.id)) throw new Error('Only the monitored exam or FormSentry controls can end this session.');
    if (s?.cloud) { s.cloud.final = m.technical ? 'technical_issue' : 'completed'; s.cloud.submission = 'unverified'; }
    await finish(db, m.technical ? 'Student stopped for a technical issue or withdrawal of consent.' : 'Monitoring ended explicitly; submission remains unverified.'); return { ok: true, status: db.session?.status };
  }
  if (m.kind === 'PING') {
    if (!s?.active || !bound(sender, s) || m.sessionId !== s.id) return { ok: true, active: false, status: s?.status || 'NOT_STARTED' };
    s.lastContactAt = Date.now(); await save(db); await FormSentrySync.flush(db, FormSentryCloud); await save(db); await publish(db); return { ok: true, active: s.active, status: s.status, syncError: s.cloud?.syncError };
  }
  if (m.kind === 'EVENT') {
    if (!s?.active || !bound(sender, s) || m.sessionId !== s.id) return { ok: true, active: false, status: s?.status || 'NOT_STARTED', recorded: false };
    const allowed = ['WINDOW_BLUR', 'WINDOW_FOCUS', 'PAGE_HIDDEN', 'PAGE_VISIBLE', 'FULLSCREEN_ENTER', 'FULLSCREEN_EXIT', 'NETWORK_DISCONNECTED', 'NETWORK_RECONNECTED', 'COPY_ATTEMPT', 'CUT_ATTEMPT', 'PASTE_ATTEMPT', 'CONTEXT_MENU_ATTEMPT', 'DEVTOOLS_SHORTCUT', 'KEYBOARD_SHORTCUT'];
    if (!allowed.includes(m.type) || typeof m.id !== 'string' || m.id.length > 160) throw new Error('Invalid activity message.');
    const now = Date.now(), at = Number.isFinite(m.at) ? Math.min(now, Math.max(s.startedAt, m.at)) : now;
    const record = event(db, m.type, { id: sender.documentId + ':' + m.id, at, sessionId: m.sessionId });
    s.lastContactAt = now; await save(db); return { ok: true, active: true, recorded: !!record };
  }
  if (m.kind === 'RETURN_TO_EXAM') {
    if (!admin && !popup && !ui(sender, ['blocked.html'])) throw new Error('Unavailable from this page.');
    await focusExam(db); return { ok: true };
  }
  throw new Error('Examination management requires the authenticated Supabase teacher dashboard.');
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  serial(() => handle(m || {}, sender)).then(reply, error => reply({ ok: false, error: error.message || 'FormSentry could not complete this operation.' }));
  return true;
});
function listen(emitter, fn) {
  emitter.addListener((...args) => {
    const at = Date.now();
    serial(async () => { const db = await load(); if (!db.session?.active) return; await fn(db, at, ...args); await save(db); })
      .catch(() => chrome.action.setBadgeText({ text: '!' }).catch(() => {}));
  });
}
listen(chrome.tabs.onActivated, async (db, at, { tabId, windowId }) => {
  const s = db.session; if (windowId !== s.windowId) return;
  event(db, tabId === s.tabId ? 'TAB_RETURN' : 'TAB_SWITCH', { at, metadata: { tabId } });
  if (tabId !== s.tabId) {
    try { const tab = await chrome.tabs.get(tabId); await checkUrl(db, tab, tab.url); } catch { /* Tab closed before inspection. */ }
    if (S.blocks(s.exam, 'tabSwitch')) await enforce(db, () => focusExam(db));
  }
});
listen(chrome.windows.onFocusChanged, async (db, at, windowId) => event(db, windowId === db.session.windowId ? 'BROWSER_FOCUS' : 'BROWSER_BLUR', { at }));
listen(chrome.tabs.onCreated, async (db, at, tab) => {
  const s = db.session; if (tab.windowId !== s.windowId) return;
  event(db, 'NEW_TAB_OPENED', { at, metadata: { tabId: tab.id } });
  if (S.blocks(s.exam, 'newTab')) { await enforce(db, () => chrome.tabs.remove(tab.id)); await enforce(db, () => focusExam(db)); }
  else await checkUrl(db, tab, tab.pendingUrl || tab.url);
});
listen(chrome.tabs.onUpdated, async (db, at, id, info, tab) => {
  if (!info.url) return;
  const s = db.session;
  if (id === s.tabId) {
    const f = S.formInfo(info.url);
    if (!f || f.id !== S.formInfo(s.examUrl)?.id) await finish(db, 'Exam tab navigated away from the approved form.', true);
    else if (f.page === 'formResponse') {
      if (s.cloud) { s.cloud.submission = 'detected'; s.cloud.final = 'submission_unverified'; }
      event(db, 'SUBMISSION_DETECTED'); await finish(db, 'Google Forms submission route observed (response acceptance is not verified).');
    }
  } else await checkUrl(db, tab, info.url);
});
listen(chrome.tabs.onRemoved, async (db, at, id) => {
  if (id === db.session.tabId) await finish(db, 'Exam tab closed.', true); else delete db.session.processor.navigation[id];
});
listen(chrome.tabs.onAttached, async (db, at, id, info) => {
  if (id === db.session.tabId && info.newWindowId !== db.session.windowId) await finish(db, 'Exam tab moved to another Chrome window; start a new session there.', true);
});
listen(chrome.tabs.onReplaced, async (db, at, added, removed) => {
  if (removed === db.session.tabId) await finish(db, 'Chrome replaced the monitored tab; start a new session.', true);
});
async function reconcile(reason) {
  const db = await load(), s = db.session;
  await FormSentrySync.flush(db, FormSentryCloud); await save(db);
  if (!s?.active) { await publish(db); return; }
  if (reason) { await finish(db, reason, true); return; }
  try {
    const tab = await chrome.tabs.get(s.tabId);
    if (S.formInfo(tab.url)?.id !== S.formInfo(s.examUrl)?.id) await finish(db, 'The approved exam tab is no longer available.', true);
  } catch { await finish(db, 'The exam tab could not be recovered.', true); }
  // Worker sleep/device sleep is never interpreted as evidence of disabling the extension.
}
chrome.runtime.onStartup.addListener(() => serial(() => reconcile('Browser restarted during monitoring; start a new session.')).catch(() => {}));
chrome.runtime.onInstalled.addListener(() => serial(() => reconcile('Extension installed or reloaded during monitoring; refresh the exam to start again.')).catch(() => {}));
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'formsentry-reconcile') serial(() => reconcile()).catch(() => {}); });
serial(async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.alarms.create('formsentry-reconcile', { periodInMinutes: 1 }); await reconcile();
}).catch(() => chrome.action.setBadgeText({ text: '!' }).catch(() => {}));
