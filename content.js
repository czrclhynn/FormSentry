// Runs on Google Forms pages. Reads nothing from the form: no questions, answers, or responses.
(async () => {
  const send = m => new Promise(r => chrome.runtime.sendMessage(m, r));
  const url = location.href;
  if (/\/formResponse/.test(location.pathname)) { await send({ kind: 'END', reason: 'form submitted' }); return; }
  let st = await send({ kind: 'GET_STATE', url });
  if (!st || !st.exam) return; // not an approved exam: no monitoring, no UI
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
  .p{font:12px system-ui;background:#fff;color:#222;border:1px solid #bbb;border-radius:8px;box-shadow:0 2px 8px #0003;width:210px}
  .h{padding:6px 8px;background:#1a4fa0;color:#fff;border-radius:8px 8px 0 0;cursor:move;font-weight:600}
  .b{padding:8px} button{cursor:pointer;padding:4px 8px;margin-top:6px}
  .w{display:none;margin-top:6px;padding:6px;background:#fff3cd;border:1px solid #e0b000;border-radius:4px}
  .fs{display:none;position:fixed;inset:0;background:#000d;color:#fff;align-items:center;justify-content:center;flex-direction:column;font:18px system-ui;text-align:center;width:100vw;height:100vh}
  </style>
  <div class="p"><div class="h">ANTI-CHEATING MONITOR</div><div class="b">
   <div id="s"></div><div id="c"></div><div class="w" id="w"></div>
   <button id="go" style="display:none">Start exam monitoring</button>
   <div style="margin-top:6px;color:#666">Monitoring is active only during this examination.</div></div></div>
  <div class="fs" id="fs"><div>Warning: Please return to fullscreen mode.</div><button id="fsb" style="font-size:16px;padding:8px 16px;margin-top:12px">Return to fullscreen</button></div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  // Draggable, so it can be moved off any question.
  let d = null;
  root.querySelector('.h').onmousedown = e => { d = [e.clientX, e.clientY]; };
  addEventListener('mouseup', () => d = null);
  addEventListener('mousemove', e => { if (!d) return; const r = host.getBoundingClientRect();
    host.style.right = 'auto'; host.style.bottom = 'auto'; host.style.left = r.left + e.clientX - d[0] + 'px'; host.style.top = r.top + e.clientY - d[1] + 'px'; d = [e.clientX, e.clientY]; });

  let timer;
  const warn = (t, sticky) => { const w = $('w'); w.textContent = t; w.style.display = 'block'; clearTimeout(timer); if (!sticky) timer = setTimeout(() => w.style.display = 'none', 5000); };
  const log = (type, metadata = {}) => send({ kind: 'EVENT', type, metadata });
  const R = () => st.exam.rules, det = () => st.exam.mode === 'DETECTION';
  const blocks = k => !det() && (R()[k] === 'BLOCK' || R()[k] === 'RESTRICT');
  const setCount = n => $('c').textContent = 'Events detected: ' + n;

  chrome.runtime.onMessage.addListener(m => {
    if (m.kind !== 'EVENT') return;
    setCount(m.count);
    if (m.event.metadata.SIMULATED_EVENT) return warn('SIMULATED EVENT: ' + m.event.type);
    if (m.event.type === 'AI_WEBSITE_DETECTED' || m.event.type === 'BLOCKED_WEBSITE_DETECTED') warn('An unauthorized website was detected.');
  });

  function activate() {
    $('s').textContent = '● Active'; $('s').style.color = '#0a7a2f'; $('go').style.display = 'none'; setCount(st.count || 0);
    let outAt = null, hiddenAt = null;
    const fsOn = () => !!document.fullscreenElement;
    const needFs = () => R().fullscreen === 'REQUIRED';
    $('fsb').onclick = () => document.documentElement.requestFullscreen().catch(() => {});
    if (needFs() && !fsOn()) { warn('Please enter fullscreen mode before starting the exam.', true); $('fs').style.display = 'flex'; outAt = Date.now(); }
    document.addEventListener('fullscreenchange', () => {
      if (fsOn()) { $('fs').style.display = 'none'; log('FULLSCREEN_ENTER', outAt ? { durationOutsideSeconds: Math.round((Date.now() - outAt) / 1000) } : {}); outAt = null; }
      else { outAt = Date.now(); log('FULLSCREEN_EXIT'); if (needFs()) $('fs').style.display = 'flex'; warn('Warning: Please return to fullscreen mode.'); }
    });
    // Visibility/focus are classified as monitoring events, not proof of cheating.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); log('PAGE_HIDDEN'); }
      else { log('PAGE_VISIBLE', { hiddenSeconds: hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : 0 }); if (R().tabSwitch !== 'OFF') warn('Warning: You left the examination page.'); }
    });
    addEventListener('blur', () => log('WINDOW_BLUR')); addEventListener('focus', () => log('WINDOW_FOCUS'));
    addEventListener('offline', () => log('NETWORK_DISCONNECTED')); addEventListener('online', () => log('NETWORK_RECONNECTED'));
    for (const [ev, type] of [['copy', 'COPY_ATTEMPT'], ['cut', 'CUT_ATTEMPT'], ['paste', 'PASTE_ATTEMPT']])
      document.addEventListener(ev, e => { if (R().copyPaste === 'ALLOW') return; log(type); if (blocks('copyPaste')) { e.preventDefault(); e.stopPropagation(); warn('Copying and pasting are disabled during this exam.'); } }, true);
    document.addEventListener('contextmenu', e => { if (R().contextMenu === 'ALLOW') return; log('CONTEXT_MENU_ATTEMPT'); if (blocks('contextMenu')) { e.preventDefault(); warn('Right-click is disabled during this exam.'); } }, true);
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      const dev = e.key === 'F12' || (mod && (e.shiftKey || e.altKey) && ['i', 'j', 'c'].includes(k));
      const other = mod && !e.shiftKey && ['u', 's', 'p'].includes(k);
      if (dev) { log('DEVTOOLS_ATTEMPT', { key: e.key }); warn('Developer Tools are not allowed during this examination.'); if (blocks('devtools')) { e.preventDefault(); e.stopPropagation(); } }
      else if (other) { log('KEYBOARD_RESTRICTION_ATTEMPT', { key: (mod ? 'Ctrl+' : '') + e.key }); if (!det()) { e.preventDefault(); e.stopPropagation(); } }
    }, true);
  }

  if (st.active) activate();
  else {
    $('s').textContent = '● Ready'; $('c').textContent = 'Exam: ' + st.exam.name;
    warn('Exam monitoring is active once you start.', true);
    $('go').style.display = 'block';
    $('go').onclick = async () => { // click = user gesture, needed for fullscreen
      if (R().fullscreen === 'REQUIRED') await document.documentElement.requestFullscreen().catch(() => {});
      await send({ kind: 'START', url }); st.active = true; $('w').style.display = 'none'; activate();
    };
  }
})();
