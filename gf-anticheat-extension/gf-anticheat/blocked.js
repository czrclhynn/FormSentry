document.getElementById('domain').textContent = (new URLSearchParams(location.search).get('d') || '').slice(0, 253);
document.getElementById('return').onclick = () => FormSentryUI.action(document.getElementById('return'), document.getElementById('feedback'), async () => {
  await FormSentryUI.send({ kind: 'RETURN_TO_EXAM' }); document.getElementById('feedback').textContent = 'Returned to the active examination. You may close this restricted-site tab.';
});
