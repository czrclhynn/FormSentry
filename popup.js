const send = m => new Promise((resolve, reject) => chrome.runtime.sendMessage(m, response => {
  if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(response);
}));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const o = document.getElementById('o'), end = document.getElementById('end');
function showError(message) {
  o.className = 'status-card error';
  o.innerHTML = `<p class="status-title"><span class="status-dot"></span>Monitoring status unavailable</p><p class="muted">${esc(message)}</p>`;
}
document.getElementById('opt').onclick = () => chrome.runtime.openOptionsPage();
end.onclick = async () => {
  end.disabled = true;
  try { await send({ kind: 'END', reason: 'ended from popup' }); location.reload(); }
  catch { showError('Unable to end monitoring. Please try again.'); end.disabled = false; }
};
(async () => {
  try {
    const s = await send({ kind: 'SUMMARY' });
    if (!s || !s.cfg) throw new Error('Missing summary');
    const on = s.session && s.session.active, ex = on && s.cfg.exams.find(e => e.id === s.session.examId);
    end.disabled = !on;
    if (on && !ex) { showError('The active exam is no longer in Teacher Settings. You can end this session below.'); return; }
    if (!on) o.innerHTML = '<p class="status-title"><span class="status-dot"></span>Not monitoring</p><p class="muted">Monitoring is active only during an approved exam.</p>';
    else {
      const r = ex.rules, t = v => (v === 'OFF' || v === 'ALLOW' ? 'Off' : 'On');
      o.classList.add('active');
      o.innerHTML = `<p class="status-title"><span class="status-dot"></span>Monitoring active</p><p class="exam-title">${esc(ex.name)}</p><p class="connection">Google Form: Connected</p>
        <dl class="session-rules">${[['Tab switching', t(r.tabSwitch)], ['Blocked websites', 'On'], ['Copy/paste', t(r.copyPaste)], ['Fullscreen', r.fullscreen === 'REQUIRED' ? 'Required' : 'Optional'], ['AI websites', t(r.ai)], ['Events', s.monitoring]].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="muted">Monitoring is active only during this examination.</p>`;
    }
  } catch { showError('Could not connect to the monitor. Close and reopen this popup to try again.'); }
})();
