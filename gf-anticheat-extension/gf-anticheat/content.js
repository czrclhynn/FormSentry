/* No form content or clipboard data is read. Listeners exist only during this session. */
(() => {
  if (globalThis.__formSentryMounted) return;
  globalThis.__formSentryMounted = true;
  const S = FormSentry;
  let state, controller, heartbeat, panel, root, busy = false, noticeTimer, lastNotice = '', serial = 0;
  const send = m => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(m, response => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!response?.ok) reject(new Error(response?.error || 'Monitoring service unavailable.'));
        else resolve(response);
      });
    } catch (error) { reject(error); }
  });
  const $ = id => root.getElementById(id);
  function notice(message) {
    if (!root || message === lastNotice) return;
    lastNotice = message; $('notice').textContent = message; clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { lastNotice = ''; }, 5000);
  }
  function stop() { controller?.abort(); controller = null; clearInterval(heartbeat); heartbeat = null; }
  function fail(error) {
    stop(); if (state) { state.active = false; state.status = 'ERROR'; }
    if (root) { draw(); notice('Monitoring connection lost. Refresh this form after checking that FormSentry is enabled. ' + error.message); }
  }
  function report(type) {
    if (!state?.active) return;
    send({ kind: 'EVENT', sessionId: state.sessionId, type, at: Date.now(), id: String(++serial) }).then(reply => {
      if (reply.active === false) { stop(); state.active = false; state.status = reply.status; draw(); }
    }).catch(fail);
  }
  function draw() {
    if (!root || !state) return;
    const status = state.active ? 'Monitoring' : ({ COMPLETED: 'Finished · submission unverified', SUBMISSION_UNVERIFIED: 'Submission observed · not verified', TECHNICAL_ISSUE: 'Stopped · technical issue or consent withdrawn', INTERRUPTED: 'Interrupted', TEACHER_ENDED: 'Ended by teacher', ERROR: 'Connection error' }[state.status] || 'Ready');
    $('status').textContent = status; $('status').className = state.active ? 'active' : '';
    $('exam').textContent = state.exam.name;
    $('pre-exam').hidden = state.active;
    $('start').hidden = state.active; $('start').disabled = busy || state.busy || state.status === 'ERROR' || $('student-name').value.trim().length < 2 || !$('student-name').checkValidity() || !$('student-email').checkValidity() || !$('consent').checked;
    $('start').textContent = ['COMPLETED', 'INTERRUPTED'].includes(state.status) ? 'Start a new attempt' : 'Start Examination';
    $('end').hidden = !state.active; $('end').disabled = busy;
    $('fullscreen').hidden = !state.active || state.exam.rules.fullscreen !== 'REQUIRED' || !!document.fullscreenElement;
    $('connection').textContent = state.status === 'ERROR' ? 'Reconnect by refreshing the form.' : state.active ? 'Monitoring this Chrome window · records sync to your teacher' : state.busy ? 'Another exam is active. End it in FormSentry first.' : 'Your identity is self-declared. Monitoring begins only after you consent and start.';
    $('rules').textContent = (state.exam.warningMode ? 'Gentle reminders enabled. ' : 'Record only. ') + 'Tab/window departures: ' + (state.exam.rules.tabSwitch === 'OFF' ? 'off' : 'on') + ' · Fullscreen: ' + (state.exam.rules.fullscreen === 'REQUIRED' ? 'requested' : 'optional') + ' · Clipboard actions: ' + (state.exam.rules.copyPaste === 'ALLOW' ? 'off' : 'on') + '. Restricted domains: ' + (state.exam.cloudRules?.domains.join(', ') || 'none') + '.';
  }
  function mount() {
    if (panel) return;
    panel = document.createElement('div'); panel.id = 'formsentry-monitor';
    panel.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 24px)';
    root = panel.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{color-scheme:light}*{box-sizing:border-box}.panel{width:290px;max-width:calc(100vw - 24px);font:12px/1.5 system-ui;color:#19273c;background:white;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 6px 24px #19273c24;overflow:hidden}
      header{display:flex;align-items:center;gap:8px;background:#f0f5fd;padding:10px 12px;border-bottom:1px solid #dce3ec}header svg{width:24px;height:24px}strong{font-size:13px}header button{margin-left:auto}#body{padding:12px;max-height:60vh;overflow:auto}#status{font-weight:700;color:#58677b}#status.active{color:#167347}#exam{font-weight:600;margin:6px 0;overflow-wrap:anywhere}p{margin:6px 0}#connection,#rules,.privacy{color:#58677b}#notice{color:#815714}button{font:600 12px system-ui;cursor:pointer;background:white;color:#285bb5;border:1px solid #cbd5e1;border-radius:7px;padding:7px 10px;min-height:32px}button:hover{background:#edf2fa}button:focus-visible,summary:focus-visible{outline:3px solid #285bb5;outline-offset:2px}button:disabled{opacity:.6;cursor:default}.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}#start{background:#285bb5;color:white}details{margin:8px 0}summary{cursor:pointer}[hidden]{display:none!important}.privacy{font-size:11px;margin-top:10px}
      </style><div class="panel" role="region" aria-label="FormSentry examination monitor"><header><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#285bb5" d="M16 2 29 7v9c0 7-6 12-13 15C9 28 3 23 3 16V7Z"/><path fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="m10 16 4 4 8-9"/></svg><strong>FormSentry</strong><button id="collapse" aria-expanded="true" aria-controls="body" aria-label="Minimize monitoring panel">−</button></header>
      <div id="body"><div id="status" role="status"></div><p id="exam"></p><p id="connection"></p><details><summary>Exam rules &amp; privacy</summary><p id="rules"></p><p class="privacy">Browser activity only, in this exam’s Chrome window. No answers, clipboard text, camera or microphone are collected. Records need human review.</p></details><p id="notice" role="status"></p><div class="actions"><button id="start">Start monitoring</button><button id="end" hidden>End monitoring</button><button id="fullscreen" hidden>Enter fullscreen</button><button id="move" aria-label="Move panel to the other side">Move panel</button></div></div></div>`;
    document.documentElement.appendChild(panel);
    const pre = document.createElement('form'); pre.id = 'pre-exam';
    pre.innerHTML = `<h2 style="font-size:18px;margin:10px 0">Before You Begin</h2><label for="student-name">Full Name</label><input id="student-name" autocomplete="name" required minlength="2" maxlength="120"><label for="student-email">Email Address</label><input id="student-email" type="email" autocomplete="email" required maxlength="254"><details open><summary>What FormSentry Monitors</summary><p>Leaving this exam’s tab or window, time away, fullscreen changes, clipboard actions and restricted domains when enabled. It cannot identify external applications or read your answers.</p></details><details><summary>Examination Guidelines</summary><p>Stay on the examination page. Avoid unnecessary tab switching. Submit the Google Form before finishing. Contact your teacher if a technical problem occurs.</p></details><label class="consent"><input id="consent" type="checkbox" required> I understand the examination monitoring guidelines and agree to begin this monitored examination.</label><p class="privacy">Your name, email and monitoring records are sent to the teacher’s FormSentry Supabase project. Identity is not independently verified.</p><button id="decline" type="button">Cancel / I Don’t Agree</button>`;
    $('body').insertBefore(pre, $('connection'));
    const formStyle = document.createElement('style'); formStyle.textContent = '#pre-exam label{display:block;margin-top:8px}#pre-exam input:not([type=checkbox]){width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:5px;font:inherit}#pre-exam .consent{display:flex;gap:6px;align-items:flex-start}#pre-exam .consent input{flex-shrink:0;margin-top:4px}.panel{width:350px}'; root.appendChild(formStyle);
    pre.oninput = draw; pre.onsubmit = e => { e.preventDefault(); if (!$('start').disabled) $('start').click(); };
    $('decline').onclick = () => { $('consent').checked = false; notice('Monitoring has not started. You may close this exam or contact your teacher.'); draw(); };
    $('collapse').onclick = () => { const hidden = !$('body').hidden; $('body').hidden = hidden; $('collapse').textContent = hidden ? '+' : '−'; $('collapse').setAttribute('aria-expanded', String(!hidden)); $('collapse').setAttribute('aria-label', hidden ? 'Expand monitoring panel' : 'Minimize monitoring panel'); };
    $('move').onclick = () => { const left = panel.style.left === '16px'; panel.style.left = left ? 'auto' : '16px'; panel.style.right = left ? '16px' : 'auto'; };
    $('fullscreen').onclick = () => document.documentElement.requestFullscreen().catch(() => notice('Chrome did not enter fullscreen. Try the Enter fullscreen button again.'));
    $('start').onclick = async () => {
      if (busy || state.active) return;
      busy = true; draw();
      try {
        if (state.exam.rules.fullscreen === 'REQUIRED' && !document.fullscreenElement) {
          try { await document.documentElement.requestFullscreen(); }
          catch { if (state.exam.mode === 'RESTRICTION') throw new Error('Allow fullscreen to start this exam, then try again.'); }
        }
        if (!$('pre-exam').reportValidity() || !$('consent').checked) throw new Error('Enter your name and email and confirm consent first.');
        const result = await send({ kind: 'START', fullscreen: !!document.fullscreenElement, online: navigator.onLine, name: $('student-name').value.trim(), email: $('student-email').value.trim(), consent: $('consent').checked });
        state = { ...state, ...result, active: true, status: 'MONITORING' }; $('notice').textContent = ''; activate();
      } catch (error) { notice(error.message); }
      finally { busy = false; draw(); }
    };
    $('end').onclick = async () => {
      if (busy || !confirm('Stop monitoring? You may stop for a technical problem or withdraw consent. This does not submit your Google Form; submission will remain unverified.')) return;
      busy = true; draw();
      try { const result = await send({ kind: 'END', sessionId: state.sessionId, technical: true }); stop(); state.active = false; state.status = result.status; notice('Monitoring stopped. Your Google Form is submitted separately. Pending activity will retry uploading.'); }
      catch (error) { notice(error.message); }
      finally { busy = false; draw(); }
    };
  }
  function activate() {
    stop(); controller = new AbortController(); const { signal } = controller;
    const on = (target, name, fn, capture = false) => target.addEventListener(name, fn, { signal, capture });
    on(document, 'visibilitychange', () => report(document.hidden ? 'PAGE_HIDDEN' : 'PAGE_VISIBLE'));
    on(window, 'blur', () => report('WINDOW_BLUR')); on(window, 'focus', () => report('WINDOW_FOCUS'));
    on(window, 'offline', () => report('NETWORK_DISCONNECTED')); on(window, 'online', () => report('NETWORK_RECONNECTED'));
    on(document, 'fullscreenchange', () => {
      report(document.fullscreenElement ? 'FULLSCREEN_ENTER' : 'FULLSCREEN_EXIT');
      if (!document.fullscreenElement && state.exam.warningMode && state.exam.rules.fullscreen === 'REQUIRED') notice('You left fullscreen. Use Enter fullscreen to follow your teacher’s guidelines.');
      draw();
    });
    for (const [name, type] of [['copy', 'COPY_ATTEMPT'], ['cut', 'CUT_ATTEMPT'], ['paste', 'PASTE_ATTEMPT'], ['contextmenu', 'CONTEXT_MENU_ATTEMPT']]) {
      const key = name === 'contextmenu' ? 'contextMenu' : 'copyPaste';
      on(document, name, e => {
        if (!e.isTrusted || state.exam.rules[key] === 'ALLOW' || e.composedPath().includes(panel)) return;
        report(type);
        if (state.exam.warningMode) notice('A clipboard action was recorded. Follow your teacher’s examination guidelines.');
        if (S.blocks(state.exam, key)) { e.preventDefault(); e.stopPropagation(); notice(name === 'contextmenu' ? 'The exam rules disable the context menu.' : 'The exam rules disable copying, cutting and pasting.'); }
      }, true);
    }
    on(document, 'keydown', e => {
      if (!e.isTrusted || e.repeat) return;
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      const dev = e.key === 'F12' || (mod && (e.shiftKey || e.altKey) && ['i', 'j', 'c'].includes(k));
      const other = mod && !e.shiftKey && ['u', 's', 'p'].includes(k), key = dev ? 'devtools' : 'shortcuts';
      if ((!dev && !other) || state.exam.rules[key] === 'ALLOW') return;
      report(dev ? 'DEVTOOLS_SHORTCUT' : 'KEYBOARD_SHORTCUT');
      if (S.blocks(state.exam, key)) { e.preventDefault(); e.stopPropagation(); notice('This shortcut is restricted by the exam rules.'); }
    }, true);
    heartbeat = setInterval(async () => {
      try { const reply = await send({ kind: 'PING', sessionId: state.sessionId }); if (reply.syncError) notice('Connection interrupted. Activity is saved on this device and will retry uploading.'); if (!reply.active) { stop(); state.active = false; state.status = reply.status; draw(); } }
      catch (error) { fail(error); }
    }, 30000);
    // Refresh/BFCache restoration may not produce fresh visibility/focus events.
    // Sample the current document so stale dimensions cannot keep an episode open.
    report(document.hidden ? 'PAGE_HIDDEN' : 'PAGE_VISIBLE');
    report(document.hasFocus() ? 'WINDOW_FOCUS' : 'WINDOW_BLUR');
    draw();
  }
  chrome.runtime.onMessage.addListener(m => {
    if (m.kind === 'NOTICE' && state?.active && m.sessionId === state.sessionId) { notice(m.message); return; }
    if (m.kind !== 'SESSION_STATE' || !state || m.sessionId !== state.sessionId) return;
    if (!m.active) { stop(); state.active = false; state.status = m.status; draw(); }
  });
  async function connect() {
    try {
      state = await send({ kind: 'HELLO', joinCode: new URLSearchParams(location.hash.slice(1)).get('formsentry') || undefined });
      if (!state.exam) return;
      mount(); draw(); if (state.active) activate();
    } catch (error) {
      state ||= { active: false, status: 'ERROR', exam: { name: 'Examination setup', rules: S.DEFAULT_RULES } };
      mount(); fail(error);
    }
  }
  addEventListener('pagehide', stop);
  addEventListener('pageshow', e => { if (e.persisted) connect(); });
  connect();
})();
