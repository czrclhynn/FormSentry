const $ = id => document.getElementById(id), esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const OPTS = { tabSwitch:['OFF','MONITOR','BLOCK'], newTab:['ALLOW','MONITOR','BLOCK'], ai:['ALLOW','MONITOR','BLOCK'], copyPaste:['ALLOW','MONITOR','BLOCK'],
  fullscreen:['OPTIONAL','REQUIRED'], devtools:['MONITOR','RESTRICT'], contextMenu:['ALLOW','MONITOR','BLOCK'] };
const DEF = { tabSwitch:'MONITOR', newTab:'BLOCK', ai:'BLOCK', copyPaste:'BLOCK', fullscreen:'REQUIRED', devtools:'RESTRICT', contextMenu:'BLOCK' };
const DOMS = `chatgpt.com,AI\nchat.openai.com,AI\nclaude.ai,AI\ngemini.google.com,AI\ncopilot.microsoft.com,AI\nperplexity.ai,AI\ngoogle.com,SEARCH,MONITORED\nbing.com,SEARCH,MONITORED\nduckduckgo.com,SEARCH,MONITORED\nmessenger.com,COMM,BLOCKED\ndiscord.com,COMM,BLOCKED\nweb.whatsapp.com,COMM,BLOCKED\nfacebook.com,COMM,MONITORED`;
let cfg;
const load = async () => { cfg = (await chrome.storage.local.get('config')).config || { exams: [], domains: DOMS, endpoint: '' }; };
const save = () => chrome.storage.local.set({ config: cfg });
const LABELS = { tabSwitch:'Tab switching', newTab:'New tabs', ai:'AI websites', copyPaste:'Copy/paste', fullscreen:'Fullscreen', devtools:'Developer tools', contextMenu:'Context menu' };
const VALUES = { OFF:'Off', ALLOW:'Allow', MONITOR:'Monitor', BLOCK:'Block', OPTIONAL:'Optional', REQUIRED:'Required', RESTRICT:'Restrict', DETECTION:'Detection', RESTRICTION:'Restriction' };
const options = (values, selected) => values.map(v => `<option value="${v}" ${v === selected ? 'selected' : ''}>${VALUES[v]}</option>`).join('');
const modeNote = mode => mode === 'DETECTION' ? 'Detection mode records activity. Block and Restrict rules are monitored without enforcement.' : 'Restriction mode enforces the configured Block and Restrict rules.';
function render() {
  $('dom').value = cfg.domains; $('ep').value = cfg.endpoint || '';
  $('exam-count').textContent = `${cfg.exams.length} ${cfg.exams.length === 1 ? 'exam' : 'exams'}`;
  $('exams').innerHTML = cfg.exams.map((e, i) => {
    const safeURL = /^https:\/\/docs\.google\.com\/forms\//.test(e.url);
    return `<article class="exam-card" aria-labelledby="exam-${i}"><div class="exam-header"><div class="exam-info"><h3 id="exam-${i}">${esc(e.name)}</h3>${safeURL ? `<a class="exam-url" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer" title="${esc(e.url)} (opens in a new tab)"><span>${esc(e.url)}</span><b aria-hidden="true">↗</b></a>` : `<span class="exam-url">${esc(e.url)}</span>`}</div><button class="button danger-outline" data-del="${i}" aria-label="Remove ${esc(e.name)}">Remove</button></div>
    <div class="settings-grid"><div class="field"><label for="mode-${i}">Mode</label><select id="mode-${i}" data-i="${i}" data-k="mode" aria-describedby="mode-note-${i}">${options(['DETECTION','RESTRICTION'], e.mode)}</select></div>
    ${Object.entries(OPTS).map(([k, v]) => `<div class="field"><label for="rule-${i}-${k}">${LABELS[k]}</label><select id="rule-${i}-${k}" data-i="${i}" data-r="${k}">${options(v, e.rules[k])}</select></div>`).join('')}</div><p id="mode-note-${i}" class="mode-note">${modeNote(e.mode)} Changes save automatically.</p></article>`;
  }).join('') || '<div class="empty-state"><strong>No approved exams yet</strong>Add a Google Form below to configure your first exam.</div>';
  const sims = ['TAB_SWITCH','AI_WEBSITE_DETECTED','BLOCKED_WEBSITE_DETECTED','FULLSCREEN_EXIT','COPY_ATTEMPT','PASTE_ATTEMPT','DEVTOOLS_ATTEMPT','EXTENSION_DISCONNECTED','PDF_OPENED','DESKTOP_APPLICATION_OPENED'];
  $('sims').innerHTML = sims.map(t => `<button class="button secondary" data-sim="${t}" title="Simulate ${t}">Simulate ${t.toLowerCase().replaceAll('_', ' ')}</button>`).join('');
}
async function log() {
  try {
    const { events = [] } = await chrome.storage.local.get('events');
    const s = await new Promise(r => chrome.runtime.sendMessage({ kind: 'SUMMARY' }, r));
    if (!s) throw new Error('Summary unavailable');
    $('sum').innerHTML = [['Monitoring Events',s.monitoring],['Potential Violations',s.violations],['Score',s.score]].map(([label, value]) => `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${esc(value)}</strong></div>`).join('');
    $('log').innerHTML = '<thead><tr><th scope="col">Time</th><th scope="col">Event type</th><th scope="col">Severity</th><th scope="col">Domain</th><th scope="col">Details</th></tr></thead><tbody>' + (events.slice(-200).reverse().map(e => {
      const metadata = e.metadata || {}, simulated = metadata.SIMULATED_EVENT, date = new Date(e.timestamp);
      const severity = ['LOW','MEDIUM','HIGH'].includes(e.severity) ? e.severity.toLowerCase() : '';
      const time = Number.isNaN(date.getTime()) ? esc(e.timestamp) : `<time datetime="${esc(e.timestamp)}" title="${esc(e.timestamp)}">${esc(date.toLocaleTimeString())}<small>${esc(date.toLocaleDateString())}</small></time>`;
      return `<tr class="${simulated ? 'sim' : ''}"><td>${time}</td><td><span class="badge event-type">${esc(e.type)}</span>${simulated ? '<span class="sim-label">SIMULATED EVENT</span>' : ''}</td><td><span class="badge severity-${severity}">${esc(e.severity)}</span></td><td class="domain-cell">${esc(e.domain || '—')}</td><td><details class="event-details"><summary title="Expand event details">${esc(JSON.stringify(metadata))}</summary><pre>${esc(JSON.stringify(metadata, null, 2))}</pre></details></td></tr>`;
    }).join('') || '<tr><td colspan="5"><div class="empty-state"><strong>No events recorded</strong>Activity from monitored exams will appear here.</div></td></tr>') + '</tbody>';
    $('log-feedback').textContent = '';
  } catch { $('log-feedback').textContent = 'Unable to load events. Select Refresh to try again.'; }
}
document.addEventListener('change', async e => {
  const t = e.target, i = t.dataset.i; if (i == null) return;
  if (t.dataset.k) cfg.exams[i].mode = t.value; else cfg.exams[i].rules[t.dataset.r] = t.value;
  try {
    await save();
    if (t.dataset.k) $('mode-note-' + i).textContent = modeNote(t.value) + ' Changes save automatically.';
    $('exam-feedback').textContent = 'Exam settings saved.';
  } catch { $('exam-feedback').textContent = 'Unable to save exam settings. Please try again.'; }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.del != null) { cfg.exams.splice(+t.dataset.del, 1); await save(); render(); $('exam-feedback').textContent = 'Exam removed.'; }
  if (t.dataset.sim) { await new Promise(r => chrome.runtime.sendMessage({ kind: 'SIMULATE', type: t.dataset.sim }, r)); log(); }
});
function fieldError(id, message) {
  $(id).setAttribute('aria-invalid', String(!!message));
  $(id + '-error').textContent = message; $(id + '-error').hidden = !message;
}
for (const id of ['n','u']) $(id).addEventListener('input', () => fieldError(id, ''));
$('add-form').onsubmit = e => e.preventDefault();
$('add').onclick = async e => {
  e.preventDefault();
  const name = $('n').value.trim(), url = $('u').value.trim();
  let validURL = false;
  try { const parsed = new URL(url); validURL = parsed.protocol === 'https:' && parsed.hostname === 'docs.google.com' && parsed.pathname.startsWith('/forms/'); } catch {}
  fieldError('n', name ? '' : 'Enter an exam name.');
  fieldError('u', validURL ? '' : 'Enter a valid https://docs.google.com/forms/ URL.');
  if (!name || !validURL) { $(name ? 'u' : 'n').focus(); return; }
  cfg.exams.push({ id: 'x' + Date.now(), name, url, mode: 'RESTRICTION', rules: { ...DEF } });
  await save(); render(); $('exam-feedback').textContent = 'Exam added. Monitoring rules are ready to configure.';
};
$('save').onclick = async () => {
  cfg.domains = $('dom').value; cfg.endpoint = $('ep').value.trim();
  try { await save(); $('save-feedback').textContent = 'Domains and endpoint saved.'; }
  catch { $('save-feedback').textContent = 'Unable to save. Please try again.'; }
};
$('ref').onclick = log; $('clr').onclick = async () => { await chrome.storage.local.set({ events: [] }); await log(); $('log-feedback').textContent = 'Event log cleared.'; };
$('exp').onclick = async () => { const { events = [] } = await chrome.storage.local.get('events'); const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })); a.download = 'events.json'; a.click(); };
(async () => { await load(); render(); log(); })();

