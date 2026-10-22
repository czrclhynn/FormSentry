const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
module.exports = async function harness(seed = {}) {
  const url = 'https://docs.google.com/forms/d/e/practice/viewform', extension = 'formsentry-test';
  const db = structuredClone(seed), tabs = new Map([[1, { id: 1, windowId: 10, active: true, url }]]), calls = [];
  function emitter() { return { handlers: [], addListener(fn) { this.handlers.push(fn); } }; }
  const chrome = {
    runtime: { id: extension, getURL: p => `chrome-extension://${extension}/${p}`, onMessage: emitter(), onStartup: emitter(), onInstalled: emitter() },
    storage: { local: { get: async keys => Object.fromEntries(keys.filter(k => k in db).map(k => [k, structuredClone(db[k])])), set: async value => { await new Promise(r=>setImmediate(r)); Object.assign(db, structuredClone(value)); }, setAccessLevel: async () => {} } },
    action: { setBadgeText: async data => calls.push(['badge', data]), setBadgeBackgroundColor: async () => {} },
    tabs: { onActivated: emitter(), onCreated: emitter(), onUpdated: emitter(), onRemoved: emitter(), onAttached: emitter(), onReplaced: emitter(),
      get: async id => { if (!tabs.has(id)) throw new Error('Missing tab'); return structuredClone(tabs.get(id)); },
      update: async (id, data) => { if (!tabs.has(id)) throw new Error('Missing tab'); calls.push(['update', id, data]); Object.assign(tabs.get(id), data); return tabs.get(id); },
      remove: async id => { calls.push(['remove', id]); tabs.delete(id); }, sendMessage: async (...args) => calls.push(['send', ...args]) },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: emitter(), update: async (...args) => calls.push(['window', ...args]) },
    alarms: { create: async () => {}, onAlarm: emitter() }
  };
  let context;
  const cloudExam = { id:'11111111-1111-4111-8111-111111111111', title:'Practice', form_url:url, status:'active', rules:{departures:true,fullscreen:false,clipboard:true,domains:['chatgpt.com'],mode:'RECORD'} };
  const attempts=new Map();
  const fetch=async(request,options)=>{
    const body=JSON.parse(options.body); let value;
    if(body.action==='resolve') value={exam:cloudExam};
    else if(body.action==='start') { if(!attempts.has(body.token)) attempts.set(body.token,{id:webcrypto.randomUUID(),status:'active',started_at:new Date().toISOString(),rules:cloudExam.rules});value={session:attempts.get(body.token)}; }
    else value={accepted:body.events.map(e=>e.id),status:body.final||'active',terminal:!!body.final};
    return {ok:true,text:async()=>JSON.stringify(value)};
  };
  function restart() {
    for (const group of [chrome.runtime, chrome.tabs, chrome.windows, chrome.alarms]) for (const value of Object.values(group)) if (value?.handlers) value.handlers = [];
    context = vm.createContext({ chrome, URL, TextEncoder, crypto: webcrypto, console, Date, setTimeout, clearTimeout, fetch, AbortSignal,
      importScripts: (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file})) });
    vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context,{filename:'background.js'});
  }
  restart();
  const admin = { id: extension, url: chrome.runtime.getURL('options.html') };
  const content = { id: extension, url, frameId: 0, documentId: 'doc1', tab: { id: 1 } };
  const message = (m, sender = admin) => new Promise(resolve => chrome.runtime.onMessage.handlers[0](m, sender, resolve));
  const drain = () => message({ kind: 'SUMMARY' });
  const emit = async (name, ...args) => { const [group, key] = name.split('.'); for (const h of chrome[group][key].handlers) h(...args); return drain(); };
  await drain();
  return { db, tabs, calls, chrome, admin, content, message, emit, drain, restart, cloudExam, attempts };
};
