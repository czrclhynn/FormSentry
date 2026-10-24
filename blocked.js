document.getElementById('d').textContent = new URLSearchParams(location.search).get('d') || '';
document.getElementById('b').onclick = () => chrome.runtime.sendMessage({ kind: 'RETURN_TO_EXAM' }, () => window.close());
