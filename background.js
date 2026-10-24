// Service worker: session state, tab/window monitoring, domain rules, event log.
const SEVERITY = {
  WINDOW_BLUR:'LOW', WINDOW_FOCUS:'LOW', PAGE_HIDDEN:'LOW', PAGE_VISIBLE:'LOW', TAB_RETURN:'LOW',
  FULLSCREEN_ENTER:'LOW', NETWORK_DISCONNECTED:'LOW', NETWORK_RECONNECTED:'LOW', EXAM_STARTED:'LOW', EXAM_ENDED:'LOW',
  FULLSCREEN_EXIT:'MEDIUM', TAB_SWITCH:'MEDIUM', NEW_TAB_OPENED:'MEDIUM', COPY_ATTEMPT:'MEDIUM', CUT_ATTEMPT:'MEDIUM',
  PASTE_ATTEMPT:'MEDIUM', CONTEXT_MENU_ATTEMPT:'LOW', KEYBOARD_RESTRICTION_ATTEMPT:'MEDIUM', PDF_OPENED:'MEDIUM',
  EXTENSION_DISCONNECTED:'MEDIUM', EXAM_TAB_CLOSED:'MEDIUM', DESKTOP_APPLICATION_OPENED:'HIGH',
  DEVTOOLS_ATTEMPT:'HIGH', AI_WEBSITE_DETECTED:'HIGH', BLOCKED_WEBSITE_DETECTED:'HIGH'
};
const WEIGHT = { TAB_SWITCH:1, FULLSCREEN_EXIT:1, COPY_ATTEMPT:1, CUT_ATTEMPT:1, PASTE_ATTEMPT:1, NEW_TAB_OPENED:1,
  KEYBOARD_RESTRICTION_ATTEMPT:1, BLOCKED_WEBSITE_DETECTED:3, AI_WEBSITE_DETECTED:3, DEVTOOLS_ATTEMPT:3, PDF_OPENED:1 };

const DEFAULT_RULES = { tabSwitch:'MONITOR', newTab:'BLOCK', ai:'BLOCK', copyPaste:'BLOCK',
  fullscreen:'REQUIRED', devtools:'RESTRICT', contextMenu:'BLOCK' };
const DEFAULT_DOMAINS = `chatgpt.com,AI
chat.openai.com,AI
claude.ai,AI
gemini.google.com,AI
copilot.microsoft.com,AI
perplexity.ai,AI
google.com,SEARCH,MONITORED
bing.com,SEARCH,MONITORED
duckduckgo.com,SEARCH,MONITORED
messenger.com,COMM,BLOCKED
discord.com,COMM,BLOCKED
web.whatsapp.com,COMM,BLOCKED
facebook.com,COMM,MONITORED`;

let q = Promise.resolve();
const serial = fn => (q = q.then(fn).catch(e => console.error(e)));

const get = async k => (await chrome.storage.local.get(k))[k];
const set = o => chrome.storage.local.set(o);
const getConfig = async () => (await get('config')) || { exams: [], domains: DEFAULT_DOMAINS, endpoint: '' };

