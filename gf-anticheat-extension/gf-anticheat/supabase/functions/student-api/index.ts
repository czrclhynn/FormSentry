import { identity, validateEvents } from './validation.mjs';

const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
const response = (status:number, value:unknown) => new Response(JSON.stringify(value), { status, headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'} });
const url = Deno.env.get('SUPABASE_URL')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function database(path:string, method='GET', body?:unknown) {
  const result = await fetch(url + '/rest/v1/' + path, {method,headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const value = await result.json();
  if (!result.ok) throw new Error(value.message || 'Database operation failed.');
  return value;
}
async function hash(value:string) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response(null,{headers:cors});
  if(req.method!=='POST') return response(405,{error:'POST required.'});
  try {
    const text=await req.text(); if(new TextEncoder().encode(text).length>262144) return response(413,{error:'Request too large.'});
    const body=JSON.parse(text), action=body.action;
    if(action==='resolve') {
      if(!/^[a-f0-9]{48}$/.test(body.joinCode||'')) return response(400,{error:'Invalid examination invitation.'});
      const exams=await database('exams?select=id,title,form_url,rules,status&join_code=eq.'+body.joinCode+'&status=eq.active&limit=1');
      return exams[0]?response(200,{exam:exams[0]}):response(404,{error:'Examination unavailable. Ask your teacher for an active invitation.'});
    }
    if(action==='start') {
      const student=identity(body);
      const session=await database('rpc/formsentry_start','POST',{p_join_code:student.joinCode,p_token_hash:await hash(student.token),p_name:student.name,p_email:student.email});
      return response(200,{session});
    }
    if(action==='sync') {
      const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
      if(!/^[a-f0-9]{64}$/.test(token)||!/^[a-f0-9-]{36}$/.test(body.sessionId||'')) return response(401,{error:'Invalid session credential.'});
      const tokenHash=await hash(token), sessions=await database('student_sessions?select=id,rules_snapshot,status&token_hash=eq.'+tokenHash+'&id=eq.'+body.sessionId+'&limit=1');
      if(!sessions[0]) return response(401,{error:'Invalid session credential.'});
      const events=validateEvents(body.events,sessions[0].rules_snapshot);
      if(body.final!=null&&!['completed','interrupted','technical_issue','submission_unverified'].includes(body.final)) return response(400,{error:'Invalid final status.'});
      if(body.submission!=null&&!['detected','unverified'].includes(body.submission)) return response(400,{error:'Submission cannot be independently verified by this client.'});
      const result=await database('rpc/formsentry_ingest','POST',{p_session:body.sessionId,p_token_hash:tokenHash,p_events:events,p_final:body.final||null,p_submission:body.submission||null});
      return response(200,result);
    }
    return response(400,{error:'Unknown operation.'});
  } catch(error) {
    const message=error instanceof Error?error.message:'Request failed.';
    const rate=/Too many|Rate limit/.test(message);
    // Do not return raw SQL, service credentials, stack traces or schema details.
    const allowed=/Invalid|Enter a valid|Consent|Examination is unavailable|Attempt identity|Event disabled|Departure must|Domain is outside|Historical event|Session credential expired|Too many|Rate limit|Send at most/.test(message);
    return response(rate?429:400,{error:allowed?message:'The monitoring service could not process this request. Check deployment and try again.'});
  }
});
