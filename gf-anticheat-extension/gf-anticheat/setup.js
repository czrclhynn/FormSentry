if (globalThis.chrome?.runtime?.getManifest) document.getElementById('version').textContent = chrome.runtime.getManifest().version;
document.getElementById('copy-extensions').onclick = async () => {
  const feedback = document.getElementById('copy-feedback');
  try { await navigator.clipboard.writeText('chrome://extensions/'); feedback.textContent = 'Copied. Paste into Chrome’s address bar.'; }
  catch { feedback.textContent = 'Select and copy this address manually: chrome://extensions/'; }
};
