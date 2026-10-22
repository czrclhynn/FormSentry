const TYPES = new Set(['EXAM_STARTED','EXAM_ENDED','TAB_SWITCH','FOCUS_LOST','FULLSCREEN_EXIT','FULLSCREEN_ENTER','COPY_ATTEMPT','CUT_ATTEMPT','PASTE_ATTEMPT','DOMAIN_VISIT','NETWORK_DISCONNECTED','NETWORK_RECONNECTED','EXAM_RECONNECTED','SESSION_INTERRUPTED','MONITOR_ERROR','SUBMISSION_DETECTED']);
export function identity(body) {
  const name = String(body.name || '').trim(), email = String(body.email || '').trim().toLowerCase();
  if (name.length < 2 || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid full name and email.');
  if (body.consent !== true) throw new Error('Consent is required.');
  if (!/^[a-f0-9]{48}$/.test(body.joinCode || '') || !/^[a-f0-9]{64}$/.test(body.token || '')) throw new Error('Invalid examination invitation or attempt token.');
  return { name, email, joinCode: body.joinCode, token: body.token };
}
export function validateEvents(values, rules) {
  if (!Array.isArray(values) || values.length > 50) throw new Error('Send at most 50 events per batch.');
  return values.map(e => {
    if (!e || typeof e.id !== 'string' || !/^[\w:-]{1,160}$/.test(e.id) || !TYPES.has(e.type) || typeof e.timestamp !== 'string' || !Number.isFinite(Date.parse(e.timestamp))) throw new Error('Invalid event.');
    const departure = ['TAB_SWITCH','FOCUS_LOST'].includes(e.type), clipboard = ['COPY_ATTEMPT','CUT_ATTEMPT','PASTE_ATTEMPT'].includes(e.type);
    if (departure && !rules.departures || clipboard && !rules.clipboard) throw new Error('Event disabled by examination rules.');
    const metadata = {}, source = e.metadata || {};
    let durationMs = null;
    if (departure) {
      durationMs = source.durationMs;
      if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 604800000) throw new Error('Departure must have a valid finalized duration.');
      if (source.returnedAt) { if (!Number.isFinite(Date.parse(source.returnedAt)) || Date.parse(source.returnedAt) < Date.parse(e.timestamp)) throw new Error('Invalid return time.'); metadata.returnedAt = source.returnedAt; }
      metadata.endedWhileAway = source.endedWhileAway === true;
      const signals = new Set(['TAB_SWITCH','TAB_RETURN','WINDOW_BLUR','WINDOW_FOCUS','PAGE_HIDDEN','PAGE_VISIBLE','BROWSER_BLUR','BROWSER_FOCUS']);
      if (source.signals != null) {
        if (!Array.isArray(source.signals) || source.signals.length > 24 || source.signals.some(s => !signals.has(s.type) || !Number.isFinite(s.at))) throw new Error('Invalid supporting signals.');
        metadata.signals = source.signals.map(s => ({ type: s.type, at: s.at }));
      }
    }
    if (e.type === 'DOMAIN_VISIT') {
      const domain = String(e.domain || '').toLowerCase();
      if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain) || domain.length > 253 || !rules.domains.some(d => domain === d || domain.endsWith('.' + d))) throw new Error('Domain is outside configured monitoring scope.');
      metadata.domain = domain;
    }
    const technical = ['NETWORK_DISCONNECTED','NETWORK_RECONNECTED','EXAM_RECONNECTED','SESSION_INTERRUPTED','MONITOR_ERROR'].includes(e.type);
    const review = departure || clipboard || e.type === 'DOMAIN_VISIT' || e.type === 'FULLSCREEN_EXIT' && rules.fullscreen;
    const descriptions = { EXAM_STARTED:'Student began monitoring after providing identity and consent.', EXAM_ENDED:'Monitoring ended. See session submission status.', TAB_SWITCH:'Student switched away from the examination', FOCUS_LOST:'Examination window lost focus', FULLSCREEN_EXIT:'Student left fullscreen.', FULLSCREEN_ENTER:'Student entered fullscreen.', COPY_ATTEMPT:'A copy action was observed.', CUT_ATTEMPT:'A cut action was observed.', PASTE_ATTEMPT:'A paste action was observed.', DOMAIN_VISIT:'A configured restricted domain was visited.', NETWORK_DISCONNECTED:'Browser reported an offline connection.', NETWORK_RECONNECTED:'Browser reported an online connection.', EXAM_RECONNECTED:'Examination document reconnected to the existing session.', SESSION_INTERRUPTED:'Monitoring was interrupted.', MONITOR_ERROR:'A monitoring technical issue occurred.', SUBMISSION_DETECTED:'Google Forms submission route observed; acceptance is not independently verified.' };
    return { id:e.id,type:e.type,timestamp:new Date(e.timestamp).toISOString(),category:technical?'TECHNICAL':review?'REVIEW':'ACTIVITY',durationMs,
      description:descriptions[e.type] + (departure ? ` for ${Math.round(durationMs/1000)} seconds${metadata.endedWhileAway ? '; monitoring ended before a return was observed' : ''}.` : ''),metadata };
  });
}