function formId(url) {
  const m = /\/forms\/d\/(?:e\/)?([^/?#]+)/.exec(url || '');
  return m ? m[1] : null;
}
function findExam(cfg, url) {
  const id = formId(url);
  return id ? cfg.exams.find(e => formId(e.url) === id) : null;
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function classify(cfg, host) {
  for (const line of cfg.domains.split('\n')) {
    const [d, cat, rule] = line.split(',').map(s => (s || '').trim());
    if (!d) continue;
    const hit = host === d || (d !== 'google.com' && host.endsWith('.' + d));
    if (hit) return { domain: d, category: cat || 'OTHER', rule: rule || 'MONITORED' };
  }
  return null;
}
// In DETECTION mode every BLOCK/RESTRICT is downgraded to monitoring only.
const eff = (exam, key) => {
  const v = exam.rules[key];
  return exam.mode === 'DETECTION' && (v === 'BLOCK' || v === 'RESTRICT') ? 'MONITOR' : v;
};

async function logEvent(type, { domain = '', metadata = {}, simulated = false } = {}) {
  const s = await get('session');
  if (!simulated && !(s && s.active)) return null;
  const ev = {
    id: 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type, timestamp: new Date().toISOString(), examUrl: s ? s.examUrl : '', domain,
    severity: SEVERITY[type] || 'LOW', sessionId: s ? s.id : null,
    metadata: simulated ? { ...metadata, SIMULATED_EVENT: true } : metadata
  };
  const events = ((await get('events')) || []).concat(ev).slice(-3000);
  await set({ events });
  const cfg = await getConfig();
  if (cfg.endpoint) fetch(cfg.endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(ev) }).catch(() => {});
  if (s && s.tabId != null) chrome.tabs.sendMessage(s.tabId, { kind: 'EVENT', event: ev, count: events.filter(e => e.sessionId === s.id).length }).catch(() => {});
  chrome.action.setBadgeText({ text: s && s.active ? String(events.filter(e => e.sessionId === s.id).length) : '' });
  return ev;
}

async function startSession(exam, tabId) {
  const s = { id: 's_' + Date.now().toString(36), active: true, examId: exam.id, examUrl: exam.url, tabId, awayStart: null, startedAt: Date.now() };
  await set({ session: s });
  await set({ hb: Date.now() });
  await logEvent('EXAM_STARTED', { metadata: { exam: exam.name } });
}
async function endSession(reason) {
  const s = await get('session');
  if (!s || !s.active) return;
  await logEvent('EXAM_ENDED', { metadata: { reason } });
  s.active = false; // STOP ALL MONITORING
  await set({ session: s });
  chrome.action.setBadgeText({ text: '' });
}

async function handleActive(tab) {
  const s = await get('session');
  if (!s || !s.active || !tab) return;
  const cfg = await getConfig();
  const exam = cfg.exams.find(e => e.id === s.examId);
  if (!exam) return;
  if (tab.id === s.tabId) {
    if (s.awayStart) {
      const dur = Math.round((Date.now() - s.awayStart) / 1000);
      s.awayStart = null; await set({ session: s });
      await logEvent('TAB_RETURN', { metadata: { durationSeconds: dur } });
    }
  } else if (!s.awayStart && exam.rules.tabSwitch !== 'OFF') {
    s.awayStart = Date.now(); await set({ session: s });
    await logEvent('TAB_SWITCH', { domain: hostOf(tab.url || tab.pendingUrl) });
    if (eff(exam, 'tabSwitch') === 'BLOCK') focusExam(s);
  }
}
function focusExam(s) {
  chrome.tabs.update(s.tabId, { active: true }).then(t => chrome.windows.update(t.windowId, { focused: true })).catch(() => {});
}

async function checkUrl(tab) {
  const s = await get('session');
  if (!s || !s.active || tab.id === s.tabId || !tab.url) return;
  const cfg = await getConfig();
  const exam = cfg.exams.find(e => e.id === s.examId);
  if (!exam) return;
  if (/\.pdf($|[?#])/i.test(tab.url)) await logEvent('PDF_OPENED', { domain: hostOf(tab.url), metadata: { url: tab.url } });
  const host = hostOf(tab.url);
  const c = classify(cfg, host);
  if (!c || c.rule === 'ALLOWED') return;
  const isAI = c.category === 'AI';
  const rule = isAI ? eff(exam, 'ai') : (c.rule === 'BLOCKED' ? eff({ mode: exam.mode, rules: { x: 'BLOCK' } }, 'x') : 'MONITOR');
  if (isAI && rule === 'ALLOW') return;
  await logEvent(isAI ? 'AI_WEBSITE_DETECTED' : 'BLOCKED_WEBSITE_DETECTED', { domain: host, metadata: { category: c.category, action: rule } });
  if (rule === 'BLOCK') chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('blocked.html') + '?d=' + encodeURIComponent(host) });
}

chrome.tabs.onActivated.addListener(({ tabId }) => serial(async () => handleActive(await chrome.tabs.get(tabId))));
chrome.windows.onFocusChanged.addListener(w => serial(async () => {
  if (w === chrome.windows.WINDOW_ID_NONE) return; // browser lost focus: content script reports blur
  const [t] = await chrome.tabs.query({ active: true, windowId: w });
  await handleActive(t);
}));
chrome.tabs.onCreated.addListener(tab => serial(async () => {
  const s = await get('session');
  if (!s || !s.active) return;
  const cfg = await getConfig();
  const exam = cfg.exams.find(e => e.id === s.examId);
  if (!exam || exam.rules.newTab === 'ALLOW') return;
  await logEvent('NEW_TAB_OPENED');
  if (eff(exam, 'newTab') === 'BLOCK') { chrome.tabs.remove(tab.id).catch(() => {}); focusExam(s); }
}));
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.url || info.status === 'complete') serial(() => checkUrl(tab)); });
chrome.tabs.onRemoved.addListener(id => serial(async () => {
  const s = await get('session');
  if (s && s.active && s.tabId === id) await logEvent('EXAM_TAB_CLOSED', { metadata: { note: 'Reopening the approved form resumes monitoring.' } });
}));

