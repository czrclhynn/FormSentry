/* Shared, dependency-free configuration and presentation helpers. */
(function (root) {
  'use strict';
  const RULE_OPTIONS = {
    tabSwitch: ['OFF', 'MONITOR', 'BLOCK'], newTab: ['ALLOW', 'MONITOR', 'BLOCK'],
    ai: ['ALLOW', 'MONITOR', 'BLOCK'], copyPaste: ['ALLOW', 'MONITOR', 'BLOCK'],
    fullscreen: ['OPTIONAL', 'REQUIRED'], devtools: ['ALLOW', 'MONITOR', 'RESTRICT'],
    contextMenu: ['ALLOW', 'MONITOR', 'BLOCK'], shortcuts: ['ALLOW', 'MONITOR', 'BLOCK']
  };
  const DEFAULT_RULES = { tabSwitch: 'MONITOR', newTab: 'BLOCK', ai: 'BLOCK', copyPaste: 'BLOCK',
    fullscreen: 'REQUIRED', devtools: 'RESTRICT', contextMenu: 'BLOCK', shortcuts: 'BLOCK' };
  const DEFAULT_DOMAINS = 'chatgpt.com,AI\nchat.openai.com,AI\nclaude.ai,AI\ngemini.google.com,AI\ncopilot.microsoft.com,AI\nperplexity.ai,AI\ngoogle.com,SEARCH,MONITORED\nbing.com,SEARCH,MONITORED\nduckduckgo.com,SEARCH,MONITORED\nmessenger.com,COMM,BLOCKED\ndiscord.com,COMM,BLOCKED\nweb.whatsapp.com,COMM,BLOCKED\nfacebook.com,COMM,MONITORED';
  const LABELS = { tabSwitch: 'Tab switching & focus', newTab: 'New tabs', ai: 'AI websites', copyPaste: 'Copy, cut & paste', fullscreen: 'Fullscreen', devtools: 'Developer tools shortcuts', contextMenu: 'Context menu', shortcuts: 'Print, save & source shortcuts' };
  const CATEGORIES = { ACTIVITY: 'Activity', REVIEW: 'Review Needed', TECHNICAL: 'Technical', LEGACY: 'Technical (legacy record)' };
  function formInfo(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.port || u.username || u.password) return null;
      const m = /^\/forms\/(?:u\/\d+\/)?d\/(e\/)?([\w-]+)\/(viewform|formResponse)\/?$/.exec(u.pathname);
      return m ? { id: (m[1] || '') + m[2], page: m[3], url: `https://docs.google.com/forms/d/${m[1] || ''}${m[2]}/viewform` } : null;
    } catch { return null; }
  }
  function examURL(value) {
    const f = formInfo(value);
    if (!f || f.page !== 'viewform') throw new Error('Use the full Google Forms respondent URL ending in /viewform. Open shortened forms.gle links first.');
    return f.url;
  }
  function parseDomains(value) {
    if (typeof value !== 'string' || value.length > 30000) throw new Error('Domain rules must be text, at most 30,000 characters.');
    const seen = new Set();
    return value.split(/\r?\n/).flatMap((line, i) => {
      if (!line.trim()) return [];
      const parts = line.split(',').map(s => s.trim());
      const domain = parts[0].toLowerCase().replace(/^www\./, '');
      const category = (parts[1] || 'OTHER').toUpperCase(), action = (parts[2] || 'MONITORED').toUpperCase();
      if (parts.length > 3 || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || !/^[A-Z][A-Z0-9_]{0,23}$/.test(category) || !['ALLOWED', 'MONITORED', 'BLOCKED'].includes(action)) throw new Error(`Invalid domain rule on line ${i + 1}. Use domain,CATEGORY,ALLOWED|MONITORED|BLOCKED.`);
      if (seen.has(domain)) throw new Error(`Duplicate domain on line ${i + 1}: ${domain}`);
      seen.add(domain); return [{ domain, category, action }];
    });
  }
  function classifyDomain(rules, host) {
    return [...rules].sort((a, b) => b.domain.length - a.domain.length).find(r => host === r.domain || (r.domain !== 'google.com' && host.endsWith('.' + r.domain)));
  }
  function normalizeConfig(raw = {}) {
    return { ...raw, exams: (Array.isArray(raw.exams) ? raw.exams : []).map(e => ({ ...e, enabled: e.enabled !== false,
      mode: e.mode === 'DETECTION' ? 'DETECTION' : 'RESTRICTION', rules: { ...DEFAULT_RULES, ...e.rules } })),
      domains: typeof raw.domains === 'string' ? raw.domains : DEFAULT_DOMAINS,
      correlationMs: Number.isInteger(raw.correlationMs) ? Math.min(1500, Math.max(100, raw.correlationMs)) : 500,
      revision: raw.revision || 0 };
  }
  function validateExam(raw) {
    const name = String(raw.name || '').trim();
    if (!name || name.length > 120) throw new Error('Enter an exam name of 1–120 characters.');
    if (!['DETECTION', 'RESTRICTION'].includes(raw.mode)) throw new Error('Choose a valid monitoring mode.');
    const rules = {};
    for (const [key, values] of Object.entries(RULE_OPTIONS)) {
      rules[key] = raw.rules?.[key] || DEFAULT_RULES[key];
      if (!values.includes(rules[key])) throw new Error(`Invalid rule: ${LABELS[key]}.`);
    }
    return { id: raw.id, name, url: examURL(raw.url), mode: raw.mode, enabled: raw.enabled !== false, rules };
  }
  const blocks = (exam, key) => exam.mode === 'RESTRICTION' && ['BLOCK', 'RESTRICT'].includes(exam.rules[key]);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const label = type => type.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
  function metrics(events) {
    const real = events.filter(e => !e.simulated && !e.metadata?.SIMULATED_EVENT);
    return { activities: real.length, review: real.filter(e => e.category === 'REVIEW').length,
      informational: real.filter(e => ['ACTIVITY', 'TECHNICAL'].includes(e.category)).length,
      technical: real.filter(e => e.category === 'TECHNICAL').length, legacy: real.filter(e => e.legacy).length };
  }
  function csv(events) {
    const cell = v => { let s = String(v ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
    const keys = ['id', 'timestamp', 'sessionId', 'examName', 'type', 'category', 'severity', 'domain', 'simulated', 'metadata'];
    return [keys.join(','), ...events.map(e => keys.map(k => cell(typeof e[k] === 'object' ? JSON.stringify(e[k]) : e[k])).join(','))].join('\r\n');
  }
  const api = { RULE_OPTIONS, DEFAULT_RULES, DEFAULT_DOMAINS, LABELS, CATEGORIES, formInfo, examURL, parseDomains, classifyDomain, normalizeConfig, validateExam, blocks, esc, label, metrics, csv };
  root.FormSentry = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
