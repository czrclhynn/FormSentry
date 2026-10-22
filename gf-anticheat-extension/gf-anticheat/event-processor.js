/* Pure session reducer. Persist its state together with events after every input. */
(function (root) {
  'use strict';
  const S = root.FormSentry || require('./shared.js');
  const SIGNALS = {
    TAB_SWITCH: ['tab', true], TAB_RETURN: ['tab', false], WINDOW_BLUR: ['focus', true], WINDOW_FOCUS: ['focus', false],
    PAGE_HIDDEN: ['page', true], PAGE_VISIBLE: ['page', false], BROWSER_BLUR: ['window', true], BROWSER_FOCUS: ['window', false]
  };
  const RANK = { WINDOW_BLUR: 1, BROWSER_BLUR: 2, PAGE_HIDDEN: 3, TAB_SWITCH: 4 };
  const RULE_KEYS = { NEW_TAB_OPENED: 'newTab', COPY_ATTEMPT: 'copyPaste', CUT_ATTEMPT: 'copyPaste', PASTE_ATTEMPT: 'copyPaste',
    CONTEXT_MENU_ATTEMPT: 'contextMenu', DEVTOOLS_SHORTCUT: 'devtools', KEYBOARD_SHORTCUT: 'shortcuts' };
  function state() { return { sequence: 0, seen: [], dimensions: {}, clocks: {}, episode: null, fullscreen: null, online: null, navigation: {}, created: {} }; }
  function classification(type, exam, metadata = {}) {
    if (['EXAM_STARTED', 'EXAM_ENDED', 'TAB_RETURN', 'FULLSCREEN_ENTER', 'SUBMISSION_DETECTED'].includes(type)) return ['ACTIVITY', 'LOW'];
    if (['NETWORK_DISCONNECTED', 'NETWORK_RECONNECTED', 'EXAM_RECONNECTED', 'SESSION_INTERRUPTED', 'MONITOR_ERROR'].includes(type)) return ['TECHNICAL', 'LOW'];
    if (type === 'FULLSCREEN_EXIT' && exam.rules.fullscreen !== 'REQUIRED') return ['ACTIVITY', 'LOW'];
    return ['REVIEW', 'LOW'];
  }
  function process(session, events, input) {
    if (!session?.active || input.sessionId && input.sessionId !== session.id) return null;
    const p = session.processor ||= state(), exam = session.exam;
    if (input.id && p.seen.includes(input.id)) return null;
    if (input.id) p.seen = [...p.seen.slice(-255), input.id];
    const at = Number.isFinite(input.at) ? input.at : Date.now(), type = input.type, metadata = input.metadata || {};
    function add(t, details = metadata) {
      const [category, severity] = classification(t, exam, details);
      const record = { id: `${session.id}:${++p.sequence}`, sessionId: session.id, examId: exam.id, examName: exam.name,
        examUrl: exam.url, timestamp: new Date(at).toISOString(), type: t, category, severity,
        domain: input.domain || '', metadata: details, simulated: !!session.simulated };
      events.push(record); return record;
    }
    if (SIGNALS[type]) {
      if (exam.rules.tabSwitch === 'OFF') return null;
      const [dimension, away] = SIGNALS[type];
      if (at < (p.clocks[dimension] || 0)) return null;
      p.clocks[dimension] = at;
      p.dimensions[dimension] = away;
      // Browser tab/window return is authoritative for stale document focus/visibility signals.
      if (!away && dimension === 'tab') { p.dimensions.page = false; p.dimensions.focus = false; p.clocks.page = at; p.clocks.focus = at; }
      if (!away && dimension === 'window') { p.dimensions.focus = false; p.clocks.focus = at; }
      const isAway = Object.values(p.dimensions).some(Boolean);
      const created = type === 'TAB_SWITCH' && p.created[metadata.tabId];
      if (isAway && created && at - created.at <= session.correlationMs) {
        const record = events.find(e => e.id === created.id);
        if (record) {
          if (p.episode && p.episode.target === null && at - p.episode.at <= session.correlationMs) {
            const index = events.findIndex(e => e.id === p.episode.id);
            if (index >= 0 && events[index].type === 'FOCUS_LOST') {
              record.metadata.signals = events[index].metadata.signals; events.splice(index, 1);
            }
          }
          record.metadata.signals ||= []; record.metadata.signals.push({ type, at });
          if (exam.rules.tabSwitch === 'BLOCK') record.category = 'REVIEW';
          p.episode = { id: record.id, at: created.at, target: metadata.tabId }; delete p.created[metadata.tabId]; return record;
        }
      }
      if (isAway && !p.episode) {
        const record = add(type === 'TAB_SWITCH' ? 'TAB_SWITCH' : 'FOCUS_LOST', { signals: [{ type, at }], rank: RANK[type] || 1 });
        p.episode = { id: record.id, at, target: metadata.tabId ?? null }; return record;
      }
      if (isAway && p.episode) {
        const record = events.find(e => e.id === p.episode.id);
        if (!record) return null;
        const signals = record.metadata.signals;
        if (!signals.some(s => s.type === type && s.at === at)) {
          record.metadata.signalCount = (record.metadata.signalCount || signals.length) + 1;
          if (signals.length < 24) signals.push({ type, at });
        }
        // The correlation window upgrades the primary cause; the open episode, not a timer,
        // absorbs visibility/focus duplicates. Return always ends it, even inside this window.
        if (type === 'TAB_SWITCH' && at - p.episode.at <= session.correlationMs && record.type !== 'NEW_TAB_OPENED') {
          record.type = 'TAB_SWITCH'; [record.category, record.severity] = classification('TAB_SWITCH', exam);
          record.metadata.rank = 4;
        }
        if (type === 'TAB_SWITCH') p.episode.target = metadata.tabId ?? p.episode.target;
        return record;
      }
      if (!isAway && p.episode) {
        const episode = p.episode; p.episode = null;
        const record = events.find(e => e.id === episode.id);
        if (record) { record.metadata.returnedAt = new Date(at).toISOString(); record.metadata.durationMs = Math.max(0, at - episode.at); }
        return record || null;
      }
      return null;
    }
    if (['FULLSCREEN_ENTER', 'FULLSCREEN_EXIT'].includes(type)) {
      const next = type === 'FULLSCREEN_ENTER';
      if (p.fullscreen === next) return null;
      p.fullscreen = next;
    }
    if (['NETWORK_DISCONNECTED', 'NETWORK_RECONNECTED'].includes(type)) {
      const next = type === 'NETWORK_RECONNECTED';
      if (p.online === next) return null;
      p.online = next;
    }
    if (RULE_KEYS[type] && ['ALLOW', 'OFF'].includes(exam.rules[RULE_KEYS[type]])) return null;
    const record = add(type);
    if (type === 'NEW_TAB_OPENED') {
      p.created[metadata.tabId] = { id: record.id, at };
      for (const [key, value] of Object.entries(p.created)) if (at - value.at > session.correlationMs) delete p.created[key];
    }
    return record;
  }
  root.FormSentryProcessor = { state, process, classification };
  if (typeof module !== 'undefined') module.exports = root.FormSentryProcessor;
})(globalThis);