// Heartbeat: a long gap means the extension/browser was disabled or closed mid-exam.
chrome.alarms.create('hb', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => serial(async () => {
  const s = await get('session'); if (s && s.active) await set({ hb: Date.now() });
}));
async function checkGap() {
  const s = await get('session'), hb = await get('hb');
  if (s && s.active && hb && Date.now() - hb > 90000)
    await logEvent('EXTENSION_DISCONNECTED', { metadata: { gapSeconds: Math.round((Date.now() - hb) / 1000), note: 'Not proof of cheating.' } });
  if (s && s.active) await set({ hb: Date.now() });
}
chrome.runtime.onStartup.addListener(() => serial(checkGap));
chrome.runtime.onInstalled.addListener(() => serial(checkGap));

const SIM = {
  TAB_SWITCH: {}, AI_WEBSITE_DETECTED: { domain: 'chatgpt.com' }, BLOCKED_WEBSITE_DETECTED: { domain: 'discord.com' },
  FULLSCREEN_EXIT: {}, COPY_ATTEMPT: {}, PASTE_ATTEMPT: {}, DEVTOOLS_ATTEMPT: {}, EXTENSION_DISCONNECTED: {},
  PDF_OPENED: {}, DESKTOP_APPLICATION_OPENED: { metadata: { application: 'Microsoft Word', requires: 'optional desktop monitoring client' } }
};

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  serial(async () => {
    const cfg = await getConfig();
    if (m.kind === 'GET_STATE') {
      const exam = findExam(cfg, m.url);
      const s = await get('session');
      const active = !!(exam && s && s.active && s.examId === exam.id);
      if (active && sender.tab) { s.tabId = sender.tab.id; await set({ session: s }); }
      const events = (await get('events')) || [];
      return reply({ exam, active, count: active ? events.filter(e => e.sessionId === s.id).length : 0 });
    }
    if (m.kind === 'START') { const exam = findExam(cfg, m.url); if (exam) await startSession(exam, sender.tab.id); return reply({ ok: !!exam }); }
    if (m.kind === 'END') { await endSession(m.reason || 'ended'); return reply({ ok: true }); }
    if (m.kind === 'EVENT') { const s = await get('session'); if (s && s.active) await logEvent(m.type, { domain: m.domain, metadata: m.metadata }); return reply({ ok: true }); }
    if (m.kind === 'SIMULATE') { const d = SIM[m.type] || {}; await logEvent(m.type, { ...d, simulated: true }); return reply({ ok: true }); }
    if (m.kind === 'RETURN_TO_EXAM') { const s = await get('session'); if (s) focusExam(s); return reply({ ok: true }); }
    if (m.kind === 'SUMMARY') {
      const s = await get('session'), events = (await get('events')) || [];
      const mine = s ? events.filter(e => e.sessionId === s.id) : [];
      const real = mine.filter(e => !e.metadata.SIMULATED_EVENT);
      return reply({ session: s, cfg, monitoring: mine.length,
        violations: real.filter(e => WEIGHT[e.type]).length, score: real.reduce((a, e) => a + (WEIGHT[e.type] || 0), 0) });
    }
    reply({});
  });
  return true;
});
