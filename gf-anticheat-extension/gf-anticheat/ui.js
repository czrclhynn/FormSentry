/* Helpers for trusted extension pages. No remote requests or runtime dependencies. */
globalThis.FormSentryUI = {
  send: message => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.ok) reject(new Error(response?.error || 'FormSentry is unavailable. Reload the extension and refresh this page.'));
      else resolve(response);
    });
  }),
  download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async action(button, feedback, fn) {
    if (button.disabled) return;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    feedback.textContent = ''; feedback.classList.remove('error-text');
    try { await fn(); } catch (error) { feedback.textContent = error.message; feedback.classList.add('error-text'); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
};
