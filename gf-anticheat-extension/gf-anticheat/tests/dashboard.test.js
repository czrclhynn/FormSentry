const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function dashboard(){
  const elements=new Map(),pending=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'',textContent:'',classList:{add(){}},replaceChildren(){}});return elements.get(id);};
  const context=vm.createContext({
    FormSentry:require('../shared.js'),FormSentryUI:{},
    FormSentryTeacher:{callback:()=>false,hasSession:()=>false,rest:query=>new Promise(resolve=>pending.set(query.match(/session_id=eq\.([^&]+)/)[1],resolve))},
    document:{getElementById:element,addEventListener(){}},location:{hash:''},setInterval(){},console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../options.js'),'utf8'),context);
  vm.runInContext(`sessions=[{id:'a',student_name:'Alice',student_email:'a@example.invalid',status:'active',submission_status:'not_detected'},{id:'b',student_name:'Bob',student_email:'b@example.invalid',status:'active',submission_status:'not_detected'}];`,context);
  return {context,pending,element,run:code=>vm.runInContext(code,context)};
}
const event=(session)=>({id:session+'1',session_id:session,category:'ACTIVITY',description:session+' event',occurred_at:new Date().toISOString(),metadata:{}});
test('out-of-order student-detail responses cannot mix student identities and events',async()=>{
  const h=dashboard(),a=h.run("openSession('a')"),b=h.run("openSession('b')");
  h.pending.get('b')([event('b')]);await b;h.pending.get('a')([event('a')]);await a;
  assert.match(h.element('detail-title').textContent,/Bob/);
  assert.equal(h.run('selected.id'),'b');assert.equal(h.run('detailEvents[0].session_id'),'b');
});
test('closing a detail view cancels a pending response',async()=>{
  const h=dashboard(),request=h.run("openSession('a')");
  h.element('detail-close').onclick();h.pending.get('a')([event('a')]);await request;
  assert.equal(h.element('session-detail').hidden,true);assert.equal(h.run('selected'),null);
});
test('logout prevents a pending detail response from restoring student records',async()=>{
  const h=dashboard(),request=h.run("openSession('a')");
  h.run('lock()');h.pending.get('a')([event('a')]);await request;
  assert.equal(h.element('workspace').hidden,true);assert.equal(h.run('detailEvents.length'),0);
});
